"""Tests for the create_app() application factory (architecture: web layer).

Locks in two guarantees:
  1. Importing app.py has no side effects (no scheduler thread / DB init at import).
  2. create_app() performs startup wiring and returns the Flask app.
"""
import sys
import subprocess

ROOT = __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__)))


def test_import_has_no_side_effects():
    # A bare import must not start the scheduler worker (which prints on startup).
    proc = subprocess.run(
        [sys.executable, "-c", "import app"],
        cwd=ROOT, capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, proc.stderr
    combined = proc.stdout + proc.stderr
    assert "Background scheduler thread started" not in combined


def test_create_app_wires_startup_and_returns_app(app_module, monkeypatch):
    calls = []
    monkeypatch.setattr(app_module, "init_tracking_db", lambda: calls.append("init"))
    monkeypatch.setattr(app_module, "start_scheduler", lambda: calls.append("start"))

    returned = app_module.create_app()

    assert returned is app_module.app
    assert "init" in calls          # tracking DB initialized
    assert "start" in calls         # scheduler worker started (debug defaults off)
