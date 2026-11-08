"""Unit tests for Collection Completeness and Story Arc Edition splitting."""
import sqlite3
import pytest
from pathlib import Path

from tagger_app.continuity.db import init_continuity_db, upsert_reading_order
from tagger_app.continuity.collection_completeness import (
    find_owned_collection,
    calculate_collection_completeness,
    enrich_arc_collections,
)
from tagger_app.continuity.matcher import (
    get_story_arcs_with_completeness,
    get_story_arc_detail,
)


def _setup_test_dbs(tmp_path):
    ro_path = tmp_path / "ro_test.db"
    ro_conn = sqlite3.connect(str(ro_path))
    ro_conn.row_factory = sqlite3.Row
    init_continuity_db(ro_conn)

    upsert_reading_order(ro_conn, {
        "id": "absolute-universe",
        "title": "Absolute Universe Reading Order",
        "publisher": "DC Comics",
        "description": "The DC Absolute Universe continuity.",
        "cover_image": "https://example.com/cover.jpg",
        "issue_count": 2,
    })

    # Add 2 issues
    ro_conn.execute(
        """
        INSERT INTO reading_order_issues (
            reading_order_id, position, series_name, issue_number, publication_date
        ) VALUES 
            ('absolute-universe', 1, 'DC All In Special', '1', '2024-10-02'),
            ('absolute-universe', 2, 'Absolute Batman', '1', '2024-10-09')
        """
    )

    # Add 2 collections
    ro_conn.execute(
        """
        INSERT INTO reading_order_collections (
            id, reading_order_id, position, title, subtitle, release_year, cover_image_url
        ) VALUES 
            ('col_1', 'absolute-universe', 1, 'Absolute Batman: Volume 1', 'The Zoo', 2025, 'https://example.com/c1.jpg'),
            ('col_2', 'absolute-universe', 2, 'Absolute Martian Manhunter: Volume 1', 'Martian Vision', 2025, 'https://example.com/c2.jpg')
        """
    )
    ro_conn.commit()
    ro_conn.close()

    cn_path = tmp_path / "cn_test.db"
    cn_conn = sqlite3.connect(str(cn_path))
    cn_conn.execute(
        """
        CREATE TABLE comics (
            id TEXT PRIMARY KEY,
            name TEXT,
            series TEXT,
            publisher TEXT,
            metadata TEXT,
            pageCount INTEGER DEFAULT 160,
            lastReadPage INTEGER DEFAULT 0
        )
        """
    )
    cn_conn.execute(
        """
        CREATE TABLE user_comic_status (
            userId TEXT,
            comicId TEXT,
            lastReadPage INTEGER,
            totalPages INTEGER,
            PRIMARY KEY (userId, comicId)
        )
        """
    )

    # Comic 1: Owned collection #2 (Martian Manhunter), finished reading (readStatus = 'read')
    cn_conn.execute(
        """
        INSERT INTO comics (id, name, series, publisher, metadata, pageCount, lastReadPage)
        VALUES ('c_mm_1', 'Absolute Martian Manhunter Vol 1.cbz', 'Absolute Martian Manhunter', 'DC Comics', 
                '{"StoryArc": "Absolute Universe", "StoryArcNumber": "2", "Volume": "1"}', 160, 160)
        """
    )
    cn_conn.execute(
        "INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages) VALUES ('default-user', 'c_mm_1', 160, 160)"
    )

    # Comic 2: Owned single issue #1 (DC All In Special), currently reading (readStatus = 'reading')
    cn_conn.execute(
        """
        INSERT INTO comics (id, name, series, publisher, metadata, pageCount, lastReadPage)
        VALUES ('c_all_in', 'DC All In Special #1.cbz', 'DC All In Special', 'DC Comics', 
                '{"Number": "1", "Year": 2024}', 64, 25)
        """
    )
    cn_conn.execute(
        "INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages) VALUES ('default-user', 'c_all_in', 25, 64)"
    )

    cn_conn.commit()
    cn_conn.close()

    return str(ro_path), str(cn_path)


def test_find_owned_collection_by_story_arc_tag(tmp_path):
    ro_p, cn_p = _setup_test_dbs(tmp_path)
    from tagger_app.continuity.matcher import _load_library_comics
    direct_map, series_map, by_id, arc_tagged_map = _load_library_comics(cn_p)

    col = {
        "id": "col_2",
        "position": 2,
        "title": "Absolute Martian Manhunter: Volume 1",
        "subtitle": "Martian Vision",
    }
    match = find_owned_collection(col, direct_map, series_map, arc_tagged_map, "Absolute Universe")
    assert match is not None
    assert match["id"] == "c_mm_1"
    assert match["readStatus"] == "read"


def test_calculate_collection_completeness(tmp_path):
    ro_p, cn_p = _setup_test_dbs(tmp_path)
    from tagger_app.continuity.matcher import _load_library_comics
    direct_map, series_map, by_id, arc_tagged_map = _load_library_comics(cn_p)

    ro_conn = sqlite3.connect(ro_p)
    ro_conn.row_factory = sqlite3.Row

    res = calculate_collection_completeness(
        ro_conn,
        "absolute-universe",
        "Absolute Universe",
        direct_map,
        series_map,
        arc_tagged_map,
    )
    ro_conn.close()

    assert res["totalCollections"] == 2
    assert res["ownedCount"] == 1
    assert res["missingCount"] == 1
    assert res["readCount"] == 1
    assert res["completenessPercent"] == 50.0
    assert res["readPercent"] == 50.0


def test_get_story_arcs_with_completeness_edition_modes(tmp_path):
    ro_p, cn_p = _setup_test_dbs(tmp_path)

    # 1. Issues edition only
    issue_arcs = get_story_arcs_with_completeness(
        comics_now_db_path=cn_p,
        reading_orders_db_path=ro_p,
        edition="issues",
    )
    assert len(issue_arcs) == 1
    assert issue_arcs[0]["edition"] == "issue"
    assert issue_arcs[0]["totalIssues"] == 2
    assert issue_arcs[0]["ownedCount"] == 1  # DC All In Special #1
    assert issue_arcs[0]["readStatusCounts"]["reading"] == 1

    # 2. Collections edition only
    col_arcs = get_story_arcs_with_completeness(
        comics_now_db_path=cn_p,
        reading_orders_db_path=ro_p,
        edition="collections",
    )
    assert len(col_arcs) == 1
    assert col_arcs[0]["edition"] == "collection"
    assert col_arcs[0]["totalCollections"] == 2
    assert col_arcs[0]["ownedCount"] == 1  # Absolute Martian Manhunter Vol 1
    assert col_arcs[0]["readStatusCounts"]["read"] == 1

    # 3. Both editions
    both_arcs = get_story_arcs_with_completeness(
        comics_now_db_path=cn_p,
        reading_orders_db_path=ro_p,
        edition="both",
    )
    assert len(both_arcs) == 2
    editions = {a["edition"] for a in both_arcs}
    assert editions == {"issue", "collection"}


def test_get_story_arc_detail_enriches_read_status(tmp_path):
    ro_p, cn_p = _setup_test_dbs(tmp_path)
    detail = get_story_arc_detail("absolute-universe", comics_now_db_path=cn_p, reading_orders_db_path=ro_p)

    assert detail is not None
    # Issue 1 is owned and reading
    iss_1 = detail["issues"][0]
    assert iss_1["owned"] is True
    assert iss_1["readStatus"] == "reading"

    # Issue 2 is missing
    iss_2 = detail["issues"][1]
    assert iss_2["owned"] is False
    assert iss_2["readStatus"] == "missing"

    # Collection 2 is owned and read
    col_2 = next(c for c in detail["collections"] if c["position"] == 2)
    assert col_2["owned"] is True
    assert col_2["readStatus"] == "read"
    assert col_2["comicId"] == "c_mm_1"


def test_extract_volume_number_formats():
    from tagger_app.continuity.three_gate_matcher import extract_volume_number

    assert extract_volume_number("Absolute Batman v01 - The Zoo (2025)") == 1
    assert extract_volume_number("Batman v02 (2024)") == 2
    assert extract_volume_number("Flash v3") == 3
    assert extract_volume_number("Wonder Woman v.01") == 1
    assert extract_volume_number("Superman v 04") == 4
    assert extract_volume_number("Vol. 5: Test") == 5
    assert extract_volume_number("Volume 6") == 6
    assert extract_volume_number("Book 7") == 7


def test_find_owned_collection_absolute_batman_and_false_positive_prevention(tmp_path):
    from tagger_app.continuity.library_store import _load_library_comics

    cn_path = tmp_path / "cn_batman.db"
    conn = sqlite3.connect(str(cn_path))
    conn.execute(
        """
        CREATE TABLE comics (
            id TEXT PRIMARY KEY,
            name TEXT,
            series TEXT,
            publisher TEXT,
            metadata TEXT,
            pageCount INTEGER DEFAULT 160,
            lastReadPage INTEGER DEFAULT 0
        )
        """
    )
    # Comic A: Absolute Batman v01 - The Zoo
    conn.execute(
        """
        INSERT INTO comics (id, name, series, publisher, metadata, pageCount, lastReadPage)
        VALUES ('c_ab_1', 'Absolute Batman v01 - The Zoo (2025).cbz', 'Absolute Batman', 'DC Comics',
                '{"Number": "1", "Volume": "1", "Title": "Vol. 1: The Zoo", "Year": 2025}', 192, 0)
        """
    )
    # Comic B: Main continuity Batman Vol 3 (must NOT match Absolute Batman Vol 3)
    conn.execute(
        """
        INSERT INTO comics (id, name, series, publisher, metadata, pageCount, lastReadPage)
        VALUES ('c_bm_3', 'Batman Vol. 3: The Joker Year One (2024).cbz', 'Batman', 'DC Comics',
                '{"Volume": "3", "Year": 2024}', 160, 0)
        """
    )
    # Comic C: Standalone TPB Batman: Cataclysm
    conn.execute(
        """
        INSERT INTO comics (id, name, series, publisher, metadata, pageCount, lastReadPage)
        VALUES ('c_cataclysm', 'Batman: Cataclysm - Cataclysm (1999).cbz', 'Batman: Cataclysm', 'DC Comics',
                '{"Year": 1999}', 460, 0)
        """
    )
    conn.commit()
    conn.close()

    direct_map, series_map, by_id, arc_tagged_map = _load_library_comics(cn_path)

    # 1. Absolute Batman Vol 1 should match c_ab_1
    col_1 = {
        "id": "col_ab_1",
        "position": 1,
        "title": "Absolute Batman: Volume 1",
        "subtitle": "The Zoo",
        "release_year": 2025,
    }
    match_1 = find_owned_collection(col_1, direct_map, series_map, arc_tagged_map, "Absolute Universe")
    assert match_1 is not None
    assert match_1["id"] == "c_ab_1"

    # 2. Absolute Batman Vol 3 should NOT match c_bm_3 (false positive prevention)
    col_3 = {
        "id": "col_ab_3",
        "position": 3,
        "title": "Absolute Batman: Volume 3",
        "subtitle": "Devil's Workshop",
        "release_year": 2026,
    }
    match_3 = find_owned_collection(col_3, direct_map, series_map, arc_tagged_map, "Absolute Universe")
    assert match_3 is None

    # 3. Standalone TPB Cataclysm should match c_cataclysm
    col_cataclysm = {
        "id": "col_cat",
        "position": 1,
        "title": "Batman: Cataclysm",
        "subtitle": "A massive earthquake devastates Gotham",
        "release_year": 1999,
    }
    match_cat = find_owned_collection(col_cataclysm, direct_map, series_map, arc_tagged_map, "Batman: No Mans Land")
    assert match_cat is not None
    assert match_cat["id"] == "c_cataclysm"

