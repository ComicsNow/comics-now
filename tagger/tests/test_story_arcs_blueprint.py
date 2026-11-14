"""Unit tests for tagger_app.blueprints.story_arcs."""
import json
import pytest
from flask import Flask
from tagger_app.blueprints.story_arcs import story_arcs_bp
from tagger_app.continuity.crawler import continuity_crawler
from tagger_app.continuity.batch_tagger import continuity_batch_tagger


@pytest.fixture
def client():
    app = Flask(__name__)
    app.register_blueprint(story_arcs_bp)
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_sync_status_endpoint(client):
    res = client.get("/api/story-arcs/sync/status")
    assert res.status_code == 200
    data = res.get_json()
    assert "status" in data
    assert "isSyncing" in data


def test_batch_tag_status_endpoint(client):
    res = client.get("/api/story-arcs/batch-tag/status")
    assert res.status_code == 200
    data = res.get_json()
    assert "status" in data
    assert "isRunning" in data


def test_cancel_endpoints_when_idle(client):
    res_sync = client.post("/api/story-arcs/sync/cancel")
    assert res_sync.status_code == 200
    assert res_sync.get_json().get("cancelled") is True

    res_batch = client.post("/api/story-arcs/batch-tag/cancel")
    assert res_batch.status_code == 200
    assert res_batch.get_json().get("cancelled") is True


def test_list_story_arcs_endpoint(client):
    res = client.get("/api/story-arcs")
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list)


def test_get_publishers_endpoint(client, monkeypatch, tmp_path):
    from tagger_app.continuity.db import get_connection, init_continuity_db

    db_file = tmp_path / "ro.db"
    setup_conn = get_connection(db_file)
    init_continuity_db(setup_conn)
    setup_conn.execute(
        "INSERT INTO reading_orders (id, title, publisher) VALUES ('ro1', 'Knightfall', 'DC Comics')"
    )
    setup_conn.execute(
        "INSERT INTO reading_orders (id, title, publisher) VALUES ('ro2', 'Annihilation', 'Marvel')"
    )
    setup_conn.commit()
    setup_conn.close()

    monkeypatch.setattr("tagger_app.blueprints.story_arcs.get_connection", lambda: get_connection(db_file))
    res = client.get("/api/story-arcs/batch-tag/publishers")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert data["publishers"] == ["DC Comics", "Marvel"]
