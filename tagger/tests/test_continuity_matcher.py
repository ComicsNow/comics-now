"""Unit tests for tagger_app.continuity.matcher."""
import sqlite3
import pytest
from tagger_app.continuity.db import init_continuity_db, upsert_reading_order, upsert_reading_order_issues
from tagger_app.continuity.matcher import (
    normalize_series,
    is_issue_in_range,
    expand_publisher_aliases,
    get_story_arcs_with_completeness,
    get_story_arc_detail,
    get_next_continuity_issue,
)


@pytest.fixture
def mock_dbs(tmp_path):
    # 1. Reading Orders DB
    ro_path = tmp_path / "reading-orders.db"
    ro_conn = sqlite3.connect(str(ro_path))
    ro_conn.row_factory = sqlite3.Row
    init_continuity_db(ro_conn)

    upsert_reading_order(ro_conn, {
        "id": "crisis-on-infinite-earths",
        "title": "Crisis on Infinite Earths",
        "publisher": "DC Comics",
        "issue_count": 3,
    })
    upsert_reading_order_issues(ro_conn, "crisis-on-infinite-earths", [
        {"series_name": "Crisis on Infinite Earths", "issue_number": "1", "position": 1, "part_number": 1},
        {"series_name": "All-Star Squadron", "issue_number": "50", "position": 2, "part_number": 2},
        {"series_name": "Crisis on Infinite Earths", "issue_number": "2", "position": 3, "part_number": 3},
    ])
    ro_conn.close()

    # 2. Comics Now DB (library)
    cn_path = tmp_path / "comics-now.db"
    cn_conn = sqlite3.connect(str(cn_path))
    cn_conn.row_factory = sqlite3.Row
    with cn_conn:
        cn_conn.executescript(
            """
            CREATE TABLE comics (
                id TEXT PRIMARY KEY,
                title TEXT,
                series TEXT,
                publisher TEXT,
                metadata TEXT,
                lastReadPage INTEGER DEFAULT 0
            );
            """
        )
        cn_conn.execute(
            """
            INSERT INTO comics (id, title, series, publisher, metadata)
            VALUES
            ('c1', 'Crisis #1', 'Crisis on Infinite Earths', 'DC Comics', '{"Series": "Crisis on Infinite Earths", "Number": "1"}'),
            ('c2', 'Crisis #2', 'Crisis on Infinite Earths', 'DC Comics', '{"Series": "Crisis on Infinite Earths", "Number": "2"}');
            """
        )
    cn_conn.close()

    return {"ro_path": str(ro_path), "cn_path": str(cn_path)}


def test_normalize_series():
    assert normalize_series("Crisis on Infinite Earths (1985)") == "crisis on infinite earths"
    assert normalize_series("Civil War: Front Line") == "front line"
    assert normalize_series("Batman/Superman: World's Finest") == "batman superman world's finest"


def test_is_issue_in_range():
    assert is_issue_in_range("1", "1") is True
    assert is_issue_in_range("2", "1-5") is True
    assert is_issue_in_range("6", "1-5") is False
    assert is_issue_in_range("1.5", "1.5") is True


def test_expand_publisher_aliases():
    dc_aliases = expand_publisher_aliases("DC Comics")
    assert "DC" in dc_aliases
    assert "Vertigo" in dc_aliases
    assert "Black Label" in dc_aliases

    marvel_aliases = expand_publisher_aliases("Marvel Comics")
    assert "Marvel" in marvel_aliases
    assert "MAX" in marvel_aliases


def test_get_story_arcs_with_completeness(mock_dbs):
    arcs = get_story_arcs_with_completeness(
        comics_now_db_path=mock_dbs["cn_path"],
        reading_orders_db_path=mock_dbs["ro_path"],
    )
    assert len(arcs) == 1
    arc = arcs[0]
    assert arc["id"] == "crisis-on-infinite-earths"
    assert arc["totalCount"] == 3
    assert arc["ownedCount"] == 2
    assert arc["missingCount"] == 1
    assert arc["completenessPercent"] == 67


def test_get_story_arc_detail(mock_dbs):
    detail = get_story_arc_detail(
        "crisis-on-infinite-earths",
        comics_now_db_path=mock_dbs["cn_path"],
        reading_orders_db_path=mock_dbs["ro_path"],
    )
    assert detail is not None
    assert len(detail["issues"]) == 3
    assert detail["issues"][0]["owned"] is True
    assert detail["issues"][0]["comicId"] == "c1"
    assert detail["issues"][1]["owned"] is False
    assert detail["issues"][1]["comicId"] is None


def test_get_next_continuity_issue(mock_dbs):
    # From issue 1 ('c1'), next chronological issue in arc is All-Star Squadron #50 (missing)
    next_info = get_next_continuity_issue(
        "c1",
        comics_now_db_path=mock_dbs["cn_path"],
        reading_orders_db_path=mock_dbs["ro_path"],
    )
    assert next_info is not None
    assert next_info["arcTitle"] == "Crisis on Infinite Earths"
    assert next_info["nextIssue"]["seriesName"] == "All-Star Squadron"
    assert next_info["nextIssue"]["issueNumber"] == "50"
    assert next_info["nextIssue"]["owned"] is False
