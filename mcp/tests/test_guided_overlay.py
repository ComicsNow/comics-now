import io
import unittest
from PIL import Image

from comics_mcp.guided_overlay import render_guided_overlay


class TestGuidedOverlay(unittest.TestCase):
    def _create_sample_image_bytes(self, width: int = 400, height: int = 600) -> bytes:
        img = Image.new("RGB", (width, height), color=(240, 240, 240))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue()

    def test_render_with_no_items(self):
        raw = self._create_sample_image_bytes(400, 600)
        rendered = render_guided_overlay(raw, items=[], order=[])
        self.assertIsInstance(rendered, bytes)
        out_img = Image.open(io.BytesIO(rendered))
        self.assertEqual(out_img.size, (400, 600))

    def test_render_with_panel_and_bubble(self):
        raw = self._create_sample_image_bytes(400, 600)
        items = [
            {"id": "panel-1", "kind": "panel", "box": [50, 50, 300, 200]},
            {"id": "bubble-1", "kind": "bubble", "box": [80, 80, 100, 50]},
            {"id": "bubble-2", "kind": "bubble", "box": [200, 100, 120, 60]},
        ]
        order = ["panel-1", "bubble-1", "bubble-2"]
        rendered = render_guided_overlay(raw, items=items, order=order)
        self.assertIsInstance(rendered, bytes)
        out_img = Image.open(io.BytesIO(rendered))
        self.assertEqual(out_img.size, (400, 600))

    def test_render_with_out_of_bounds_box(self):
        # Should not crash on negative coords or coords extending past boundaries
        raw = self._create_sample_image_bytes(400, 600)
        items = [
            {"id": "b-out", "kind": "bubble", "box": [-20, -10, 500, 700]}
        ]
        order = ["b-out"]
        rendered = render_guided_overlay(raw, items=items, order=order)
        out_img = Image.open(io.BytesIO(rendered))
        self.assertEqual(out_img.size, (400, 600))

    def test_render_with_custom_sequence_order(self):
        raw = self._create_sample_image_bytes(400, 600)
        items = [
            {"id": "b-1", "kind": "bubble", "box": [50, 50, 100, 50]},
            {"id": "b-2", "kind": "bubble", "box": [200, 50, 100, 50]},
        ]
        # Reverse order: b-2 is 1st, b-1 is 2nd
        order = ["b-2", "b-1"]
        rendered = render_guided_overlay(raw, items=items, order=order)
        self.assertIsInstance(rendered, bytes)
        out_img = Image.open(io.BytesIO(rendered))
        self.assertEqual(out_img.size, (400, 600))


if __name__ == "__main__":
    unittest.main()
