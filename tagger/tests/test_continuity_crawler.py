"""Unit tests for tagger_app.continuity.crawler."""
import sqlite3
import pytest
from unittest.mock import MagicMock
from tagger_app.continuity.db import init_continuity_db, get_order_count
from tagger_app.continuity.crawler import ContinuityCrawler


@pytest.fixture
def memory_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_continuity_db(conn)
    return conn


def test_crawler_initial_state(memory_db):
    crawler = ContinuityCrawler(db_conn=memory_db)
    status = crawler.get_status()
    assert status["status"] == "idle"
    assert status["isSyncing"] is False
    assert status["progress"]["current"] == 0


def test_crawler_skip_when_sitemap_304(memory_db, monkeypatch):
    crawler = ContinuityCrawler(db_conn=memory_db)
    crawler._fetch_sitemap_headers = MagicMock(return_value={"status": 304, "etag": '"test-etag"'})
    crawler.last_sitemap_etag = '"test-etag"'
    crawler.get_order_count = MagicMock(return_value=200)

    result = crawler.start_sync(mode="both", force=False, run_async=False)
    assert result["skipped"] is True
    assert crawler.get_status()["status"] == "idle"


def test_crawler_concurrent_guard(memory_db):
    crawler = ContinuityCrawler(db_conn=memory_db)
    crawler.is_syncing = True
    with pytest.raises(RuntimeError, match="already in progress"):
        crawler.start_sync()


def test_crawler_cancel_flag(memory_db):
    crawler = ContinuityCrawler(db_conn=memory_db)
    crawler.is_syncing = True
    crawler.cancel_sync()
    assert crawler.is_cancelled is True
