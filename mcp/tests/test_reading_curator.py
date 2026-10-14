import pytest
import sqlite3
import json
from unittest.mock import patch, MagicMock

from comics_mcp import reading_curator
from comics_mcp import reading_orders_cache


def test_cache_save_and_load(tmp_path):
    with patch("comics_mcp.reading_orders_cache.CACHE_DIR", tmp_path):
        sample_order = {
            "title": "Batman: Knightfall",
            "source": "comicbookreadingorders.com",
            "items": [
                {"step": 1, "series": "Batman", "issue": "484"},
                {"step": 2, "series": "Batman", "issue": "485"}
            ]
        }
        slug = reading_orders_cache.save_order("Batman: Knightfall", sample_order)
        assert slug == "batman-knightfall"
        
        loaded = reading_orders_cache.get_cached_order("Batman: Knightfall")
        assert loaded is not None
        assert loaded["title"] == "Batman: Knightfall"
        assert len(loaded["items"]) == 2

        # Non-existent order
        assert reading_orders_cache.get_cached_order("Nonexistent Event") is None


def test_constraint_min_three_comics():
    # Only 2 comics matched
    items = [
        {"id": "c1", "series": "Batman", "name": "Batman #491.cbz", "publisher": "DC Comics"},
        {"id": "c2", "series": "Detective Comics", "name": "Detective Comics #659.cbz", "publisher": "DC Comics"},
    ]
    is_valid, reason = reading_curator.validate_candidate_list("Knightfall", items)
    assert not is_valid
    assert "at least 3 comics" in reason.lower()

    # 3 comics matched
    items.append({"id": "c3", "series": "Robin", "name": "Robin #1.cbz", "publisher": "DC Comics"})
    is_valid, reason = reading_curator.validate_candidate_list("Knightfall", items)
    assert is_valid


def test_constraint_reject_single_series():
    # 3 comics, but all from same series
    items = [
        {"id": "c1", "series": "Animal Castle", "name": "01 Animal Castle.cbz", "publisher": "Ablaze"},
        {"id": "c2", "series": "Animal Castle", "name": "02 Animal Castle.cbz", "publisher": "Ablaze"},
        {"id": "c3", "series": "Animal Castle", "name": "03 Animal Castle.cbz", "publisher": "Ablaze"},
    ]
    is_valid, reason = reading_curator.validate_candidate_list("Animal Castle Run", items)
    assert not is_valid
    assert "single series" in reason.lower() or "same series" in reason.lower()

    # Multi-series across 2 series
    items[2]["series"] = "Animal Castle: Special"
    is_valid, reason = reading_curator.validate_candidate_list("Animal Castle Saga", items)
    assert is_valid


def test_constraint_cross_publisher_allowed():
    items = [
        {"id": "c1", "series": "Batman", "name": "Batman #1.cbz", "publisher": "DC Comics"},
        {"id": "c2", "series": "Spider-Man", "name": "Spider-Man #1.cbz", "publisher": "Marvel Comics"},
        {"id": "c3", "series": "Spawn", "name": "Spawn #1.cbz", "publisher": "Image Comics"},
    ]
    is_valid, reason = reading_curator.validate_candidate_list("Crossover Event", items)
    assert is_valid
    assert len(set(c["publisher"] for c in items)) == 3


def test_omnibus_issue_range_matching():
    # An omnibus covering issues #491-497
    comic = {
        "id": "omni_1",
        "series": "Batman: Knightfall",
        "name": "Batman - Knightfall Vol. 1 (2012) (Batman 491-497, Detective 659-663).cbz",
        "publisher": "DC Comics"
    }
    
    # Check if this comic matches step "Batman #492"
    matches = reading_curator.comic_matches_step(comic, series="Batman", issue="492")
    assert matches

    # Check if this comic matches step "Detective Comics #660"
    matches_tec = reading_curator.comic_matches_step(comic, series="Detective Comics", issue="660")
    assert matches_tec

    # Should NOT match Batman #505
    assert not reading_curator.comic_matches_step(comic, series="Batman", issue="505")


def test_recent_delta_filtering(tmp_path):
    db_file = str(tmp_path / "test.db")
    conn = sqlite3.connect(db_file)
    conn.execute("""
        CREATE TABLE comics (
            id TEXT PRIMARY KEY,
            publisher TEXT,
            series TEXT,
            name TEXT,
            updatedAt INTEGER
        );
    """)
    now_ms = 1700000000000
    one_month_ago = now_ms - (30 * 86400 * 1000)
    six_months_ago = now_ms - (180 * 86400 * 1000)

    # 1 recent comic (15 days old)
    conn.execute("INSERT INTO comics VALUES ('c1', 'DC', 'Batman', 'Batman #1.cbz', ?)", (now_ms - 15 * 86400 * 1000,))
    # 1 comic (2 months old)
    conn.execute("INSERT INTO comics VALUES ('c2', 'DC', 'Batman', 'Batman #2.cbz', ?)", (now_ms - 60 * 86400 * 1000,))
    # 1 ancient comic (1 year old)
    conn.execute("INSERT INTO comics VALUES ('c3', 'DC', 'Batman', 'Batman #3.cbz', ?)", (now_ms - 365 * 86400 * 1000,))
    conn.commit()
    conn.close()

    with patch("comics_mcp.reading_curator.get_db_path", return_value=db_file):
        # 1 month window
        recent_1m = reading_curator.get_recent_comics(months=1, reference_now_ms=now_ms)
        assert len(recent_1m) == 1
        assert recent_1m[0]["id"] == "c1"

        # 3 month window
        recent_3m = reading_curator.get_recent_comics(months=3, reference_now_ms=now_ms)
        assert len(recent_3m) == 2
