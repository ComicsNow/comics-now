import json
import unittest
from unittest.mock import patch

from comics_mcp import server

RUN_FILE_PATH = "/api/v1/tag-comics-now/run-file"


class TestRunTagSearchTool(unittest.TestCase):
    @patch.object(server, "_request")
    def test_posts_comic_id_and_force_flag(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {"status": "tagged", "companion": {"synced": True}},
        }

        res = json.loads(server.run_tag_search("mock-comic-id", force=True))

        mock_req.assert_called_once_with(
            "POST", RUN_FILE_PATH, body={"comicId": "mock-comic-id", "force": True}
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["data"]["status"], "tagged")

    @patch.object(server, "_request")
    def test_force_defaults_to_false(self, mock_req):
        mock_req.return_value = {"status": 200, "ok": True, "data": {"status": "skipped"}}

        json.loads(server.run_tag_search("mock-comic-id"))

        mock_req.assert_called_once_with(
            "POST", RUN_FILE_PATH, body={"comicId": "mock-comic-id", "force": False}
        )


class TestRunFileDestructiveGate(unittest.TestCase):
    @patch.object(server, "_request")
    def test_call_api_blocks_run_file_without_destructive_flag(self, mock_req):
        with patch.object(server, "ALLOW_DESTRUCTIVE", False):
            res = json.loads(
                server.call_api("POST", RUN_FILE_PATH, body={"comicId": "mock-comic-id"})
            )

        self.assertTrue(res["blocked"])
        mock_req.assert_not_called()

    @patch.object(server, "_request")
    def test_call_api_allows_run_file_with_destructive_flag(self, mock_req):
        mock_req.return_value = {"status": 200, "ok": True, "data": {"status": "tagged"}}

        with patch.object(server, "ALLOW_DESTRUCTIVE", True):
            res = json.loads(
                server.call_api("POST", RUN_FILE_PATH, body={"comicId": "mock-comic-id"})
            )

        self.assertTrue(res["ok"])
        mock_req.assert_called_once_with(
            "POST", RUN_FILE_PATH, params=None, body={"comicId": "mock-comic-id"}
        )


if __name__ == "__main__":
    unittest.main()
