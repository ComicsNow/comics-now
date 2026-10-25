import json
import unittest
from unittest.mock import patch

from comics_mcp import server


class TestMcpTools(unittest.TestCase):
    @patch.object(server, "_request")
    def test_get_gemini_status(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {
                "enabled": True,
                "hasApiKey": True,
                "termsAccepted": True,
                "model": "gemini-3.5-flash-lite",
                "dailyCap": 500,
                "dailyUsed": 7,
            },
        }
        res_str = server.get_gemini_status()
        res = json.loads(res_str)
        mock_req.assert_called_once_with("GET", "/api/v1/gemini/config")
        self.assertTrue(res["ok"])
        self.assertEqual(res["data"]["model"], "gemini-3.5-flash-lite")

    @patch.object(server, "_request")
    def test_list_gemini_models(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {
                "models": [
                    {"id": "gemini-3.5-flash-lite", "displayName": "Gemini 3.5 Flash-Lite"}
                ],
                "source": "default",
            },
        }
        res_str = server.list_gemini_models(api_key="test-key")
        res = json.loads(res_str)
        mock_req.assert_called_once_with(
            "GET", "/api/v1/gemini/models", params={"apiKey": "test-key"}
        )
        self.assertEqual(len(res["data"]["models"]), 1)

    @patch.object(server, "_request")
    def test_external_metadata_search(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": [{"title": "Batman #1", "source": "metron"}],
        }
        res_str = server.external_metadata_search("Batman", source="all")
        res = json.loads(res_str)
        mock_req.assert_called_once_with(
            "GET", "/api/v1/search/external", params={"query": "Batman", "source": "all"}
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["data"][0]["title"], "Batman #1")

    @patch.object(server, "_request")
    def test_get_metadata_sources(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {"sources": ["comicvine", "metron", "gcd"]},
        }
        res_str = server.get_metadata_sources()
        res = json.loads(res_str)
        mock_req.assert_called_once_with("GET", "/api/v1/tag-comics-now/sources")
        self.assertIn("comicvine", res["data"]["sources"])

    @patch.object(server, "_request")
    def test_get_tag_comics_now_pending_details(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {"comicId": "123", "candidates": []},
        }
        res_str = server.get_tag_comics_now_pending_details()
        res = json.loads(res_str)
        mock_req.assert_called_once_with("GET", "/api/v1/tag-comics-now/pending-details")
        self.assertEqual(res["data"]["comicId"], "123")

    @patch.object(server, "_request")
    def test_get_organization_rules(self, mock_req):
        def side_effect(method, path, **kwargs):
            if path == "/api/v1/tag-comics-now/naming-rules":
                return {"status": 200, "ok": True, "data": {"rules": {"tokens": ["{series}"]}}}
            if path == "/api/v1/tag-comics-now/folder-rules":
                return {"status": 200, "ok": True, "data": {"rules": {"hierarchy": ["{publisher}"]}}}
            return {"status": 404, "ok": False}

        mock_req.side_effect = side_effect
        res_str = server.get_organization_rules()
        res = json.loads(res_str)
        self.assertEqual(res["namingRules"]["tokens"], ["{series}"])
        self.assertEqual(res["folderRules"]["hierarchy"], ["{publisher}"])

    @patch.object(server, "_request")
    def test_preview_comic_organization(self, mock_req):
        def side_effect(method, path, **kwargs):
            if path == "/api/v1/tag-comics-now/naming-preview":
                return {"status": 200, "ok": True, "data": {"filename": "Batman #001 (2016).cbz"}}
            if path == "/api/v1/tag-comics-now/folder-preview":
                return {"status": 200, "ok": True, "data": {"folderPath": "DC Comics/Batman"}}
            return {"status": 404, "ok": False}

        mock_req.side_effect = side_effect
        res_str = server.preview_comic_organization({"series": "Batman", "issue": "1"})
        res = json.loads(res_str)
        self.assertEqual(res["filename"], "Batman #001 (2016).cbz")
        self.assertEqual(res["folderPath"], "DC Comics/Batman")

    @patch.object(server, "_request")
    def test_preview_comic_organization_direct(self, mock_req):
        def side_effect(method, path, body=None, **kwargs):
            self.assertIn("Series", body["metadata"])
            self.assertIn("Number", body["metadata"])
            if path == "/api/v1/tag-comics-now/naming-preview":
                return {"ok": True, "filename": "Superman #001 (2018).cbz"}
            if path == "/api/v1/tag-comics-now/folder-preview":
                return {"ok": True, "folderPath": "DC Comics/Superman"}
            return {"ok": False}

        mock_req.side_effect = side_effect
        res_str = server.preview_comic_organization({"series": "Superman", "issue": "1"})
        res = json.loads(res_str)
        self.assertEqual(res["filename"], "Superman #001 (2018).cbz")
        self.assertEqual(res["folderPath"], "DC Comics/Superman")


    @patch.object(server, "_request")
    def test_get_guided_status(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {"isRunning": False, "queueLength": 0},
        }
        res_str = server.get_guided_status()
        res = json.loads(res_str)
        mock_req.assert_called_once_with("GET", "/api/v1/guided/status")
        self.assertFalse(res["data"]["isRunning"])

    @patch.object(server, "_request")
    def test_get_guided_logs(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": [{"timestamp": 12345, "message": "Detection complete"}],
        }
        res_str = server.get_guided_logs()
        res = json.loads(res_str)
        mock_req.assert_called_once_with("GET", "/api/v1/guided/logs")
        self.assertEqual(len(res["data"]), 1)

    @patch.object(server, "_request")
    def test_trigger_guided_detection(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {"started": True, "scope": "comic", "target": "c_123"},
        }
        res_str = server.trigger_guided_detection(scope="comic", target="c_123", force=True)
        res = json.loads(res_str)
        mock_req.assert_called_once_with(
            "POST",
            "/api/v1/guided/run-scope",
            body={"scope": "comic", "target": "c_123", "force": True},
        )
        self.assertTrue(res["data"]["started"])

    @patch.object(server, "_request")
    def test_list_libraries(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": [{"id": "main", "name": "Main Library", "path": "/comics"}],
        }
        res_str = server.list_libraries()
        res = json.loads(res_str)
        mock_req.assert_called_once_with("GET", "/api/v1/admin/libraries")
        self.assertEqual(res["data"][0]["id"], "main")

    @patch.object(server, "_request")
    def test_get_user_stats(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": {"totalComics": 100, "readComics": 42},
        }
        res_str = server.get_user_stats("usr_abc")
        res = json.loads(res_str)
        mock_req.assert_called_once_with("GET", "/api/v1/users/usr_abc/stats")
        self.assertEqual(res["data"]["readComics"], 42)

    @patch.object(server, "_request")
    def test_get_operation_errors(self, mock_req):
        mock_req.return_value = {
            "status": 200,
            "ok": True,
            "data": [],
        }
        res_str = server.get_operation_errors()
        res = json.loads(res_str)
        mock_req.assert_called_once_with("GET", "/api/v1/operation-errors")
        self.assertEqual(res["data"], [])


if __name__ == "__main__":
    unittest.main()
