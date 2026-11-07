"""Unit tests for ReadingOrders source integration in Tag Comics Now!."""
import os
import unittest
from unittest.mock import patch, MagicMock

from tagger_app.sources.registry import SOURCES, SourceContext
from tagger_app.sources import readingorders


class TestReadingOrdersSource(unittest.TestCase):
    def test_source_registered_in_sources_list(self):
        """ReadingOrders source must be registered in the official SOURCES registry."""
        ro_source = next((s for s in SOURCES if s.id == "src-readingorders"), None)
        self.assertIsNotNone(ro_source, "src-readingorders must be in SOURCES")
        self.assertEqual(ro_source.label, "ReadingOrders (Story Arcs)")
        self.assertIn("readingorders", ro_source.aliases)
        self.assertIn("src-readingorders", ro_source.aliases)

    def test_source_is_enabled_filtering(self):
        """Source can be selectively enabled or disabled via enabled_sources list."""
        ro_source = next((s for s in SOURCES if s.id == "src-readingorders"), None)
        # Empty enabled_sources means legacy default: all enabled
        self.assertTrue(ro_source.is_enabled([]))
        self.assertTrue(ro_source.is_enabled(["src-readingorders"]))
        self.assertTrue(ro_source.is_enabled(["readingorders"]))
        # Explicit other sources means disabled
        self.assertFalse(ro_source.is_enabled(["src-comicvine", "src-metron"]))

    @patch("pathlib.Path.exists", return_value=True)
    @patch.object(readingorders, "get_story_arc_candidate")
    def test_resolve_readingorders_for_source(self, mock_candidate, mock_exists):
        """Resolver must extract series & issue and return candidate metadata."""
        mock_candidate.return_value = {
            "story_arc": "Civil War",
            "story_arc_number": "1",
            "series_group": "Marvel Comics",
        }
        ctx = SourceContext(existing_meta={"series": "Civil War", "number": "1"})
        progress = MagicMock()
        res = readingorders.resolve_readingorders_for_source("Civil War 01.cbz", ctx=ctx, on_progress=progress)

        self.assertIsInstance(res, list)
        self.assertEqual(len(res), 1)
        meta, score, src = res[0]
        self.assertEqual(meta["story_arc"], "Civil War")
        self.assertEqual(meta["story_arc_number"], "1")
        self.assertEqual(meta["series_group"], "Marvel Comics")
        self.assertEqual(score, 1.0)
        self.assertIn("readingorders.com", src)


if __name__ == "__main__":
    unittest.main()
