import json
import pytest
from unittest.mock import patch, MagicMock

from comics_mcp import server


def test_mcp_curate_reading_order_event_tool():
    fake_result = {
        "title": "Batman: Knightfall",
        "is_valid": True,
        "matched_count": 5,
        "total_steps": 20,
        "applied": False
    }

    with patch("comics_mcp.reading_curator.curate_event_reading_order", return_value=fake_result) as mock_curate:
        out = server.curate_reading_order_event("Knightfall", apply_changes=False)
        mock_curate.assert_called_once_with("Knightfall", apply_changes=False)
        data = json.loads(out)
        assert data["title"] == "Batman: Knightfall"
        assert data["is_valid"] is True
        assert data["matched_count"] == 5


def test_mcp_curate_recent_comics_tool():
    fake_result = {
        "status": "success",
        "recent_comics_count": 12,
        "existing_list_suggestions": [],
        "new_reading_list_proposals": []
    }

    with patch("comics_mcp.reading_curator.curate_recent_comics", return_value=fake_result) as mock_recent:
        out = server.curate_recent_comics_reading_lists(months=6, apply_changes=False)
        mock_recent.assert_called_once_with(months=6, apply_changes=False)
        data = json.loads(out)
        assert data["status"] == "success"
        assert data["recent_comics_count"] == 12


def test_mcp_curate_full_library_tool():
    with patch("comics_mcp.reading_curator.get_all_library_comics", return_value=[{"id": "c1"}]):
        with patch("comics_mcp.reading_curator.reading_orders_cache.list_cached_orders", return_value=[]):
            out = server.curate_full_library_reading_lists(unassigned_only=True, apply_changes=False)
            data = json.loads(out)
            assert data["audited_comics_count"] == 1
            assert data["valid_proposals_count"] == 0
