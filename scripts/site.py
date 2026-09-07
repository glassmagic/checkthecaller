#!/usr/bin/env python3
"""Dependency-free packaging and a local preview with video byte-range support."""

import argparse
import functools
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
    "index.html", "styles.css", "app.js", "_headers",
    "assets/check-the-caller.svg", "assets/check-the-caller.png", "assets/poster.jpg", "assets/poster-portrait.jpg",
    "assets/portrait-right.mp4", "assets/portrait-wrong.mp4",
    "ScamProtection_Right.m4v", "ScamProtection_Wrong.m4v",
)


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
    parser.add_argument("command", choices=("build", "run", "stop"))
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-open", action="store_true", help="Serve without opening a browser")
    args = parser.parse_args()
    if args.command == "build":
        build()
    elif args.command == "stop":
        stop()
    else:
        run(args.port, not args.no_open)
