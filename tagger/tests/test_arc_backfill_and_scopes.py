"""Tests for <StoryArcs> XML serialization, retrospective DB backfill, and incremental scopes."""
import json
import sqlite3
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from tagger_app.continuity.arc_backfill import merge_story_arcs_meta
from tagger_app.continuity.batch_tagger import ContinuityBatchTagger
from tagger_app.continuity.cluster_builder import load_all_publisher_comics, load_all_reading_orders
from tagger_app.core.comicinfo import generate_comic_info_xml, read_comic_info_xml


def _make_cbz(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("001.jpg", b"fake-img")


def _create_test_dbs(tmp_path: Path):
    ro_db = tmp_path / "reading-orders.db"
    cn_db = tmp_path / "comics-now.db"

    ro_conn = sqlite3.connect(ro_db)
    ro_conn.execute(
        "CREATE TABLE reading_orders (id TEXT PRIMARY KEY, title TEXT, publisher TEXT, description TEXT, scraped_at INTEGER)"
    )
    ro_conn.execute(
        "CREATE TABLE reading_order_collections (id INTEGER PRIMARY KEY, reading_order_id TEXT, position INTEGER, title TEXT, subtitle TEXT, release_year INTEGER, contents_raw TEXT)"
    )
    ro_conn.execute(
        "CREATE TABLE reading_order_issues (id INTEGER PRIMARY KEY, reading_order_id TEXT, position INTEGER, series_name TEXT, issue_number TEXT, publication_date TEXT)"
    )
    ro_conn.execute(
        "INSERT INTO reading_orders VALUES ('arc-alpha', 'Alpha Event Reading Order', 'Example Comics', 'Event', 1000)"
    )
    ro_conn.execute(
        "INSERT INTO reading_orders VALUES ('arc-beta', 'Beta Universe Reading Order', 'Example Comics', 'Universe', 2000)"
    )
    ro_conn.execute(
        "INSERT INTO reading_order_issues VALUES (1, 'arc-alpha', 12, 'Crossover Special', '1', '2024')"
    )
    ro_conn.execute(
        "INSERT INTO reading_order_issues VALUES (2, 'arc-beta', 4, 'Crossover Special', '1', '2024')"
    )
    ro_conn.commit()
    ro_conn.close()

    cbz1 = tmp_path / "Crossover Special #1 (2024).cbz"
    cbz2 = tmp_path / "Hero Chronicles #1 (2024).cbz"
    _make_cbz(cbz1)
    _make_cbz(cbz2)

    cn_conn = sqlite3.connect(cn_db)
    cn_conn.execute(
        "CREATE TABLE comics (id TEXT PRIMARY KEY, name TEXT, series TEXT, publisher TEXT, path TEXT, metadata TEXT, updatedAt INTEGER)"
    )
    cn_conn.execute(
        "INSERT INTO comics VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("c1", "Crossover Special #1 (2024).cbz", "Crossover Special", "Example Comics", str(cbz1), json.dumps({"Number": "1", "Year": 2024}), 1000000),
    )
    cn_conn.execute(
        "INSERT INTO comics VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("c2", "Hero Chronicles #1 (2024).cbz", "Hero Chronicles", "Example Comics", str(cbz2), json.dumps({"Number": "1", "Year": 2024, "StoryArc": "Existing Arc"}), 2000000),
    )
    cn_conn.commit()
    cn_conn.close()

    return ro_db, cn_db, cbz1, cbz2


def test_comicinfo_story_arcs_round_trip(tmp_path):
    cbz = tmp_path / "test.cbz"
    _make_cbz(cbz)
    sidecar = cbz.with_suffix(".ComicInfo.xml")

    xml_str = generate_comic_info_xml({
        "series": "Crossover Special",
        "number": "1",
        "StoryArc": "Alpha Event",
        "StoryArcNumber": "12",
        "StoryArcs": "Alpha Event (#12); Beta Universe (#4)",
    })
    assert "<StoryArcs>Alpha Event (#12); Beta Universe (#4)</StoryArcs>" in xml_str
    sidecar.write_text(xml_str, encoding="utf-8")

    parsed = read_comic_info_xml(str(cbz))
    assert parsed["story_arc"] == "Alpha Event"
    assert parsed["story_arc_number"] == "12"
    assert parsed["story_arcs"] == "Alpha Event (#12); Beta Universe (#4)"


def test_merge_story_arcs_preserves_primary_and_appends_new():
    merged = merge_story_arcs_meta(
        {"StoryArc": "Alpha Event", "StoryArcNumber": "12"},
        [("Alpha Event", "12"), ("Beta Universe", "4")],
    )
    assert merged["StoryArc"] == "Alpha Event"
    assert merged["StoryArcNumber"] == "12"
    assert merged["StoryArcs"] == "Alpha Event (#12); Beta Universe (#4)"


def test_cluster_builder_incremental_filters_include_already_tagged(tmp_path):
    ro_db, cn_db, _, _ = _create_test_dbs(tmp_path)

    all_pub = load_all_publisher_comics(cn_db, "Example Comics")
    # Comics with an existing StoryArc (c2) must NOT be skipped so multi-arc comics get all arcs
    assert sorted(c["id"] for c in all_pub) == ["c1", "c2"]

    since_only = load_all_publisher_comics(cn_db, "Example Comics", since_ms=1500000)
    assert [c["id"] for c in since_only] == ["c2"]

    new_arcs = load_all_reading_orders(ro_db, scraped_since_sec=1500)
    assert [a["id"] for a in new_arcs] == ["arc-beta"]


def test_batch_tagger_persists_watermark_and_skips_when_cancelled(tmp_path):
    ro_db, cn_db, _, _ = _create_test_dbs(tmp_path)

    tagger = ContinuityBatchTagger(ro_db_path=ro_db, cn_db_path=cn_db)
    assert tagger.last_run_time is None

    mock_gemini = MagicMock()
    mock_gemini.config = {"api_key": "mock-api-key-test-001"}
    mock_gemini.tag_all_library.return_value = {"totalArcs": 2, "totalMatches": 0, "matchedArcs": {}}

    with patch("tagger_app.continuity.batch_tagger.get_gemini_tagger", return_value=mock_gemini):
        tagger.start_batch_tag(target_publisher="Example Comics", run_async=False, scope="all")

    assert tagger.last_run_time is not None
    # New instance reloads persisted watermark from reading-orders.db
    reloaded = ContinuityBatchTagger(ro_db_path=ro_db, cn_db_path=cn_db)
    assert reloaded.last_run_time == tagger.last_run_time


def test_crawler_persists_last_sync_time_and_recovers_from_meta(tmp_path):
    from tagger_app.continuity.crawler import ContinuityCrawler
    from tagger_app.continuity.db import get_connection, init_continuity_db, set_last_sync_time

    db_path = tmp_path / "ro_sync.db"
    conn = get_connection(str(db_path))
    init_continuity_db(conn)

    # Simulate legacy DB with sitemap_etag updated_at but no explicit last_sync_time row
    conn.execute(
        "INSERT INTO reading_order_meta (key, value, updated_at) VALUES ('sitemap_etag', '\"abc\"', 1794626353)"
    )
    conn.commit()

    crawler_recovered = ContinuityCrawler(db_conn=conn)
    assert crawler_recovered.get_status()["lastSyncTime"] == 1794626353

    # Explicit last_sync_time persists across new crawler instances (app restart)
    set_last_sync_time(conn, 1794630000)
    crawler_restarted = ContinuityCrawler(db_conn=conn)
    assert crawler_restarted.get_status()["lastSyncTime"] == 1794630000
    conn.close()
