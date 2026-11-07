"""Unit tests for Story Arcs & Continuity tools in Comics Now! MCP server."""
import json
import unittest
from unittest.mock import patch

from comics_mcp import server


class TestStoryArcsMcp(unittest.TestCase):
    @patch.object(server, "_request")
    def test_list_story_arcs(self, mock_req):
        """list_story_arcs calls GET /api/v1/story-arcs with optional filters."""
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": [
                {
                    "id": "civil-war",
                    "title": "Civil War",
                    "publisher": "Marvel Comics",
                    "totalIssues": 109,
                    "ownedCount": 85,
                    "completenessPercent": 78,
                }
            ],
        }
        res_str = server.list_story_arcs(publisher="Marvel Comics", search="Civil")
        res = json.loads(res_str)
        mock_req.assert_called_once_with(
            "GET",
            "/api/v1/story-arcs",
            params={"publisher": "Marvel Comics", "search": "Civil"},
        )
        self.assertTrue(res["ok"])
        self.assertEqual(len(res["data"]), 1)
        self.assertEqual(res["data"][0]["title"], "Civil War")

    @patch.object(server, "_request")
    def test_get_story_arc(self, mock_req):
        """get_story_arc calls GET /api/v1/story-arcs/{id}."""
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {
                "id": "blackest-night",
                "title": "Blackest Night",
                "issues": [{"position": 1, "title": "Green Lantern #43"}],
            },
        }
        res_str = server.get_story_arc("blackest-night")
        res = json.loads(res_str)
        mock_req.assert_called_once_with("GET", "/api/v1/story-arcs/blackest-night")
        self.assertTrue(res["ok"])
        self.assertEqual(res["data"]["id"], "blackest-night")

    @patch.object(server, "_request")
    def test_get_story_arc_next(self, mock_req):
        """get_story_arc_next calls GET /api/v1/story-arcs/continuity/next/{comic_id}."""
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {
                "nextIssue": {
                    "seriesName": "Civil War",
                    "issueNumber": "2",
                    "position": 15,
                }
            },
        }
        res_str = server.get_story_arc_next("comic-12345")
        res = json.loads(res_str)
        mock_req.assert_called_once_with(
            "GET", "/api/v1/story-arcs/continuity/next/comic-12345"
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["data"]["nextIssue"]["issueNumber"], "2")

    @patch.object(server, "_request")
    def test_trigger_story_arcs_sync(self, mock_req):
        """trigger_story_arcs_sync calls POST /api/v1/story-arcs/sync."""
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {"message": "ReadingOrders sync started"},
        }
        res_str = server.trigger_story_arcs_sync(mode="both")
        res = json.loads(res_str)
        mock_req.assert_called_once_with(
            "POST", "/api/v1/story-arcs/sync", body={"mode": "both"}
        )
        self.assertTrue(res["ok"])


if __name__ == "__main__":
    unittest.main()
