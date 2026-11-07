"""Unit tests for the Gemini Vision Story Arc Cover Arbiter."""
import sqlite3
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch
from PIL import Image

from tagger_app.continuity.db import init_continuity_db, upsert_reading_order
from tagger_app.continuity.three_gate_matcher import ThreeGateMatcher
from tagger_app.continuity.gemini_arbiter import GeminiArbiter


def test_gemini_arbiter_mock_positive_match(tmp_path):
    img_a = tmp_path / "cover_a.jpg"
    img_b = tmp_path / "cover_b.jpg"
    Image.new("RGB", (100, 150), color=(255, 0, 0)).save(img_a)
    Image.new("RGB", (100, 150), color=(255, 10, 10)).save(img_b)

    arbiter = GeminiArbiter(api_key="mock-api-key-test-001")
    
    mock_resp = MagicMock()
    mock_resp.text = '{"match": true, "confidence": 0.95, "reason": "Same Martian Manhunter art by Javier Rodriguez"}'

    with patch.object(arbiter, "_call_gemini_vision", return_value=mock_resp):
        res = arbiter.verify_cover_pair(str(img_a), str(img_b))
        assert res["match"] is True
        assert res["confidence"] == 0.95
        assert "Martian Manhunter" in res["reason"]


def test_gemini_arbiter_mock_negative_match(tmp_path):
    img_a = tmp_path / "cover_a.jpg"
    img_b = tmp_path / "cover_b.jpg"
    Image.new("RGB", (100, 150), color=(255, 0, 0)).save(img_a)
    Image.new("RGB", (100, 150), color=(0, 255, 0)).save(img_b)

    arbiter = GeminiArbiter(api_key="mock-api-key-test-001")
    
    mock_resp = MagicMock()
    mock_resp.text = '{"match": false, "confidence": 0.10, "reason": "Completely different comic series"}'

    with patch.object(arbiter, "_call_gemini_vision", return_value=mock_resp):
        res = arbiter.verify_cover_pair(str(img_a), str(img_b))
        assert res["match"] is False
        assert res["confidence"] == 0.10


def test_three_gate_matcher_with_gemini_arbiter_borderline(tmp_path):
    ro_path = tmp_path / "ro_gemini.db"
    ro_conn = sqlite3.connect(str(ro_path))
    ro_conn.row_factory = sqlite3.Row
    init_continuity_db(ro_conn)

    upsert_reading_order(ro_conn, {
        "id": "absolute-universe",
        "title": "Absolute Universe",
        "publisher": "DC Comics",
        "issue_count": 1,
    })

    # Collection with border difference (simulated distance = 13 bits)
    hash_coll = "e1ab364563e1d5ad"
    ro_conn.execute(
        """
        INSERT INTO reading_order_collections (
            id, reading_order_id, position, title, subtitle, release_year, cover_hash, cover_image_url
        ) VALUES ('col_mm', 'absolute-universe', 6, 'Absolute Martian Manhunter: Volume 1', 'Martian Vision', 2025, ?, 'https://readingorders.com/images/collections/1350.png')
        """,
        (hash_coll,),
    )
    ro_conn.commit()
    ro_conn.close()

    mock_arbiter = MagicMock()
    mock_arbiter.verify_cover_pair.return_value = {
        "match": True,
        "confidence": 0.96,
        "reason": "Confirmed match by Gemini Vision",
    }

    matcher = ThreeGateMatcher(ro_db_path=str(ro_path), gemini_arbiter=mock_arbiter)
    matcher.load_indices()

    # User comic with hash distance 13 to hash_coll
    # hash_comic = f1a9b264696944a5
    thumb_path = tmp_path / "thumb_borderline.jpg"
    # Create image that yields distance
    Image.new("RGB", (100, 150), color=(200, 50, 50)).save(thumb_path)

    comic = {
        "id": "c_mm_vol1",
        "name": "01 Absolute Martian Manhunter - Vol. 1: Martian Vision [DC Comics] (2025).cbz",
        "series": "Absolute Martian Manhunter",
        "publisher": "DC Comics",
        "metadata": '{"Volume": "1", "Number": "1", "Year": 2025}',
        "thumb_path": str(thumb_path),
    }

    # When borderline (distance between 11 and 16), Gemini Arbiter confirms match
    with patch.object(matcher, "_get_cover_distance", return_value=13):
        res = matcher.match_comic(comic, enable_gemini_arbiter=True)
        assert res is not None
        assert res["storyArcNumber"] == "6"
        assert res["geminiVerified"] is True
