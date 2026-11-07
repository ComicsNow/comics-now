"""Unit tests for tagger_app.continuity.batch_tagger."""
import sqlite3
import pytest
from unittest.mock import MagicMock
from tagger_app.continuity.db import init_continuity_db, upsert_reading_order, upsert_reading_order_issues
from tagger_app.continuity.batch_tagger import ContinuityBatchTagger


@pytest.fixture
def mock_ro_db(tmp_path):
    ro_path = tmp_path / "reading-orders.db"
    ro_conn = sqlite3.connect(str(ro_path))
    ro_conn.row_factory = sqlite3.Row
    init_continuity_db(ro_conn)
    upsert_reading_order(ro_conn, {
        "id": "crisis-on-infinite-earths",
        "title": "Crisis on Infinite Earths",
        "publisher": "DC Comics",
        "issue_count": 1,
    })
    upsert_reading_order_issues(ro_conn, "crisis-on-infinite-earths", [
        {"series_name": "Crisis on Infinite Earths", "issue_number": "1", "position": 1, "part_number": 1},
    ])
    ro_conn.close()
    return str(ro_path)


def test_batch_tagger_initial_state(mock_ro_db):
    tagger = ContinuityBatchTagger(ro_db_path=mock_ro_db)
    status = tagger.get_status()
    assert status["status"] == "idle"
    assert status["isRunning"] is False


def test_batch_tagger_cancel_flag(mock_ro_db):
    tagger = ContinuityBatchTagger(ro_db_path=mock_ro_db)
    tagger.is_running = True
    tagger.cancel_tagging()
    assert tagger.is_cancelled is True


def test_batch_tagger_concurrent_guard(mock_ro_db):
    tagger = ContinuityBatchTagger(ro_db_path=mock_ro_db)
    tagger.is_running = True
    with pytest.raises(RuntimeError, match="already running"):
        tagger.start_batch_tag()
