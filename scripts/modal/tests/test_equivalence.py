import os
import json
import zipfile
import pathlib
import sys
import pytest

# Ensure scripts/modal is in sys.path
MODAL_DIR = str(pathlib.Path(__file__).parent.parent)
if MODAL_DIR not in sys.path:
    sys.path.insert(0, MODAL_DIR)

os.environ["GUIDED_MODELS_DIR"] = "/opt/comics-now/models"
import modal_app

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"
FIXTURE_WESTERN_CBZ = str(FIXTURES_DIR / "test_western_23p.cbz")
FIXTURE_WESTERN_GT = str(FIXTURES_DIR / "test_western_ground_truth.json")
FIXTURE_MANGA_CBZ = str(FIXTURES_DIR / "test_manga_25p.cbz")
FIXTURE_MANGA_GT = str(FIXTURES_DIR / "test_manga_ground_truth.json")


def _extract_page(cbz_path: str, page_name: str) -> bytes:
    with zipfile.ZipFile(cbz_path) as zf:
        return zf.read(page_name)


def test_western_single_pass_matches_baseline():
    """Verify single-pass decompression produces bit-for-bit identical boxes to baseline Python."""
    img_bytes = _extract_page(FIXTURE_WESTERN_CBZ, "page-002.jpg")

    # Baseline (two decodes)
    old_panels = modal_app._detect_panels(img_bytes, "manga", 0.5, 0)
    old_bubbles = modal_app._detect_bubbles(img_bytes, "western")

    # Optimized (single decode)
    prep = modal_app._prepare_page_tensors(img_bytes, "western")
    new_panels = modal_app._detect_panels(comic_type="manga", conf_threshold=0.5, filter_cls=0, prepared=prep)
    new_bubbles = modal_app._detect_bubbles(comic_type="western", prepared=prep)

    assert new_panels == old_panels
    assert new_bubbles == old_bubbles


def test_manga_single_pass_matches_baseline():
    """Verify single-pass decompression produces bit-for-bit identical boxes to baseline Python for manga."""
    with zipfile.ZipFile(FIXTURE_MANGA_CBZ) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
        names.sort()
        target_page = names[0]

    img_bytes = _extract_page(FIXTURE_MANGA_CBZ, target_page)

    # Baseline (two decodes)
    old_panels = modal_app._detect_panels(img_bytes, "manga", 0.1)
    old_bubbles = modal_app._detect_bubbles(img_bytes, "manga")

    # Optimized (single decode)
    prep = modal_app._prepare_page_tensors(img_bytes, "manga")
    new_panels = modal_app._detect_panels(comic_type="manga", conf_threshold=0.1, prepared=prep)
    new_bubbles = modal_app._detect_bubbles(comic_type="manga", prepared=prep)

    assert new_panels == old_panels
    assert new_bubbles == old_bubbles


def test_western_matches_ground_truth_within_tolerance():
    """Verify detected panels closely match Node.js sharp ground truth (IoU > 0.98)."""
    with open(FIXTURE_WESTERN_GT, "r") as f:
        ground_truth = json.load(f)

    target_page = "page-002.jpg"
    expected_panels = ground_truth["pages"][target_page]["panels"]

    img_bytes = _extract_page(FIXTURE_WESTERN_CBZ, target_page)
    res = modal_app.detect_pages_batch.local([[target_page, img_bytes]], "western")
    actual_panels = res[target_page]["panels"]

    assert len(actual_panels) == len(expected_panels)
    for act in actual_panels:
        # Find matching box in expected with high IoU
        best_iou = max(modal_app._iou(act, exp) for exp in expected_panels)
        assert best_iou > 0.98, f"Box {act} has low IoU ({best_iou}) with expected boxes"


def test_modal_xy_cut_western_multicolumn():
    """Verify Modal _sort_boxes uses Recursive XY-Cut for Western multi-column vertical spans."""
    L1 = [20, 20, 360, 260]
    L2 = [20, 300, 360, 280]
    R  = [400, 20, 380, 560]

    assert modal_app._sort_boxes([R, L2, L1], "western") == [L1, L2, R]


def test_modal_xy_cut_manga_multicolumn_rtl():
    """Verify Modal _sort_boxes uses Recursive XY-Cut for Manga RTL multi-column vertical spans."""
    R1 = [420, 20, 360, 260]
    R2 = [420, 300, 360, 280]
    L  = [20, 20, 380, 560]

    assert modal_app._sort_boxes([L, R2, R1], "manga") == [R1, R2, L]


def test_modal_xy_cut_sandwich_and_overlap_tolerance():
    """Verify Modal _sort_boxes handles 3-tier sandwich layouts and slight gutter overlap."""
    top_banner     = [20, 20, 760, 180]
    mid_left_top   = [20, 220, 360, 200]
    mid_left_bot   = [20, 440, 360, 200]
    mid_right_tall = [400, 220, 380, 420]
    bot_banner     = [20, 660, 760, 180]

    scrambled = [bot_banner, mid_right_tall, mid_left_bot, top_banner, mid_left_top]
    assert modal_app._sort_boxes(scrambled, "western") == [
        top_banner, mid_left_top, mid_left_bot, mid_right_tall, bot_banner
    ]
    assert modal_app._sort_boxes(scrambled, "manga") == [
        top_banner, mid_right_tall, mid_left_top, mid_left_bot, bot_banner
    ]

    # Overlap tolerance (8px horizontal bleed across gutter)
    L1_bleed = [20, 20, 378, 260]
    L2_bleed = [20, 300, 370, 280]
    R_bleed  = [390, 20, 390, 560]
    assert modal_app._sort_boxes([R_bleed, L2_bleed, L1_bleed], "western") == [L1_bleed, L2_bleed, R_bleed]


def test_modal_extract_polygon_from_proto():
    """Verify Modal _extract_polygon_from_proto extracts simplified polygon contours from YOLO11-seg proto masks."""
    proto_w, proto_h, num_protos = 160, 160, 32
    proto_data = [-5.0] * (num_protos * proto_h * proto_w)
    for y in range(20, 101):
        max_x = 20 + (y - 20)
        for x in range(20, max_x + 1):
            proto_data[y * proto_w + x] = 5.0
    coeffs = [0.0] * num_protos
    coeffs[0] = 1.0

    poly = modal_app._extract_polygon_from_proto(
        coeffs, proto_data, (1, num_protos, proto_h, proto_w),
        [80, 80, 320, 320], 1.0, 1.0, 0.0, 0.0, 640, 640
    )
    assert isinstance(poly, list)
    assert len(poly) >= 3
    for pt in poly:
        assert len(pt) == 2
        assert 75 <= pt[0] <= 410
        assert 75 <= pt[1] <= 410


