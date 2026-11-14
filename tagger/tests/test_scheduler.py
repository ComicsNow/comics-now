"""Unit tests for tagger_app.scheduler.state.

Uses monkeypatch.setitem / a temp CONFIG_FILE so the shared singletons and the real
scheduler_config.json are not polluted.
"""
import json
import datetime

from tagger_app.scheduler import state


def test_calculate_next_run_disabled(monkeypatch):
    monkeypatch.setitem(state.scheduler_config, "enabled", False)
    monkeypatch.setitem(state.scheduler_status, "next_run", "sentinel")
    state.calculate_next_run()
    assert state.scheduler_status["next_run"] is None


def test_calculate_next_run_immediate_when_never_run(monkeypatch):
    monkeypatch.setitem(state.scheduler_config, "enabled", True)
    monkeypatch.setitem(state.scheduler_config, "default_directory", "/tmp")
    monkeypatch.setitem(state.scheduler_status, "last_run", None)
    monkeypatch.setitem(state.scheduler_status, "next_run", None)
    state.calculate_next_run()
    # parses as a valid near-now timestamp
    nr = datetime.datetime.fromisoformat(state.scheduler_status["next_run"])
    assert (datetime.datetime.now() - nr).total_seconds() < 5


def test_calculate_next_run_adds_interval(monkeypatch):
    monkeypatch.setitem(state.scheduler_config, "enabled", True)
    monkeypatch.setitem(state.scheduler_config, "default_directory", "/tmp")
    monkeypatch.setitem(state.scheduler_config, "interval_value", 2)
    monkeypatch.setitem(state.scheduler_config, "interval_unit", "day")
    monkeypatch.setitem(state.scheduler_status, "last_run", "2026-01-01T00:00:00")
    state.calculate_next_run()
    assert state.scheduler_status["next_run"] == "2026-01-03T00:00:00"


def test_load_save_roundtrip(monkeypatch, tmp_path):
    cfg = tmp_path / "sched.json"
    monkeypatch.setattr(state, "CONFIG_FILE", str(cfg))
    monkeypatch.setitem(state.scheduler_config, "interval_value", 7)
    monkeypatch.setitem(state.scheduler_status, "last_run", "2026-05-05T10:00:00")
    state.save_scheduler_data()

    on_disk = json.loads(cfg.read_text())
    assert on_disk["config"]["interval_value"] == 7
    assert on_disk["status"]["last_run"] == "2026-05-05T10:00:00"

    # mutate then reload -> value restored from disk, is_running forced False
    monkeypatch.setitem(state.scheduler_config, "interval_value", 999)
    monkeypatch.setitem(state.scheduler_status, "is_running", True)
    state.load_scheduler_data()
    assert state.scheduler_config["interval_value"] == 7
    assert state.scheduler_status["is_running"] is False


def test_save_scheduler_data_never_persists_plaintext_secrets(monkeypatch, tmp_path):
    cfg = tmp_path / "sched.json"
    monkeypatch.setattr(state, "CONFIG_FILE", str(cfg))
    monkeypatch.setitem(state.scheduler_config, "comicvine_api_key", "mock-cv-secret-12345")
    monkeypatch.setitem(state.scheduler_config, "google_books_api_key", "mock-gb-secret-67890")
    monkeypatch.setitem(state.scheduler_config, "metron_pass", "mock-metron-secret")
    monkeypatch.setitem(state.scheduler_config, "gcd_pass", "mock-gcd-secret")
    monkeypatch.setitem(state.scheduler_config, "metron_user", "mockMetronUser")
    state.save_scheduler_data()

    on_disk = json.loads(cfg.read_text())
    assert on_disk["config"]["comicvine_api_key"] == ""
    assert on_disk["config"]["google_books_api_key"] == ""
    assert on_disk["config"]["metron_pass"] == ""
    assert on_disk["config"]["gcd_pass"] == ""
    assert on_disk["config"]["metron_user"] == "mockMetronUser"
    # In-memory state remains intact for active session
    assert state.scheduler_config["comicvine_api_key"] == "mock-cv-secret-12345"


def test_scheduler_info_masks_secrets(client, monkeypatch):
    monkeypatch.setitem(state.scheduler_config, "comicvine_api_key", "mock-cv-secret-123456")
    monkeypatch.setitem(state.scheduler_config, "metron_pass", "short")
    resp = client.get("/scheduler-info")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["config"]["comicvine_api_key"] == "••••••••••••3456"
    assert data["config"]["metron_pass"] == "••••••••"
    assert "mock-cv-secret-123456" not in resp.get_data(as_text=True)
