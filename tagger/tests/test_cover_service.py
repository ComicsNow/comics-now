"""Unit tests for tagger_app.continuity.cover_service."""
import sqlite3
import pytest
from pathlib import Path
from PIL import Image
import imagehash
from tagger_app.continuity.cover_service import (
    sanitize_filename_from_url,
    download_and_hash_cover,
    backfill_missing_covers,
)


def test_sanitize_filename_from_url():
    assert sanitize_filename_from_url("https://readingorders.com/images/issues/4176.png") == "issue_4176.png"
    assert sanitize_filename_from_url("https://readingorders.com/images/collections/1182.png") == "collection_1182.png"
    assert sanitize_filename_from_url("https://www.readingorders.com/images/issues/999.jpg") == "issue_999.jpg"


def test_download_and_hash_cover_cached_file(tmp_path):
    covers_dir = tmp_path / "covers"
    covers_dir.mkdir()

    # Create dummy image on disk
    img_path = covers_dir / "issue_100.png"
    img = Image.new("RGB", (100, 150), color=(73, 109, 137))
    img.save(img_path)

    url = "https://readingorders.com/images/issues/100.png"
    returned_url, h, was_cached = download_and_hash_cover(url, dest_dir=covers_dir)

    assert returned_url == url
    assert h is not None
    assert len(h) == 16  # 64-bit hex hash
    assert was_cached is True


def test_backfill_missing_covers_mock_db(tmp_path):
    covers_dir = tmp_path / "covers"
    covers_dir.mkdir()

    img_path = covers_dir / "issue_200.png"
    img = Image.new("RGB", (100, 150), color=(200, 50, 50))
    img.save(img_path)

    db_path = tmp_path / "test_ro.db"
    conn = sqlite3.connect(str(db_path))
    with conn:
        conn.execute(
            """
            CREATE TABLE reading_order_issues (
                id INTEGER PRIMARY KEY,
                cover_image_url TEXT,
                cover_hash TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE reading_order_collections (
                id TEXT PRIMARY KEY,
                cover_image_url TEXT,
                cover_hash TEXT
            )
            """
        )
        conn.execute(
            "INSERT INTO reading_order_issues (id, cover_image_url) VALUES (1, 'https://readingorders.com/images/issues/200.png')"
        )
    conn.close()

    res = backfill_missing_covers(ro_db_path=db_path, covers_dir=covers_dir, max_workers=2)
    assert res["total"] == 1
    assert res["saved"] == 1

    conn = sqlite3.connect(str(db_path))
    row = conn.execute("SELECT cover_hash FROM reading_order_issues WHERE id = 1").fetchone()
    assert row[0] is not None
    assert len(row[0]) == 16
    conn.close()
