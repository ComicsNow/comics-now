"""Unit tests for tagger_app.continuity.db."""
import sqlite3
import pytest
from tagger_app.continuity.db import (
    init_continuity_db,
    upsert_reading_order,
    upsert_reading_order_issues,
    upsert_reading_order_collections,
    get_order_count,
    get_sitemap_etag,
    set_sitemap_etag,
    list_reading_orders,
    get_reading_order,
)


@pytest.fixture
def memory_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_continuity_db(conn)
    yield conn
    conn.close()


def test_init_db_creates_expected_tables(memory_db):
    cursor = memory_db.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row["name"] for row in cursor.fetchall()}
    assert "reading_orders" in tables
    assert "reading_order_issues" in tables
    assert "reading_order_collections" in tables
    assert "reading_order_meta" in tables


def test_upsert_reading_order_and_count(memory_db):
    assert get_order_count(memory_db) == 0
    upsert_reading_order(memory_db, {
        "id": "crisis-on-infinite-earths",
        "title": "Crisis on Infinite Earths",
        "publisher": "DC Comics",
        "description": "The landmark multiverse crossover.",
        "url": "https://readingorders.com/reading-order/crisis-on-infinite-earths",
        "issue_count": 12,
    })
    assert get_order_count(memory_db) == 1

    order = get_reading_order(memory_db, "crisis-on-infinite-earths")
    assert order is not None
    assert order["title"] == "Crisis on Infinite Earths"
    assert order["publisher"] == "DC Comics"


def test_upsert_issues_and_collections(memory_db):
    upsert_reading_order(memory_db, {
        "id": "test-arc",
        "title": "Test Arc",
        "publisher": "Marvel Comics",
        "issue_count": 2,
    })
    upsert_reading_order_issues(memory_db, "test-arc", [
        {"series_name": "Avengers", "issue_number": "1", "position": 1, "part_number": 1},
        {"series_name": "Avengers", "issue_number": "2", "position": 2, "part_number": 2},
    ])
    upsert_reading_order_collections(memory_db, "test-arc", [
        {"title": "Test Arc Omnibus", "volume_number": "Vol 1", "position": 1},
    ])

    order = get_reading_order(memory_db, "test-arc", include_issues=True)
    assert len(order["issues"]) == 2
    assert order["issues"][0]["series_name"] == "Avengers"
    assert len(order["collections"]) == 1
    assert order["collections"][0]["title"] == "Test Arc Omnibus"


def test_etag_tracking(memory_db):
    assert get_sitemap_etag(memory_db) is None
    set_sitemap_etag(memory_db, '"test-etag-123"')
    assert get_sitemap_etag(memory_db) == '"test-etag-123"'


def test_list_reading_orders_filters(memory_db):
    upsert_reading_order(memory_db, {"id": "dc-arc", "title": "DC Event", "publisher": "DC Comics"})
    upsert_reading_order(memory_db, {"id": "marvel-arc", "title": "Marvel Event", "publisher": "Marvel Comics"})

    all_orders = list_reading_orders(memory_db)
    assert len(all_orders) == 2

    dc_orders = list_reading_orders(memory_db, publisher="DC Comics")
    assert len(dc_orders) == 1
    assert dc_orders[0]["id"] == "dc-arc"

    search_orders = list_reading_orders(memory_db, search="Event")
    assert len(search_orders) == 2
