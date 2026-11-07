"""Unit tests for the Continuity Metadata Enricher and automated tagging hook."""
import os
import sqlite3
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tagger_app.continuity.enricher import enrich_with_continuity


def test_enrich_with_continuity_success(tmp_path):
    metadata = {
        "title": "Martian Vision",
        "series": "Absolute Martian Manhunter",
        "publisher": "DC Comics",
        "volume": "1",
        "number": "1",
        "year": "2025",
    }
    file_path = "/comics/Absolute Martian Manhunter - Vol. 1.cbz"
    cover_path = str(tmp_path / "cover.jpg")
    Path(cover_path).touch()

    mock_match = {
        "matchedArc": "Absolute Universe",
        "storyArcNumber": "6",
        "seriesGroup": "DC Comics Events",
        "geminiVerified": True,
    }

    with patch("tagger_app.continuity.enricher.get_matcher") as mock_get_matcher:
        matcher_inst = MagicMock()
        matcher_inst.match_comic.return_value = mock_match
        mock_get_matcher.return_value = matcher_inst

        res = enrich_with_continuity(metadata, file_path, cover_path=cover_path)

        assert res is not None
        assert metadata["story_arc"] == "Absolute Universe"
        assert metadata["story_arc_number"] == "6"
        assert metadata["series_group"] == "DC Comics Events"
        assert metadata["continuity_gemini_verified"] is True


def test_enrich_with_continuity_no_match(tmp_path):
    metadata = {
        "title": "Random Comic",
        "series": "Random Non-Event Series",
        "publisher": "Independent",
        "number": "1",
    }
    file_path = "/comics/Random Comic 01.cbz"

    with patch("tagger_app.continuity.enricher.get_matcher") as mock_get_matcher:
        matcher_inst = MagicMock()
        matcher_inst.match_comic.return_value = None
        mock_get_matcher.return_value = matcher_inst

        res = enrich_with_continuity(metadata, file_path)

        assert res is None
        assert "story_arc" not in metadata
        assert "story_arc_number" not in metadata


def test_enrich_with_continuity_handles_exceptions_gracefully():
    metadata = {"series": "Batman"}
    with patch("tagger_app.continuity.enricher.get_matcher", side_effect=RuntimeError("DB locked")):
        res = enrich_with_continuity(metadata, "/nonexistent.cbz")
        assert res is None
        assert "story_arc" not in metadata
