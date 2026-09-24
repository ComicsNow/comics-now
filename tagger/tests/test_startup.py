"""Integration test: the app must actually boot and serve over a socket.

The earlier smoke tests only *imported* the module, so they never exercised the
`__main__` -> get_run_config() -> app.run() path. This launches the real entry point as
a subprocess (on a free loopback port) and confirms it binds and answers a request.
"""
import os
import sys
import time
import socket
import subprocess
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def test_app_boots_and_serves():
    port = _free_port()
    env = {**os.environ, "APP_HOST": "127.0.0.1", "APP_PORT": str(port), "FLASK_DEBUG": "0"}
    proc = subprocess.Popen(
        [sys.executable, "app.py"], cwd=ROOT, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        url = f"http://127.0.0.1:{port}/api/health"
        deadline = time.time() + 15
        last_err = None
        while time.time() < deadline:
            if proc.poll() is not None:  # process died during startup
                out = proc.stdout.read() if proc.stdout else ""
                raise AssertionError(f"app.py exited early (code {proc.returncode}):\n{out}")
            try:
                with urllib.request.urlopen(url, timeout=1) as r:
                    assert r.status == 200
                    return  # booted and served — success
            except Exception as e:
                last_err = e
                time.sleep(0.3)
        out = proc.stdout.read() if proc.stdout else ""
        raise AssertionError(f"server never became ready: {last_err}\n{out}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
