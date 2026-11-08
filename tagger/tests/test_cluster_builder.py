"""Unit tests for Gemini story arc dynamic candidate filtering and token rate limiting."""
import json
import sqlite3
import pytest
from pathlib import Path

from tagger_app.continuity.db import init_continuity_db, upsert_reading_order
from tagger_app.continuity.cluster_builder import (
    extract_series_phrases_for_arc,
    get_arc_candidate_comics,
    build_arc_target_prompt,
    parse_arc_matches,
)


def _setup_test_db(tmp_path):
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
    cn_conn.execute(
        """
        INSERT INTO comics (id, name, series, publisher, path, metadata, updatedAt)
        VALUES 
            ('c_ab_1', 'Absolute Batman v01 - The Zoo (2025).cbz', 'Absolute Batman', 'DC Comics', '/path/1.cbz', '{"Series": "Absolute Batman", "Volume": "1"}', 100),
            ('c_agl_1', '01 Absolute Green Lantern - Vol: 1 [DC Comics] (2025).cbz', 'Absolute Green Lantern', 'DC Comics', '/path/2.cbz', '{"Series": "Absolute Green Lantern", "Volume": "1"}', 200),
            ('c_amm_1', '01 Absolute Martian Manhunter - Vol. 1 [DC Comics] (2025).cbz', 'Absolute Martian Manhunter', 'DC Comics', '/path/3.cbz', '{"Series": "Absolute Martian Manhunter", "Volume": "1"}', 300),
            ('c_bat_reg', 'Batman #404 (1987).cbz', 'Batman', 'DC Comics', '/path/4.cbz', '{"Series": "Batman"}', 400),
            ('c_marvel_1', 'Secret Wars #1.cbz', 'Secret Wars', 'Marvel', '/path/5.cbz', '{"Series": "Secret Wars"}', 500)
        """
    )
    cn_conn.commit()
    cn_conn.close()
    return str(cn_p)


def test_extract_series_phrases_for_arc():
    checklist = [
        {"position": 1, "title": "Absolute Batman: Volume 1", "subtitle": "The Zoo"},
        {"position": 2, "title": "Absolute Green Lantern: Volume 1", "subtitle": "Without Fear"},
        {"position": 3, "title": "Absolute Martian Manhunter: Volume 1", "subtitle": "Martian Vision"},
    ]
    phrases = extract_series_phrases_for_arc(checklist)
    assert any("absolute batman" in p for p in phrases)
    assert any("absolute green lantern" in p for p in phrases)
    assert any("absolute martian manhunter" in p for p in phrases)


def test_get_arc_candidate_comics_extracts_only_relevant_candidates(tmp_path):
    cn_p = _setup_test_db(tmp_path)
    checklist = [
        {"position": 1, "title": "Absolute Batman: Volume 1", "subtitle": "The Zoo"},
        {"position": 2, "title": "Absolute Green Lantern: Volume 1", "subtitle": "Without Fear"},
        {"position": 3, "title": "Absolute Martian Manhunter: Volume 1", "subtitle": "Martian Vision"},
    ]
    phrases = extract_series_phrases_for_arc(checklist)
    candidates = get_arc_candidate_comics(cn_p, "DC Comics", phrases)

    cand_ids = {c["id"] for c in candidates}
    assert "c_ab_1" in cand_ids
    assert "c_agl_1" in cand_ids
    assert "c_amm_1" in cand_ids
    assert "c_marvel_1" not in cand_ids  # Filtered by publisher
    assert "c_bat_reg" not in cand_ids   # Regular Batman not in Absolute list


def test_build_arc_target_prompt_and_parse():
    arc = {
        "id": "absolute-universe",
        "clean_title": "Absolute Universe",
        "publisher": "DC Comics",
        "checklist": [
            {"position": 1, "title": "Absolute Batman: Volume 1", "subtitle": "The Zoo", "release_year": 2025},
            {"position": 2, "title": "Absolute Green Lantern: Volume 1", "subtitle": "Without Fear", "release_year": 2025},
        ]
    }
    candidates = [
        {"id": "c_ab_1", "name": "Absolute Batman v01.cbz", "series": "Absolute Batman", "volume": "1", "number": "", "year": 2025, "title": "The Zoo"},
        {"id": "c_agl_1", "name": "01 Absolute Green Lantern.cbz", "series": "Absolute Green Lantern", "volume": "1", "number": "", "year": 2025, "title": ""},
    ]

    prompt = build_arc_target_prompt(arc, candidates)
    assert "Absolute Universe" in prompt
    assert "c_ab_1" in prompt
    assert "c_agl_1" in prompt

    raw_resp = json.dumps({
        "matches": [
            {"position": 1, "comic_id": "c_ab_1", "confidence": 1.0, "reason": "Direct Volume 1 match"},
            {"position": 2, "comic_id": "c_agl_1", "confidence": 0.95, "reason": "Direct Volume 1 match"},
        ]
    })
    matches = parse_arc_matches(raw_resp, arc, {c["id"]: c for c in candidates}, min_confidence=0.85)
    assert len(matches) == 2
    assert matches[0]["comic_id"] == "c_ab_1"
    assert matches[1]["comic_id"] == "c_agl_1"
