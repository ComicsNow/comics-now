import sqlite3
import time
import tempfile
import pathlib
import sys
import pytest
from unittest.mock import patch, MagicMock

# Ensure scripts/modal is in sys.path
MODAL_DIR = str(pathlib.Path(__file__).parent.parent)
if MODAL_DIR not in sys.path:
    sys.path.insert(0, MODAL_DIR)

import runner


def _create_mock_db(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("""
        CREATE TABLE comics (
            id TEXT PRIMARY KEY,
            publisher TEXT,
            series TEXT,
            name TEXT,
            path TEXT UNIQUE,
            totalPages INTEGER DEFAULT 1,
            guidedViewStatus TEXT DEFAULT 'pending',
            guidedViewError TEXT,
            guidedViewPath TEXT
        );
    """)
    conn.execute("""
        CREATE TABLE user_reading_preferences (
            preferenceType TEXT,
            targetId TEXT,
            mangaMode INTEGER
        );
    """)
    conn.execute("CREATE TABLE scan_dirs (dir TEXT);")

    # Insert 4 test comics
    for i in range(1, 5):
        conn.execute(
            "INSERT INTO comics (id, publisher, series, name, path, guidedViewStatus) "
            "VALUES (?, ?, ?, ?, ?, 'pending')",
            (f"comic_{i}", "TestPub", "TestSeries", f"Test {i}", f"/tmp/fake_comic_{i}.cbz")
        )
    conn.commit()
    conn.close()


def test_concurrent_processing_without_db_locks(tmp_path):
    db_file = str(tmp_path / "test_comics.db")
    sidecar_dir = tmp_path / "sidecars"
    sidecar_dir.mkdir(parents=True)
    _create_mock_db(db_file)

    db = sqlite3.connect(db_file, timeout=10.0, check_same_thread=False)

    # Mock process_comic so we don't need real files on disk
    def fake_process_comic(conn, comic):
        time.sleep(0.1)  # simulate network/GPU delay
        return {"comicId": comic[0], "type": "western", "pages": {}}

    pending = runner.get_pending(db)
    assert len(pending) == 4

    start_time = time.time()
    with patch("runner.process_comic", side_effect=fake_process_comic):
        with patch("runner.SIDECAR_DIR", sidecar_dir):
            ok, fail = runner.run_concurrent_backfill(db, pending, concurrency=2)

    elapsed = time.time() - start_time

    assert ok == 4
    assert fail == 0
    # With 2 workers and 4 items taking 0.1s each:
    # Sequential would take >= 0.4s. Concurrent should take < 0.35s.
    assert elapsed < 0.35

    # Verify all marked completed in DB
    completed = db.execute("SELECT count(*) FROM comics WHERE guidedViewStatus='completed'").fetchone()[0]
    assert completed == 4
    db.close()
