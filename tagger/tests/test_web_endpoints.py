"""Broader characterization of the read-only web surface.

This is the regression net guarding the upcoming app-factory refactor: it pins the
status codes and response shapes of every offline (no-network) endpoint so that moving
routes/startup around cannot silently change behavior.
"""


def test_scheduler_info(client):
    resp = client.get("/scheduler-info")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert "config" in data and "status" in data
    # the config exposes the known keys
    assert "enabled_sources" in data["config"]


def test_homepage_widget_shape(client):
    resp = client.get("/api/homepage")
    assert resp.status_code == 200
    items = resp.get_json()
    assert isinstance(items, list) and len(items) == 3
    labels = {i["label"] for i in items}
    assert labels == {"Status", "Total Tagged", "History"}


def test_logs_list(client):
    resp = client.get("/api/logs")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert isinstance(data["logs"], list)


def test_log_detail_missing_is_404(client):
    resp = client.get("/api/logs/does-not-exist")
    assert resp.status_code == 404
    assert "error" in resp.get_json()


def test_local_files_lists(client):
    resp = client.get("/local-files")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert isinstance(data["files"], list)


def test_browse_files_with_path(client, tmp_path):
    (tmp_path / "sub").mkdir()
    resp = client.get("/browse-files", query_string={"path": str(tmp_path)})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["current_path"] == str(tmp_path)
    assert any(d["name"] == "sub" for d in data["subdirs"])


def test_download_unknown_session_404(client):
    resp = client.get("/download/nonexistent-session")
    assert resp.status_code == 404


def test_active_scan_idle(client):
    resp = client.get("/api/active-scan")
    assert resp.status_code == 200
    assert resp.get_json()["active"] is False


def test_search_forbiddenplanet(client, monkeypatch):
    import app
    monkeypatch.setattr(app, "search_forbiddenplanet_multi", lambda q: [{"title": "Batman #1", "issue": "1"}])
    resp = client.post("/api/search", json={"source": "forbiddenplanet", "query": "Batman"})
    assert resp.status_code == 200
    results = resp.get_json()
    assert len(results) == 1
    assert results[0]["source"] == "forbiddenplanet"


def test_search_all_includes_forbiddenplanet(client, monkeypatch):
    import app
    called = []
    # Mock other network sources to keep the test instant
    monkeypatch.setattr(app, "search_gcd_multi", lambda q: [])
    monkeypatch.setattr(app, "search_lcg_multi", lambda q: [])
    monkeypatch.setattr(app, "search_goodreads_multi", lambda q: [])
    monkeypatch.setattr(app, "search_blackwells_multi", lambda q: [])
    monkeypatch.setattr(app, "search_waterstones_multi", lambda q: [])
    monkeypatch.setattr(app, "search_googlebooks_multi", lambda q, **kwargs: [])
    monkeypatch.setattr(app, "search_amazon_multi", lambda q: [])
    monkeypatch.setattr(app, "search_forbiddenplanet_multi", lambda q: called.append(q) or [{"title": "FP Result"}])
    resp = client.post("/api/search", json={"source": "all", "query": "Batman"})
    assert resp.status_code == 200
    assert len(called) == 1
    results = resp.get_json()
    assert any(r.get("source") == "forbiddenplanet" for r in results)


