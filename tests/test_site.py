import contextlib
import importlib.util
import io
import json
from html.parser import HTMLParser
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("site_builder", Path(__file__).resolve().parents[1] / "scripts/site.py")
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)


class SiteTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.original_root = site.ROOT
        site.ROOT = self.root
        for name in site.PUBLIC_FILES:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"0123456789")

    def tearDown(self):
        site.ROOT = self.original_root
        self.directory.cleanup()

    def build(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return site.build()

    def test_build_copies_only_public_files_and_can_be_repeated(self):
        (self.root / ".private").write_text("do not publish")
        result = self.build()
        self.assertEqual({str(p.relative_to(result)) for p in result.rglob("*") if p.is_file()}, set(site.PUBLIC_FILES))
        (result / "stale.txt").write_text("old")
        self.build()
        self.assertFalse((result / "stale.txt").exists())
        self.assertEqual((result / "ScamProtection_Right.m4v").read_bytes(), b"0123456789")

    def test_missing_video_preserves_existing_build(self):
        result = self.build()
        (self.root / "ScamProtection_Wrong.m4v").unlink()
        with self.assertRaises(SystemExit):
            self.build()
        self.assertTrue((result / "ScamProtection_Wrong.m4v").exists())

    def test_refuses_symlink_output(self):
        (self.root / "dist").symlink_to(self.root / "assets", target_is_directory=True)
        with self.assertRaises(SystemExit):
            self.build()
        self.assertTrue((self.root / "assets/poster.jpg").exists())

    def local(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return site.build_local()

    def local_sources(self):
        for name in ('index.html', 'styles.css', 'access.js', 'app.js', 'presentation.js'):
            (self.root / name).write_bytes((self.original_root / name).read_bytes())
        (self.root / 'speaker.enc.json').write_text(json.dumps({'data': 'sealed-fixture'}))

    def test_local_contains_only_html_and_unchanged_adjacent_videos(self):
        self.local_sources()
        (self.root / 'private').mkdir()
        (self.root / 'private/speaker.json').write_text('NEVER INCLUDE THIS')
        output = self.local()
        self.assertEqual({p.name for p in output.iterdir()},
                         {'index.html', *(Path(name).name for name in site.VIDEO_FILES)})
        for name in site.VIDEO_FILES:
            self.assertEqual((output / Path(name).name).read_bytes(), (self.root / name).read_bytes())
        document = (output / 'index.html').read_text()
        self.assertNotIn('NEVER INCLUDE THIS', document)
        self.assertIn('sealed-fixture', document)
        self.assertIn('data:font/woff2;base64,', document)
        self.assertIn('id="font-licence"', document)
        self.assertNotIn('assets/', document)
        refs = []
        class Resources(HTMLParser):
            def handle_starttag(self, tag, attrs):
                refs.extend(value for key, value in attrs if key in ('src', 'poster') or (tag == 'link' and key == 'href'))
        Resources().feed(document)
        self.assertTrue(refs)
        self.assertTrue(all(ref.startswith('data:') for ref in refs), refs)
        (output / 'stale.txt').write_text('old')
        self.local()
        self.assertFalse((output / 'stale.txt').exists())

    def test_local_failure_preserves_previous_package(self):
        self.local_sources()
        output = self.local()
        previous = (output / 'index.html').read_bytes()
        (self.root / 'speaker.enc.json').write_text('invalid JSON')
        with self.assertRaises(ValueError):
            self.local()
        self.assertEqual((output / 'index.html').read_bytes(), previous)
        (self.root / 'assets/portrait-right.mp4').unlink()
        with self.assertRaises(SystemExit):
            self.local()
        self.assertTrue((output / 'portrait-right.mp4').exists())

    def test_local_refuses_symlink_output(self):
        (self.root / 'local').symlink_to(self.root / 'assets', target_is_directory=True)
        with self.assertRaises(SystemExit):
            self.local()
        self.assertTrue((self.root / 'assets/poster.jpg').exists())

    def test_local_escapes_script_end_tags_in_embedded_data(self):
        self.local_sources()
        (self.root / 'speaker.enc.json').write_text(json.dumps({'data': '</script><script>alert(1)</script>'}))
        document = (self.local() / 'index.html').read_text()
        self.assertEqual(document.count('</script>'), 1)
        self.assertIn(r'<\/script>', document)

    def response(self, request):
        handler = object.__new__(site.VideoHandler)
        handler.directory = str(self.root)
        handler.path = "/ScamProtection_Right.m4v"
        handler.headers = {"Range": request}
        headers = {}
        status = []
        handler.send_response = status.append
        handler.send_header = headers.__setitem__
        handler.end_headers = lambda: None
        stream = handler.send_head()
        body = io.BytesIO()
        if stream:
            with stream:
                handler.copyfile(stream, body)
        return status[0], headers, body.getvalue()

    def test_partial_video_response(self):
        status, headers, body = self.response("bytes=2-5")
        self.assertEqual(status, 206)
        self.assertEqual(headers["Content-Type"], "video/mp4")
        self.assertEqual(headers["Content-Range"], "bytes 2-5/10")
        self.assertEqual(headers["Content-Length"], "4")
        self.assertEqual(body, b"2345")

    def test_open_ended_and_suffix_ranges(self):
        self.assertEqual(self.response("bytes=7-")[2], b"789")
        self.assertEqual(self.response("bytes=-3")[2], b"789")
        self.assertEqual(self.response("bytes=7-100")[2], b"789")

    def test_invalid_ranges(self):
        for value in ["bytes=20-", "bytes=8-2", "bytes=-0", "bytes=-", "bytes=0-1,3-4", "invalid"]:
            with self.subTest(value=value):
                status, headers, body = self.response(value)
                self.assertEqual(status, 416)
                self.assertEqual(headers["Content-Range"], "bytes */10")
                self.assertEqual(body, b"")


if __name__ == "__main__":
    unittest.main()
