"""Baseline smoke tests for the Flask surface.

These characterize current behavior so we can detect regressions while working through
the security review. They are intentionally offline (no network/source calls).
"""


def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


def test_index_renders(client):
    resp = client.get("/")
    assert resp.status_code == 200


def test_unknown_route_404(client):
    assert client.get("/definitely-not-a-route").status_code == 404


def test_core_routes_registered(app_module):
    rules = {r.rule for r in app_module.app.url_map.iter_rules()}
    for route in ["/", "/api/health", "/browse-files", "/load-local",
                  "/search", "/tag", "/batch-tag", "/library-enhance"]:
        assert route in rules, f"missing route {route}"


def test_active_scan_when_idle(client):
    resp = client.get("/api/active-scan")
    assert resp.status_code == 200
    assert resp.get_json()["active"] is False


# --- file-path route guards (also baseline for the SEC-003 work later) ---

def test_load_local_missing_path_rejected(client):
    resp = client.post("/load-local", json={})
    assert resp.status_code == 400


def test_load_local_nonexistent_path_rejected(client):
    resp = client.post("/load-local", json={"file_path": "/no/such/file.cbz"})
    assert resp.status_code == 400


def test_load_local_non_cbz_rejected(client, tmp_path):
    f = tmp_path / "not_a_comic.txt"
    f.write_text("x")
    resp = client.post("/load-local", json={"file_path": str(f)})
    assert resp.status_code == 400
