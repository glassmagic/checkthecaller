import contextlib
import importlib.util
import io
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
