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


def test_batch_tagger_creates_sidecar_and_preserves_archive(tmp_path, mock_ro_db):
    import zipfile
    # 1. Create a dummy comic archive
    cbz_file = tmp_path / "Crisis on Infinite Earths #1 (1985).cbz"
    with zipfile.ZipFile(cbz_file, "w") as zf:
        zf.writestr("001.jpg", b"fake image bytes")
    initial_mtime = cbz_file.stat().st_mtime

    # 2. Setup mock comics-now.db
    cn_path = tmp_path / "comics-now.db"
    cn_conn = sqlite3.connect(str(cn_path))
    cn_conn.row_factory = sqlite3.Row
    with cn_conn:
        cn_conn.execute(
            """
            CREATE TABLE comics (
                id TEXT PRIMARY KEY,
                name TEXT,
                series TEXT,
                publisher TEXT,
                path TEXT,
                metadata TEXT,
                updatedAt TEXT
            )
            """
        )
        cn_conn.execute(
            """
            INSERT INTO comics (id, name, series, publisher, path, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "c1",
                "Crisis on Infinite Earths #1 (1985).cbz",
                "Crisis on Infinite Earths",
                "DC Comics",
                str(cbz_file),
                '{"Year": 1985, "Number": "1"}',
            ),
        )
    cn_conn.close()

    # 3. Run batch tagger
    tagger = ContinuityBatchTagger(cn_db_path=str(cn_path), ro_db_path=mock_ro_db)
    res = tagger.start_batch_tag(target_publisher="DC Comics", run_async=False)
    assert res.get("completed") is True
    assert res["progress"]["updated"] == 1

    # 4. Verify sidecar was created
    sidecar_path = tmp_path / "Crisis on Infinite Earths #1 (1985).ComicInfo.xml"
    assert sidecar_path.exists()
    xml_content = sidecar_path.read_text()
    assert "<StoryArc>Crisis on Infinite Earths</StoryArc>" in xml_content
    assert "<StoryArcNumber>1</StoryArcNumber>" in xml_content

    # 5. Verify the .cbz archive was NOT touched or rewritten
    with zipfile.ZipFile(cbz_file, "r") as zf:
        assert "ComicInfo.xml" not in zf.namelist()
    assert cbz_file.stat().st_mtime == initial_mtime

