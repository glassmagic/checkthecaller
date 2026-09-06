"""Opt-in check using localhost sockets: python3 tests/preview_integration.py."""
import http.server
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def launch():
    process = subprocess.Popen(
        [sys.executable, "scripts/site.py", "run", "--port", "0", "--no-open"],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    record = ROOT / ".preview-servers" / f"{process.pid}.json"
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(process.stdout.read())
        if record.exists():
            try:
                info = json.loads(record.read_text())
                return process, info
            except json.JSONDecodeError:
                pass
        time.sleep(0.05)
    process.terminate()
    raise AssertionError("Preview did not start")


def main():
    processes = []
    # An unrelated local service must survive make stop.
    unrelated = http.server.ThreadingHTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
    thread = threading.Thread(target=unrelated.serve_forever, daemon=True)
    thread.start()
    try:
        for _ in range(2):
            process, info = launch()
            processes.append(process)
            base = f"http://127.0.0.1:{info['port']}"
            with opener.open(base) as response:
                assert response.status == 200
            for name in ["ScamProtection_Right.m4v", "ScamProtection_Wrong.m4v"]:
                request = urllib.request.Request(f"{base}/{name}", headers={"Range": "bytes=1024-2047"})
                with opener.open(request) as response:
                    assert response.status == 206
                    assert response.headers["Content-Type"] == "video/mp4"
                    assert len(response.read()) == 1024
            request = urllib.request.Request(f"{base}/__fraud_protect__/stop", data=b"", method="POST")
            try:
                opener.open(request)
                raise AssertionError("Shutdown without the instance token should be rejected")
            except urllib.error.HTTPError as error:
                assert error.code == 403
        result = subprocess.run(["make", "stop"], cwd=ROOT, text=True, capture_output=True, check=True)
        assert "Stopped 2 preview servers." in result.stdout, result.stdout
        for process in processes:
            assert process.wait(timeout=5) == 0
        with opener.open(f"http://127.0.0.1:{unrelated.server_port}/") as response:
            assert response.status == 200
        result = subprocess.run(["make", "stop"], cwd=ROOT, text=True, capture_output=True, check=True)
        assert "No active preview servers" in result.stdout
        assert not list((ROOT / ".preview-servers").glob("*.json"))
        print("PASS: both videos serve byte ranges; two previews stop; repeated stop is safe; unrelated server survives.")
    finally:
        unrelated.shutdown()
        unrelated.server_close()
        for process in processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            process.stdout.close()


if __name__ == "__main__":
    main()
