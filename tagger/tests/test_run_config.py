"""SEC-001 — server run configuration must be safe by default and env-overridable.

The Werkzeug debugger permits remote code execution, so it must default to OFF, and the
server must default to binding loopback rather than all interfaces.
"""
import pytest


@pytest.fixture()
def clear_env(monkeypatch):
    for var in ("FLASK_DEBUG", "APP_HOST", "APP_PORT"):
        monkeypatch.delenv(var, raising=False)


def test_secure_defaults(app_module, clear_env):
    cfg = app_module.get_run_config()
    assert cfg["debug"] is False, "debug must default to OFF (SEC-001: Werkzeug RCE)"
    # 0.0.0.0 is intentional: the app is reached across the user's trusted LAN.
    assert cfg["host"] == "0.0.0.0"
    assert cfg["port"] == 5000
    assert cfg["threaded"] is True


def test_host_can_be_restricted_to_loopback(app_module, monkeypatch, clear_env):
    monkeypatch.setenv("APP_HOST", "127.0.0.1")
    assert app_module.get_run_config()["host"] == "127.0.0.1"


def test_debug_opt_in(app_module, monkeypatch, clear_env):
    monkeypatch.setenv("FLASK_DEBUG", "1")
    assert app_module.get_run_config()["debug"] is True


@pytest.mark.parametrize("val,expected", [
    ("0", False), ("false", False), ("no", False), ("", False),
    ("1", True), ("true", True), ("TRUE", True), ("yes", True), ("on", True),
])
def test_debug_flag_parsing(app_module, monkeypatch, clear_env, val, expected):
    monkeypatch.setenv("FLASK_DEBUG", val)
    assert app_module.get_run_config()["debug"] is expected


def test_host_and_port_override(app_module, monkeypatch, clear_env):
    monkeypatch.setenv("APP_HOST", "0.0.0.0")
    monkeypatch.setenv("APP_PORT", "8080")
    cfg = app_module.get_run_config()
    assert cfg["host"] == "0.0.0.0"
    assert cfg["port"] == 8080
