"""Unit tests for tagger_app.scheduler.state.

Uses monkeypatch.setitem / a temp CONFIG_FILE so the shared singletons and the real
scheduler_config.json are not polluted.
"""
import json
import datetime

import pytest

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
