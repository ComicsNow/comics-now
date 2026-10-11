import io
import json
import unittest
from unittest.mock import MagicMock, patch
from PIL import Image as PILImage

from comics_mcp import server


class TestGuidedViewTools(unittest.TestCase):
    def setUp(self):
        self.sample_comic_id = "test-comic-123"
        self.sample_doc = {
            "comicId": self.sample_comic_id,
            "type": "western",
            "pages": {
                "page_001.jpg": {
                    "width": 800,
                    "height": 1200,
                    "items": [
                        {"id": "panel-1", "kind": "panel", "box": [50, 50, 700, 500]},
                        {"id": "bubble-1", "kind": "bubble", "box": [100, 100, 200, 80]},
                        {"id": "bubble-2", "kind": "bubble", "box": [400, 150, 250, 90]},
                    ],
                    "order": ["panel-1", "bubble-1", "bubble-2"],
                },
                "page_002.jpg": {
                    "width": 800,
                    "height": 1200,
                    "items": [
                        {"id": "p2-b1", "kind": "bubble", "box": [120, 80, 150, 70]}
                    ],
                    "order": ["p2-b1"],
                },
            },
            "warnings": [],
        }

        # Create dummy image bytes
        img = PILImage.new("RGB", (800, 1200), color=(200, 200, 200))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        self.dummy_image_bytes = buf.getvalue()

    @patch("comics_mcp.server._gve_request")
    def test_get_guided_page_data_by_index(self, mock_gve):
        mock_gve.return_value = {"ok": True, "status": 200, "data": self.sample_doc}

        res_str = server.get_guided_page_data(self.sample_comic_id, page=0)
        res = json.loads(res_str)

        self.assertTrue(res["ok"])
        data = res["data"]
        self.assertEqual(data["comicId"], self.sample_comic_id)
        self.assertEqual(data["pageIndex"], 0)
        self.assertEqual(data["pageName"], "page_001.jpg")
        self.assertEqual(data["type"], "western")
        self.assertEqual(len(data["sequence"]), 3)
        self.assertEqual(data["sequence"][0]["id"], "panel-1")
        self.assertEqual(data["sequence"][0]["order"], 1)

    @patch("comics_mcp.server._gve_request")
    def test_get_guided_page_data_out_of_bounds(self, mock_gve):
        mock_gve.return_value = {"ok": True, "status": 200, "data": self.sample_doc}

        res_str = server.get_guided_page_data(self.sample_comic_id, page=99)
        res = json.loads(res_str)
        self.assertFalse(res["ok"])
        self.assertIn("out of bounds", res["error"])

    @patch("comics_mcp.server._gve_page_image")
    @patch("comics_mcp.server._gve_request")
    def test_get_guided_page_image_clean(self, mock_gve_req, mock_gve_img):
        mock_gve_req.return_value = {"ok": True, "status": 200, "data": self.sample_doc}
        mock_gve_img.return_value = (self.dummy_image_bytes, "jpeg")

        image_obj = server.get_guided_page_image(self.sample_comic_id, page=0, overlay=False)
        self.assertEqual(image_obj._format, "jpeg")
        self.assertEqual(image_obj.data, self.dummy_image_bytes)

    @patch("comics_mcp.server._gve_page_image")
    @patch("comics_mcp.server._gve_request")
    def test_get_guided_page_image_with_overlay(self, mock_gve_req, mock_gve_img):
        mock_gve_req.return_value = {"ok": True, "status": 200, "data": self.sample_doc}
        mock_gve_img.return_value = (self.dummy_image_bytes, "jpeg")

        image_obj = server.get_guided_page_image(self.sample_comic_id, page=0, overlay=True)
        self.assertEqual(image_obj._format, "png")
        self.assertIsInstance(image_obj.data, bytes)
        # Verify rendered image has correct dimensions
        rendered = PILImage.open(io.BytesIO(image_obj.data))
        self.assertEqual(rendered.size, (800, 1200))

    @patch("comics_mcp.server._gve_page_image")
    @patch("comics_mcp.server._gve_request")
    def test_inspect_guided_page(self, mock_gve_req, mock_gve_img):
        mock_gve_req.return_value = {"ok": True, "status": 200, "data": self.sample_doc}
        mock_gve_img.return_value = (self.dummy_image_bytes, "jpeg")

        result = server.inspect_guided_page(self.sample_comic_id, page=0)
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 2)
        # First item is Image, second is JSON string
        img_item, json_str = result[0], result[1]
        self.assertEqual(img_item._format, "png")
        info = json.loads(json_str)
        self.assertTrue(info["ok"])
        self.assertEqual(info["data"]["pageName"], "page_001.jpg")

    @patch("comics_mcp.server._gve_request")
    def test_apply_guided_page_fix(self, mock_gve):
        def side_effect(method, path, **kwargs):
            if method == "GET":
                return {"ok": True, "status": 200, "data": self.sample_doc}
            elif method == "PUT":
                return {"ok": True, "status": 200, "data": kwargs.get("body", {})}
            return {"ok": False, "status": 404}

        mock_gve.side_effect = side_effect

        new_items = [
            {"id": "bubble-2", "kind": "bubble", "box": [400, 150, 260, 95]},
            {"id": "bubble-1", "kind": "bubble", "box": [100, 100, 200, 80]},
        ]
        new_order = ["bubble-2", "bubble-1"]

        res_str = server.apply_guided_page_fix(
            self.sample_comic_id,
            page=0,
            items=new_items,
            order=new_order,
        )
        res = json.loads(res_str)
        self.assertTrue(res["ok"])
        self.assertEqual(res["data"]["itemCount"], 2)

        # Verify PUT was called with merged document preserving page_002.jpg
        put_call = [c for c in mock_gve.call_args_list if c[0][0] == "PUT"][0]
        put_body = put_call[1]["body"]
        self.assertIn("page_002.jpg", put_body["pages"])
        self.assertEqual(len(put_body["pages"]["page_001.jpg"]["items"]), 2)
        self.assertEqual(put_body["pages"]["page_001.jpg"]["order"], ["bubble-2", "bubble-1"])

    @patch("comics_mcp.server._gve_request")
    def test_reorder_guided_page(self, mock_gve):
        def side_effect(method, path, **kwargs):
            if method == "GET":
                return {"ok": True, "status": 200, "data": self.sample_doc}
            elif method == "PUT":
                return {"ok": True, "status": 200, "data": kwargs.get("body", {})}
            return {"ok": False, "status": 404}

        mock_gve.side_effect = side_effect

        # Swap bubble-1 and bubble-2
        new_order = ["panel-1", "bubble-2", "bubble-1"]
        res_str = server.reorder_guided_page(self.sample_comic_id, page=0, order=new_order)
        res = json.loads(res_str)
        self.assertTrue(res["ok"])
        self.assertEqual(res["data"]["order"], new_order)

    @patch("comics_mcp.server._gve_request")
    def test_reorder_guided_page_invalid_permutation(self, mock_gve):
        mock_gve.return_value = {"ok": True, "status": 200, "data": self.sample_doc}

        # Invalid permutation (missing bubble-2, extra bubble-99)
        bad_order = ["panel-1", "bubble-1", "bubble-99"]
        res_str = server.reorder_guided_page(self.sample_comic_id, page=0, order=bad_order)
        res = json.loads(res_str)
        self.assertFalse(res["ok"])
        self.assertIn("permutation", res["error"])


if __name__ == "__main__":
    unittest.main()
