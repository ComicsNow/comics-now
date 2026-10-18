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
