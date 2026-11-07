"""Tests for Reading Order Collections matching and publisher scoping in Continuity Batch Tagger."""
import sqlite3
import pytest
from pathlib import Path
from tagger_app.continuity.db import init_continuity_db, upsert_reading_order
from tagger_app.continuity.batch_tagger import ContinuityBatchTagger
from tagger_app.continuity.util import (
    normalize_series,
    expand_publisher_aliases,
    get_supported_publishers,
)


def test_normalize_series_strips_editions_and_formats():
    assert normalize_series("Flashpoint Deluxe") == "flashpoint"
    assert normalize_series("Flashpoint Deluxe Edition") == "flashpoint"
    assert normalize_series("Crisis On Infinite Earths: 35th Anniversary Deluxe Edition") == "crisis on infinite earths"
    assert normalize_series("Dark Nights: Death Metal: Deluxe Edition") == "dark nights death metal"
    assert normalize_series("Knight Terrors - HC") == "knight terrors"
    assert normalize_series("Batman: Urban Legends - Vol. 2") == "batman urban legends"
    assert normalize_series("Absolute Power Omnibus") == "absolute power"
    assert normalize_series("Crisis on Infinite Earths Companion") == "crisis on infinite earths"


def test_expand_publisher_aliases_includes_imprints():
    dc_aliases = expand_publisher_aliases("DC Comics")
    assert "DC" in dc_aliases
    assert "DC Comics" in dc_aliases
    assert "Vertigo" in dc_aliases
    assert "WildStorm" in dc_aliases
    assert "Black Label" in dc_aliases
    assert "Amalgam Comics" in dc_aliases

    marvel_aliases = expand_publisher_aliases("Marvel Comics")
    assert "Marvel" in marvel_aliases
    assert "Marvel Comics" in marvel_aliases
    assert "Icon" in marvel_aliases or "Icon Comics" in marvel_aliases


@pytest.fixture
def mock_ro_db_with_collections(tmp_path):
    ro_path = tmp_path / "reading-orders.db"
    ro_conn = sqlite3.connect(str(ro_path))
    ro_conn.row_factory = sqlite3.Row
    init_continuity_db(ro_conn)

    upsert_reading_order(ro_conn, {
        "id": "knight-terrors",
        "title": "Knight Terrors Reading Order",
        "publisher": "DC Comics",
        "total_issues": 0,
        "total_collections": 3,
    })

    ro_conn.execute(
        """
        INSERT INTO reading_order_collections (id, reading_order_id, position, title, subtitle, release_year)
        VALUES 
            ('c1', 'knight-terrors', 1, 'Knight Terrors', 'Deadman leads fight', 2024),
            ('c2', 'knight-terrors', 2, 'Knight Terrors', 'Omnibus', 2025),
            ('c3', 'knight-terrors', 3, 'Knight Terrors', 'Dark Knightmares', 2024),
            ('c4', 'knight-terrors', 4, 'Knight Terrors', 'Knightmare League', 2024)
        """
    )

    upsert_reading_order(ro_conn, {
        "id": "civil-war",
        "title": "Civil War Reading Order",
        "publisher": "Marvel Comics",
        "total_issues": 0,
        "total_collections": 1,
    })

    ro_conn.commit()
    ro_conn.close()
    return str(ro_path)


def test_get_supported_publishers(mock_ro_db_with_collections):
    pubs = get_supported_publishers(mock_ro_db_with_collections)
    # Must include DC and Marvel families
    assert "DC Comics" in pubs
    assert "Marvel Comics" in pubs
    assert "Vertigo" in pubs


def test_batch_tagger_scopes_only_supported_publishers_and_matches_collections(tmp_path, mock_ro_db_with_collections):
    import zipfile

    # Setup mock comics
    cbz_dc = tmp_path / "Knight Terrors Dark Knightmares.cbz"
    with zipfile.ZipFile(cbz_dc, "w") as zf:
        zf.writestr("001.jpg", b"fake image bytes")

    cbz_europe = tmp_path / "Thorgal #1.cbz"
    with zipfile.ZipFile(cbz_europe, "w") as zf:
        zf.writestr("001.jpg", b"fake image bytes")

    cn_path = tmp_path / "comics-now.db"
    cn_conn = sqlite3.connect(str(cn_path))
    with cn_conn:
        cn_conn.execute(
            """
            CREATE TABLE comics (
                id TEXT PRIMARY KEY,
                name TEXT,
                series TEXT,
                publisher TEXT,
                path TEXT,
                metadata TEXT
            )
            """
        )
        # DC Comic that matches a collection
        cn_conn.execute(
            """
            INSERT INTO comics (id, name, series, publisher, path, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "c_kt",
                "01 Knight Terrors: Dark Knightmares - HC [DC Comics] (2023) #332.cbz",
                "Knight Terrors: Dark Knightmares",
                "DC Comics",
                str(cbz_dc),
                '{"Year": 2023}',
            ),
        )
        # Europe comic that must be ignored
        cn_conn.execute(
            """
            INSERT INTO comics (id, name, series, publisher, path, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "c_eu",
                "01 Thorgal - The Child of the Stars [Europe Comics] (2000).cbz",
                "Thorgal",
                "Europe Comics",
                str(cbz_europe),
                '{"Year": 2000}',
            ),
        )
    cn_conn.close()

    tagger = ContinuityBatchTagger(cn_db_path=str(cn_path), ro_db_path=mock_ro_db_with_collections)
    res = tagger.start_batch_tag(target_publisher="all", run_async=False, dry_run=True)

    assert res.get("completed") is True
    # Only 1 candidate comic should be inspected (the DC one); Europe Comics should be omitted!
    assert res["progress"]["total"] == 1
    assert res["progress"]["updated"] == 1

    results = tagger.get_dry_run_results()
    assert len(results) == 1
    assert results[0]["matchedArc"] == "Knight Terrors"
    assert results[0]["storyArcNumber"] == "3"
