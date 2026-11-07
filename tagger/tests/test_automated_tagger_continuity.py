"""Tests for the automated continuity tagging hook in process_single_cbz_file and api_apply_tag."""
import os
import zipfile
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tagger_app.core.tagger import process_single_cbz_file
from tagger_app.core.comicinfo import read_comic_info_xml


def _create_dummy_cbz(path):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("00_cover.jpg", b"fake_jpeg_bytes")


def test_process_single_cbz_file_auto_enriches_story_arc(tmp_path):
    cbz_file = tmp_path / "Absolute Martian Manhunter - Vol. 1 (2025).cbz"
    _create_dummy_cbz(cbz_file)

    mock_sources = [
        (
            {
                "title": "Martian Vision",
                "series": "Absolute Martian Manhunter",
                "publisher": "DC Comics",
                "volume": "1",
                "number": "1",
                "year": "2025",
            },
            0.95,
            "https://comicvine.gamespot.com/mock-1",
        )
    ]

    mock_arc_match = {
        "matchedArc": "Absolute Universe",
        "storyArcNumber": "6",
        "seriesGroup": "DC Comics Events",
        "geminiVerified": True,
    }

    with patch("tagger_app.core.tagger.query_all_sources_sequentially", return_value=mock_sources), \
         patch("tagger_app.core.tagger.is_already_enhanced", return_value=False), \
         patch("tagger_app.core.tagger.check_comic_info_completeness", return_value=(True, [])), \
         patch("tagger_app.continuity.enricher.get_matcher") as mock_get_matcher:

        matcher_inst = MagicMock()
        matcher_inst.match_comic.return_value = mock_arc_match
        mock_get_matcher.return_value = matcher_inst

        res = process_single_cbz_file(
            str(cbz_file),
            comicvine_api_key="mock-key-001",
            upper_threshold=0.90,
            force_reprocess=True,
            metadata_storage="archive",
        )

        assert res["status"] == "tagged"
        meta = res["metadata"]
        assert meta["story_arc"] == "Absolute Universe"
        assert meta["story_arc_number"] == "6"
        assert meta["series_group"] == "DC Comics Events"

        # Verify ComicInfo.xml inside archive contains StoryArc
        written_xml = read_comic_info_xml(str(cbz_file))
        assert written_xml is not None
        assert written_xml.get("story_arc") == "Absolute Universe"
        assert written_xml.get("story_arc_number") == "6"
