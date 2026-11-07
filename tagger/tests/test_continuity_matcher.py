"""Unit tests for tagger_app.continuity.matcher and tagger_app.continuity.util."""
import sqlite3
import pytest
from tagger_app.continuity.db import init_continuity_db, upsert_reading_order, upsert_reading_order_issues
from tagger_app.continuity.util import (
    normalize_series,
    is_issue_in_range,
    expand_publisher_aliases,
    extract_year,
    is_year_compatible,
    is_publisher_compatible,
    extract_issue_number,
    extract_collected_issues,
)
from tagger_app.continuity.matcher import (
    get_story_arcs_with_completeness,
    get_story_arc_detail,
    get_next_continuity_issue,
    find_owned_comic,
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
        {"series_name": "Crisis on Infinite Earths", "issue_number": "1", "position": 1, "part_number": 1, "publication_date": "Apr 1985"},
        {"series_name": "All-Star Squadron", "issue_number": "50", "position": 2, "part_number": 2, "publication_date": "May 1985"},
        {"series_name": "Crisis on Infinite Earths", "issue_number": "2", "position": 3, "part_number": 3, "publication_date": "May 1985"},
    ])

    # Event from 2024
    upsert_reading_order(ro_conn, {
        "id": "dc-ko",
        "title": "DC K.O.",
        "publisher": "DC Comics",
        "issue_count": 1,
    })
    upsert_reading_order_issues(ro_conn, "dc-ko", [
        {"series_name": "Justice League Unlimited", "issue_number": "6", "position": 1, "part_number": 1, "publication_date": "Nov 2024"},
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
                name TEXT,
                series TEXT,
                publisher TEXT,
                metadata TEXT,
                lastReadPage INTEGER DEFAULT 0
            );
            """
        )
        cn_conn.execute(
            """
            INSERT INTO comics (id, name, series, publisher, metadata)
            VALUES
            ('c1', 'Crisis on Infinite Earths (1985) #01.cbz', 'Crisis on Infinite Earths', 'DC Comics', '{"Series": "Crisis on Infinite Earths", "Number": "1", "Year": "1985"}'),
            ('c2', 'Crisis on Infinite Earths (1985) #02.cbz', 'Crisis on Infinite Earths', 'DC Comics', '{"Series": "Crisis on Infinite Earths", "Number": "2", "Year": "1985"}'),
            ('c_jlu_2005', '06 Justice League Unlimited - In the Dimming Light [DC Comics] (2005) #20.cbz', 'Justice League Unlimited', 'DC Comics', '{"Series": "Justice League Unlimited", "Number": "20", "Year": "2005"}');
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


def test_year_compatibility_guard():
    # 2005 comic vs 2024 reading order issue should fail
    assert is_year_compatible(2005, "Nov 2024") is False
    assert is_year_compatible(2005, "2024") is False
    # Same or close year should succeed
    assert is_year_compatible(1985, "Apr 1985") is True
    assert is_year_compatible(2024, "Jan 2025") is True
    # Unknown year should not fail
    assert is_year_compatible(None, "Nov 2024") is True
    assert is_year_compatible(2024, None) is True
    # Reading order overall era window fallback
    assert is_year_compatible(2005, None, ro_era_window=(2024, 2026)) is False
    assert is_year_compatible(2025, None, ro_era_window=(2024, 2026)) is True
    assert is_year_compatible(2026, None, ro_era_window=(2009, 2010)) is False


def test_publisher_compatibility_guard():
    assert is_publisher_compatible("DC Comics", "DC Comics") is True
    assert is_publisher_compatible("Vertigo", "DC Comics") is True
    assert is_publisher_compatible("Marvel", "Marvel Comics") is True
    assert is_publisher_compatible("DC Comics", "Marvel Comics") is False
    assert is_publisher_compatible("Europe Comics", "Marvel Comics") is False
    assert is_publisher_compatible(None, "DC Comics") is True


def test_normalize_series_strips_volume_and_article():
    assert normalize_series("The Amazing Spider-Man") == "amazing spider man"
    assert normalize_series("Batman (Vol. 3)") == "batman"
    assert normalize_series("The Flash Vol 5") == "flash"
    assert normalize_series("Superman (2018)") == "superman"


def test_collected_issues_range_matching():
    summary_v3 = "Collects Batman/Superman: World’s Finest (2022) issues 12 – 17."
    range_v3 = extract_collected_issues(summary_v3)
    assert range_v3 == (12.0, 17.0)
    # Lazarus planet has issues 1-6 -> should NOT match
    assert is_issue_in_range("3", "1-6", collected_range=range_v3) is False

    summary_v1 = "Collects issues 1-5."
    range_v1 = extract_collected_issues(summary_v1)
    assert range_v1 == (1.0, 5.0)
    # Lazarus planet has issues 1-6 -> should match!
    assert is_issue_in_range("1", "1-6", collected_range=range_v1) is True



def test_extract_issue_number():
    # Ignore leading track number and grab explicit '#20'
    name1 = "06 Justice League Unlimited - In the Dimming Light [DC Comics] (2005) #20.cbz"
    assert extract_issue_number(name1) == "20"

    # Explicit metadata number takes priority
    assert extract_issue_number(name1, meta_number="20") == "20"

    # Unnumbered title without '#'
    name2 = "01 Absolute Power Omnibus [DC Comics] (2026).cbz"
    assert extract_issue_number(name2) == ""


def test_false_positive_rejection_for_jlu_2005(mock_dbs):
    # JLU #6 in DC K.O. (2024) must NOT match JLU (2005) #20
    jlu_issue_2024 = {
        "series_name": "Justice League Unlimited",
        "issue_number": "6",
        "publication_date": "Nov 2024"
    }
    direct_map = {
        "justice league unlimited:::20": {
            "id": "c_jlu_2005",
            "issueNum": "20",
            "year": 2005,
            "normSeries": "justice league unlimited",
            "normNum": "20"
        }
    }
    series_map = {
        "justice league unlimited": [direct_map["justice league unlimited:::20"]]
    }
    match = find_owned_comic(jlu_issue_2024, direct_map, series_map)
    assert match is None, "Justice League Unlimited (2005) #20 was falsely matched to DC K.O. (2024) issue #6!"


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
    assert len(arcs) == 2
    crisis = [a for a in arcs if a["id"] == "crisis-on-infinite-earths"][0]
    assert crisis["totalIssues"] == 3
    assert crisis["ownedCount"] == 2
    assert crisis["missingCount"] == 1
    assert crisis["completenessPercent"] == 66.7

    # DC K.O. has 0 owned because JLU 2005 is not a match!
    dcko = [a for a in arcs if a["id"] == "dc-ko"][0]
    assert dcko["ownedCount"] == 0


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
