#!/usr/bin/env python3
"""Dependency-free packaging and a local preview with video byte-range support."""

import argparse
import base64
import functools
import html
import http.server
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import secrets
import tempfile
import threading
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_FILES = (
    "index.html", "styles.css", "app.js", "access.js", "presentation.js", "speaker.enc.json", "_headers",
    "assets/check-the-caller.svg", "assets/check-the-caller.png", "assets/poster.jpg", "assets/poster-portrait.jpg",
    "assets/fonts/Carlito-Regular.woff2", "assets/fonts/Carlito-Bold.woff2", "assets/fonts/OFL.txt",
    "assets/portrait-right.mp4", "assets/portrait-wrong.mp4",
    "ScamProtection_Right.m4v", "ScamProtection_Wrong.m4v",
)
VIDEO_FILES = tuple(name for name in PUBLIC_FILES if name.endswith(('.mp4', '.m4v')))


def local_html():
    """Embed public resources; retain encrypted details and lazy player startup."""
    document = (ROOT / 'index.html').read_text(encoding='utf-8')
    styles = (ROOT / 'styles.css').read_text(encoding='utf-8')
    scripts = {name: (ROOT / name).read_text(encoding='utf-8')
               for name in ('access.js', 'app.js', 'presentation.js')}
    mime_types = {'.svg': 'image/svg+xml', '.png': 'image/png',
                  '.jpg': 'image/jpeg', '.woff2': 'font/woff2'}
    for name in PUBLIC_FILES:
        mime = mime_types.get(Path(name).suffix)
        if mime:
            data = base64.b64encode((ROOT / name).read_bytes()).decode('ascii')
            uri = f'data:{mime};base64,{data}'
            document = document.replace(name, uri)
            styles = styles.replace(name, uri)
            scripts = {key: value.replace(name, uri) for key, value in scripts.items()}
    for name in VIDEO_FILES:
        scripts = {key: value.replace(name, Path(name).name) for key, value in scripts.items()}
    sealed = json.loads((ROOT / 'speaker.enc.json').read_text(encoding='utf-8'))
    bootstrap = ('window.checkTheCallerOffline = {payload: ' + json.dumps(sealed) +
                 ', sections: {film: function () {\n' + scripts['app.js'] +
                 '\n}, presentation: function () {\n' + scripts['presentation.js'] + '\n}}};\n' +
                 scripts['access.js'])
    # Inline raw-text elements must not contain an HTML closing tag, even in a string.
    bootstrap = re.sub(r'</script', r'<\\/script', bootstrap, flags=re.IGNORECASE)
    styles = re.sub(r'</style', r'<\\/style', styles, flags=re.IGNORECASE)
    document = document.replace('<link rel="stylesheet" href="styles.css">', f'<style>\n{styles}\n</style>')
    document = document.replace('<script src="access.js" defer></script>', '')
    licence = html.escape((ROOT / 'assets/fonts/OFL.txt').read_text(encoding='utf-8'))
    document = document.replace('</body>', f'<template id="font-licence">{licence}</template>\n<script>\n{bootstrap}\n</script>\n</body>')
    document = document.replace('Check your connection, then try again.',
                                'Keep all four video files beside this HTML file, then try again.')
    document = document.replace('Check your connection and select Try again.',
                                'Keep all four video files beside this HTML file and select Try again.')
    return document


def build_local():
    """Produce a portable folder that opens via file: without a web server."""
    for name in PUBLIC_FILES:
        source = ROOT / name
        if not source.is_file() or source.stat().st_size == 0:
            raise SystemExit(f'Missing or empty required file: {name}. Existing local/ was not changed.')
    output = ROOT / 'local'
    if output.is_symlink() or (output.exists() and not output.is_dir()):
        raise SystemExit('local must be a normal directory, not a file or symbolic link.')
    document = local_html()
    stage = Path(tempfile.mkdtemp(prefix='.local-build-', dir=ROOT))
    try:
        (stage / 'index.html').write_text(document, encoding='utf-8')
        for name in VIDEO_FILES:
            shutil.copy2(ROOT / name, stage / Path(name).name)
        if output.exists():
            shutil.rmtree(output)
        stage.rename(output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    print(f'Built {output}. Open index.html in your browser; no server or internet needed.', flush=True)
    print('Copy the whole local folder together. Enter the usual code. Advice website links need internet.', flush=True)
    return output


def build():
    """Only explicit public assets can enter the deployment folder."""
    for name in PUBLIC_FILES:
        source = ROOT / name
        if not source.is_file() or source.stat().st_size == 0:
            raise SystemExit(f"Missing or empty required file: {name}. Existing dist/ was not changed.")
    output = ROOT / "dist"
    if output.is_symlink() or (output.exists() and not output.is_dir()):
        raise SystemExit("dist must be a normal directory, not a file or symbolic link.")
    stage = Path(tempfile.mkdtemp(prefix=".dist-build-", dir=ROOT))
    try:
        for name in PUBLIC_FILES:
            destination = stage / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, destination)
        if output.exists():
            shutil.rmtree(output)
        stage.rename(output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    total = sum((output / name).stat().st_size for name in PUBLIC_FILES)
    print(f"Built {output} ({total / 1024 / 1024:.1f} MB).", flush=True)
    print("Drop the dist folder onto Netlify Drop to publish.", flush=True)
    return output


class VideoHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".m4v": "video/mp4"}

    def do_POST(self):
        if self.path != "/__fraud_protect__/stop":
            self.send_error(404)
            return
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {self.server.stop_token}"
        if not hmac.compare_digest(supplied, expected):
            self.send_error(403)
            return
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()
        # shutdown must run outside the serve_forever thread.
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def send_head(self):
        self.byte_range = None
        path = Path(self.translate_path(self.path))
        requested = self.headers.get("Range")
        if not requested or not path.is_file():
            return super().send_head()
        size = path.stat().st_size
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested.strip())
        if not match or not any(match.groups()) or not size:
            return self.invalid_range(size)
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:
            length = int(last)
            if length == 0:
                return self.invalid_range(size)
            start, end = max(0, size - length), size - 1
        if start >= size or start > end:
            return self.invalid_range(size)
        stream = path.open("rb")
        stream.seek(start)
        self.byte_range = (start, end)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(path.stat().st_mtime))
        self.end_headers()
        return stream

    def invalid_range(self, size):
        self.send_response(416)
        self.send_header("Content-Range", f"bytes */{size}")
        self.send_header("Content-Length", "0")
        self.end_headers()
        return None

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def copyfile(self, source, outputfile):
        try:
            if self.byte_range is None:
                return super().copyfile(source, outputfile)
            remaining = self.byte_range[1] - self.byte_range[0] + 1
            while remaining > 0:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Expected when the viewer pauses or changes the video.


def run(port, open_browser=True):
    output = build()
    handler = functools.partial(VideoHandler, directory=str(output))
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    except OSError as error:
        raise SystemExit(f"Could not start preview: {error}. Try make run PORT=8080.") from error
    server.stop_token = secrets.token_urlsafe(32)
    registry = ROOT / ".preview-servers"
    registry.mkdir(mode=0o700, exist_ok=True)
    record = registry / f"{os.getpid()}.json"
    try:
        with open(record, "w", opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
            json.dump({"port": server.server_port, "token": server.stop_token}, stream)
    except OSError:
        server.server_close()
        raise
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Serving Check the Caller at {url}\nPress Ctrl+C to stop.", flush=True)
    if open_browser:
        timer = threading.Timer(0.3, webbrowser.open, args=(url,))
        timer.daemon = True
        timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPreview stopped.")
    finally:
        server.server_close()
        record.unlink(missing_ok=True)


def stop():
    """Stop only servers whose private per-instance token is in this project."""
    registry = ROOT / ".preview-servers"
    count = 0
    failures = 0
    # Ignore proxy configuration: these requests must stay on this computer.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for record in sorted(registry.glob("*.json")):
        try:
            info = json.loads(record.read_text())
            port, token = info["port"], info["token"]
            if type(port) is not int or not 0 < port < 65536 or not isinstance(token, str) or not token:
                raise ValueError("Invalid preview record")
        except (OSError, ValueError, KeyError, TypeError):
            print(f"Could not read preview record: {record.name}")
            failures += 1
            continue
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/__fraud_protect__/stop",
            headers={"Authorization": f"Bearer {token}"}, method="POST", data=b"",
        )
        try:
            with opener.open(request, timeout=3) as response:
                if response.status != 200:
                    raise ValueError("Unexpected preview response")
            count += 1
            record.unlink(missing_ok=True)
        except urllib.error.HTTPError as error:
            # A different server may have reused an old preview's port.
            if error.code in (403, 404, 405, 501):
                record.unlink(missing_ok=True)
            else:
                print(f"Could not stop preview on port {port}: HTTP {error.code}")
                failures += 1
        except urllib.error.URLError as error:
            if isinstance(error.reason, ConnectionRefusedError):
                record.unlink(missing_ok=True)
            else:
                print(f"Could not reach preview on port {port}: {error.reason}")
                failures += 1
        except (OSError, ValueError) as error:
            print(f"Could not stop preview on port {port}: {error}")
            failures += 1
    print(f"Stopped {count} preview server{'s' if count != 1 else ''}." if count else "No active preview servers found for this project.")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "local", "run", "stop"))
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-open", action="store_true", help="Serve without opening a browser")
    args = parser.parse_args()
    if args.command == "build":
        build()
    elif args.command == "local":
        build_local()
    elif args.command == "stop":
        stop()
    else:
        run(args.port, not args.no_open)
