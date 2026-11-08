"""Unit tests for the Continuity Metadata Enricher (Gemini exclusive, zero fallback)."""
import os
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
        "confidence": 0.95,
        "reason": "Clear match in Absolute line",
        "geminiVerified": True,
    }

    mock_gemini = MagicMock()
    mock_gemini.config = {"api_key": "mock-api-key-test-001"}
    mock_gemini.match_single_comic.return_value = mock_match

    with patch("tagger_app.continuity.gemini_batch_tagger.get_gemini_tagger", return_value=mock_gemini):
        res = enrich_with_continuity(metadata, file_path, cover_path=cover_path)

        assert res is not None
        assert metadata["story_arc"] == "Absolute Universe"
        assert metadata["story_arc_number"] == "6"
        assert metadata["series_group"] == "DC Comics Events"
        assert metadata["continuity_gemini_verified"] is True


def test_enrich_with_continuity_no_fallback_when_gemini_fails_or_unmatched():
    metadata = {
        "title": "Random Comic",
        "series": "Random Non-Event Series",
        "publisher": "Independent",
        "number": "1",
    }
    file_path = "/comics/Random Comic 01.cbz"

    mock_gemini = MagicMock()
    mock_gemini.config = {"api_key": "mock-api-key-test-001"}
    mock_gemini.match_single_comic.return_value = None

    with patch("tagger_app.continuity.gemini_batch_tagger.get_gemini_tagger", return_value=mock_gemini):
        res = enrich_with_continuity(metadata, file_path)

        # Must return None with zero fallback to local/rule matchers
        assert res is None
        assert "story_arc" not in metadata
        assert "story_arc_number" not in metadata


def test_enrich_with_continuity_disabled_when_gemini_not_configured():
    metadata = {"series": "Batman", "publisher": "DC Comics"}
    mock_gemini = MagicMock()
    mock_gemini.config = {"api_key": ""}

    with patch("tagger_app.continuity.gemini_batch_tagger.get_gemini_tagger", return_value=mock_gemini):
        res = enrich_with_continuity(metadata, "/comics/Batman 01.cbz")
        assert res is None
        assert "story_arc" not in metadata


def test_enrich_with_continuity_handles_exceptions_gracefully():
    metadata = {"series": "Batman"}
    with patch("tagger_app.continuity.gemini_batch_tagger.get_gemini_tagger", side_effect=RuntimeError("API error")):
        res = enrich_with_continuity(metadata, "/nonexistent.cbz")
        assert res is None
        assert "story_arc" not in metadata
