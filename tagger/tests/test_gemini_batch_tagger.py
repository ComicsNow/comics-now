"""Unit tests for Gemini Flash Story Arc Batch Tagger."""
import json
import sqlite3
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tagger_app.continuity.db import init_continuity_db, upsert_reading_order


def _setup_test_env(tmp_path):
    ro_p = tmp_path / "ro_test.db"
    ro_conn = sqlite3.connect(str(ro_p))
    ro_conn.row_factory = sqlite3.Row
    init_continuity_db(ro_conn)

    upsert_reading_order(ro_conn, {
        "id": "absolute-universe",
        "title": "Absolute Universe Reading Order",
        "publisher": "DC Comics",
        "issue_count": 2,
    })
    ro_conn.execute(
        """
        INSERT INTO reading_order_collections (
            id, reading_order_id, position, title, subtitle, release_year
        ) VALUES 
            ('col_1', 'absolute-universe', 1, 'All In Saga', 'Darkseid arrives', 2024),
            ('col_2', 'absolute-universe', 2, 'Absolute Batman: Volume 1', 'The Zoo', 2025)
        """
    )
    ro_conn.commit()
    ro_conn.close()

    cn_p = tmp_path / "cn_test.db"
    cn_conn = sqlite3.connect(str(cn_p))
    cn_conn.execute(
        """
        CREATE TABLE comics (
            id TEXT PRIMARY KEY,
            name TEXT,
            series TEXT,
            publisher TEXT,
            path TEXT,
            metadata TEXT,
            updatedAt INTEGER
        )
        """
    )
    # File 1: Target for position 2 (Absolute Batman Vol 1)
    cbz_file = tmp_path / "Absolute Batman v01 - The Zoo (2025).cbz"
    cbz_file.write_text("dummy comic content")

    cn_conn.execute(
        """
        INSERT INTO comics (id, name, series, publisher, path, metadata, updatedAt)
        VALUES ('comic_ab_1', 'Absolute Batman v01 - The Zoo (2025).cbz', 'Absolute Batman', 'DC Comics',
                ?, '{"Series": "Absolute Batman", "Year": 2025}', 1000)
        """,
        (str(cbz_file),),
    )
    cn_conn.commit()
    cn_conn.close()

    config_p = tmp_path / "config.json"
    config_p.write_text(json.dumps({
        "geminiApiKey": "mock-api-key-test-001",
        "geminiModel": "gemini-3.5-flash-lite",
        "metadata_storage": "sidecar",
    }))

    return str(ro_p), str(cn_p), str(config_p), str(cbz_file)


def test_gemini_batch_tagger_match_and_sidecar_write(tmp_path):
    ro_p, cn_p, config_p, cbz_file = _setup_test_env(tmp_path)
    from tagger_app.continuity.gemini_batch_tagger import GeminiStoryArcTagger

    tagger = GeminiStoryArcTagger(ro_db_path=ro_p, cn_db_path=cn_p, config_path=config_p)

    mock_gemini_resp = MagicMock()
    mock_gemini_resp.text = json.dumps({
        "matches": [
            {
                "position": 2,
                "comic_id": "comic_ab_1",
                "confidence": 0.96,
                "reason": "Absolute Batman v01 matches Absolute Batman Vol 1: The Zoo",
            }
        ]
    })

    with patch.object(tagger, "_call_gemini_api", return_value=mock_gemini_resp):
        res = tagger.tag_arc("absolute-universe", dry_run=False)
        assert res["totalMatches"] == 1
        assert res["appliedCount"] == 1

        # Check DB update
        conn = sqlite3.connect(cn_p)
        conn.row_factory = sqlite3.Row
        row = conn.cursor().execute("SELECT metadata FROM comics WHERE id = 'comic_ab_1'").fetchone()
        conn.close()
        meta = json.loads(row["metadata"])
        assert meta["StoryArc"] == "Absolute Universe"
        assert meta["StoryArcNumber"] == "2"

        # Check sidecar XML write (since metadata_storage = 'sidecar')
        sidecar_p = Path(cbz_file).with_suffix(".ComicInfo.xml")
        assert sidecar_p.exists()
        sidecar_content = sidecar_p.read_text(encoding="utf-8")
        assert "<StoryArc>Absolute Universe</StoryArc>" in sidecar_content
        assert "<StoryArcNumber>2</StoryArcNumber>" in sidecar_content


def test_gemini_batch_tagger_respects_storage_mode_db(tmp_path):
    ro_p, cn_p, config_p, cbz_file = _setup_test_env(tmp_path)
    # Set metadata_storage to db only
    Path(config_p).write_text(json.dumps({
        "geminiApiKey": "mock-api-key-test-001",
        "geminiModel": "gemini-3.5-flash-lite",
        "metadata_storage": "db",
    }))

    from tagger_app.continuity.gemini_batch_tagger import GeminiStoryArcTagger

    tagger = GeminiStoryArcTagger(ro_db_path=ro_p, cn_db_path=cn_p, config_path=config_p)

    mock_gemini_resp = MagicMock()
    mock_gemini_resp.text = json.dumps({
        "matches": [
            {
                "position": 2,
                "comic_id": "comic_ab_1",
                "confidence": 0.95,
                "reason": "Direct match",
            }
        ]
    })

    with patch.object(tagger, "_call_gemini_api", return_value=mock_gemini_resp):
        res = tagger.tag_arc("absolute-universe", dry_run=False)
        assert res["appliedCount"] == 1

        # Sidecar should NOT be created when storage_mode is 'db'
        sidecar_p = Path(cbz_file).with_suffix(".ComicInfo.xml")
        assert not sidecar_p.exists()


def test_gemini_batch_tagger_low_confidence_filtered_out(tmp_path):
    ro_p, cn_p, config_p, cbz_file = _setup_test_env(tmp_path)
    from tagger_app.continuity.gemini_batch_tagger import GeminiStoryArcTagger

    tagger = GeminiStoryArcTagger(ro_db_path=ro_p, cn_db_path=cn_p, config_path=config_p)

    mock_gemini_resp = MagicMock()
    mock_gemini_resp.text = json.dumps({
        "matches": [
            {
                "position": 2,
                "comic_id": "comic_ab_1",
                "confidence": 0.50,  # Below 0.85 threshold
                "reason": "Uncertain match",
            }
        ]
    })

    with patch.object(tagger, "_call_gemini_api", return_value=mock_gemini_resp):
        res = tagger.tag_arc("absolute-universe", dry_run=False)
        assert res["rawMatchesCount"] == 1
        assert res["appliedCount"] == 0  # Filtered out!


def test_gemini_batch_tagger_all_publishers_dry_run(tmp_path):
    ro_p, cn_p, config_p, cbz_file = _setup_test_env(tmp_path)
    from tagger_app.continuity.gemini_batch_tagger import GeminiStoryArcTagger

    tagger = GeminiStoryArcTagger(ro_db_path=ro_p, cn_db_path=cn_p, config_path=config_p, min_delay=0.0)

    mock_gemini_resp = MagicMock()
    mock_gemini_resp.text = json.dumps({
        "matches": [
            {
                "position": 2,
                "comic_id": "comic_ab_1",
                "confidence": 0.95,
                "reason": "Direct match in targeted run",
            }
        ]
    })

    with patch.object(tagger, "_call_gemini_api", return_value=mock_gemini_resp):
        res = tagger.tag_all_library(dry_run=True)
        assert res["totalArcs"] >= 1
        assert res["totalMatches"] == 1
        assert res["arcsWithMatches"] == 1
        assert "absolute-universe" in res["matchedArcs"]
        assert res["dryRun"] is True
        # Verify no sidecar written during dry-run
        sidecar_p = Path(cbz_file).with_suffix(".ComicInfo.xml")
        assert not sidecar_p.exists()


def test_gemini_match_single_comic(tmp_path):
    ro_p, cn_p, config_p, cbz_file = _setup_test_env(tmp_path)
    from tagger_app.continuity.gemini_batch_tagger import GeminiStoryArcTagger

    tagger = GeminiStoryArcTagger(ro_db_path=ro_p, cn_db_path=cn_p, config_path=config_p, min_delay=0.0)

    comic_payload = {
        "id": "Absolute Batman v01 - The Zoo (2025).cbz",
        "name": "Absolute Batman v01 - The Zoo (2025).cbz",
        "series": "Absolute Batman",
        "publisher": "DC Comics",
        "metadata": {"Series": "Absolute Batman", "Volume": "1", "Year": 2025},
    }

    mock_gemini_resp = MagicMock()
    mock_gemini_resp.text = json.dumps({
        "matches": [
            {
                "position": 2,
                "comic_id": "Absolute Batman v01 - The Zoo (2025).cbz",
                "confidence": 0.98,
                "reason": "Direct Volume 1 match",
            }
        ]
    })

    with patch.object(tagger, "_call_gemini_api", return_value=mock_gemini_resp):
        match = tagger.match_single_comic(comic_payload)
        assert match is not None
        assert match["matchedArc"] == "Absolute Universe"
        assert match["storyArcNumber"] == "2"
        assert match["confidence"] == 0.98


def test_gemini_tag_all_library_streaming_callbacks(tmp_path):
    ro_p, cn_p, config_p, cbz_file = _setup_test_env(tmp_path)
    from tagger_app.continuity.gemini_batch_tagger import GeminiStoryArcTagger

    tagger = GeminiStoryArcTagger(ro_db_path=ro_p, cn_db_path=cn_p, config_path=config_p, min_delay=0.0)

    mock_gemini_resp = MagicMock()
    mock_gemini_resp.text = json.dumps({
        "matches": [
            {
                "position": 2,
                "comic_id": "comic_ab_1",
                "confidence": 0.95,
                "reason": "Direct match",
            }
        ]
    })

    logs = []
    progress_updates = []

    def on_log(level, msg):
        logs.append((level, msg))

    def on_progress(current, total, current_arc, matches_count):
        progress_updates.append((current, total, current_arc, matches_count))

    with patch.object(tagger, "_call_gemini_api", return_value=mock_gemini_resp):
        res = tagger.tag_all_library(dry_run=True, log_fn=on_log, progress_fn=on_progress)
        assert len(logs) > 0
        assert len(progress_updates) > 0
        assert res["totalMatches"] == 1


