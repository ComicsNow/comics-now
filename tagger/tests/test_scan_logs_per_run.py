"""Tests for per-run scan audit log suppression and consolidated POST /api/logs."""
import json
from unittest.mock import patch


def test_tag_file_skips_scan_log_when_requested(client, tmp_path):
    cbz = tmp_path / "sample.cbz"
    cbz.write_bytes(b"fake")

    with patch("tagger_app.blueprints.api_v1.process_single_cbz_file", return_value={"status": "tagged", "matched_title": "Sample #1"}), \
         patch("tagger_app.blueprints.api_v1.write_scan_log") as mock_write:
        res = client.post("/api/tag-file", json={"path": str(cbz), "skip_scan_log": True})
        assert res.status_code == 200
        mock_write.assert_not_called()

        res2 = client.post("/api/tag-file", json={"path": str(cbz)})
        assert res2.status_code == 200
        mock_write.assert_called_once()


def test_post_logs_writes_one_consolidated_run_log(client, tmp_path, monkeypatch):
    monkeypatch.setattr("tagger_app.persistence.scan_logs.LOGS_DIR", str(tmp_path))
    monkeypatch.setattr("tagger_app.blueprints.logs.LOGS_DIR", str(tmp_path))

    payload = {
        "type": "library",
        "target": "/comics",
        "total_files": 3,
        "tagged_count": 1,
        "skipped_count": 1,
        "failed_count": 1,
        "results": [
            {"filename": "a.cbz", "status": "tagged", "matched_title": "A #1"},
            {"filename": "b.cbz", "status": "skipped", "reason": "Gate skipped"},
            {"filename": "c.cbz", "status": "failed", "error": "Timeout"},
        ],
    }
    res = client.post("/api/logs", json=payload)
    assert res.status_code == 200
    files = list(tmp_path.glob("scan_log_*.json"))
    assert len(files) == 1

    saved = json.loads(files[0].read_text())
    assert saved["total_files"] == 3
    assert saved["tagged_count"] == 1
    assert saved["skipped_count"] == 1
    assert saved["failed_count"] == 1
    assert len(saved["results"]) == 3
