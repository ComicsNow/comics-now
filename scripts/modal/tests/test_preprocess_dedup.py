import io
import zipfile
import pathlib
import sys
import numpy as np
import pytest
from unittest.mock import patch
from PIL import Image

# Ensure scripts/modal is in sys.path
MODAL_DIR = str(pathlib.Path(__file__).parent.parent)
if MODAL_DIR not in sys.path:
    sys.path.insert(0, MODAL_DIR)

import modal_app

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"
FIXTURE_WESTERN = str(FIXTURES_DIR / "test_western_23p.cbz")
FIXTURE_MANGA = str(FIXTURES_DIR / "test_manga_25p.cbz")


def _get_first_page_bytes(cbz_path: str) -> bytes:
    with zipfile.ZipFile(cbz_path) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
        names.sort()
        return zf.read(names[0])


def test_prepare_page_tensors_western():
    img_bytes = _get_first_page_bytes(FIXTURE_WESTERN)

    # Baseline calculations
    base_panel_tensor, base_psx, base_psy, base_ppx, base_ppy, base_w, base_h, base_gray = (
        modal_app._preprocess(img_bytes, "fill")
    )
    base_bubble_tensor, base_bsx, base_bsy, base_bpx, base_bpy, _, _, _ = (
        modal_app._preprocess(img_bytes, "contain")
    )

    # Optimized single-pass
    prepared = modal_app._prepare_page_tensors(img_bytes, "western")

    p_tensor, p_sx, p_sy, p_px, p_py = prepared["panel"]
    b_tensor, b_sx, b_sy, b_px, b_py = prepared["bubble"]

    assert prepared["orig_w"] == base_w
    assert prepared["orig_h"] == base_h
    np.testing.assert_array_equal(prepared["gray"], base_gray)

    # Panel (fill) equivalence
    assert p_sx == base_psx
    assert p_sy == base_psy
    assert p_px == base_ppx
    assert p_py == base_ppy
    np.testing.assert_allclose(p_tensor, base_panel_tensor, atol=1e-5)

    # Bubble (contain) equivalence
    assert b_sx == base_bsx
    assert b_sy == base_bsy
    assert b_px == base_bpx
    assert b_py == base_bpy
    np.testing.assert_allclose(b_tensor, base_bubble_tensor, atol=1e-5)


def test_prepare_page_tensors_manga():
    img_bytes = _get_first_page_bytes(FIXTURE_MANGA)

    # Baseline calculations
    base_panel_tensor, base_psx, base_psy, base_ppx, base_ppy, base_w, base_h, base_gray = (
        modal_app._preprocess(img_bytes, "contain")
    )
    base_bubble_tensor, base_bsx, base_bsy, base_bpx, base_bpy, _, _, _ = (
        modal_app._preprocess(img_bytes, "contain")
    )

    # Optimized single-pass
    prepared = modal_app._prepare_page_tensors(img_bytes, "manga")

    p_tensor, p_sx, p_sy, p_px, p_py = prepared["panel"]
    b_tensor, b_sx, b_sy, b_px, b_py = prepared["bubble"]

    assert prepared["orig_w"] == base_w
    assert prepared["orig_h"] == base_h
    np.testing.assert_array_equal(prepared["gray"], base_gray)

    # Panel & Bubble (contain) equivalence
    assert p_sx == base_psx
    assert p_sy == base_psy
    assert p_px == base_ppx
    assert p_py == base_ppy
    np.testing.assert_allclose(p_tensor, base_panel_tensor, atol=1e-5)

    assert b_sx == base_bsx
    assert b_sy == base_bsy
    assert b_px == base_bpx
    assert b_py == base_bpy
    np.testing.assert_allclose(b_tensor, base_bubble_tensor, atol=1e-5)


def test_image_open_called_only_once():
    img_bytes = _get_first_page_bytes(FIXTURE_WESTERN)
    real_open = Image.open

    with patch("PIL.Image.open", side_effect=real_open) as mock_open:
        modal_app._prepare_page_tensors(img_bytes, "western")
        assert mock_open.call_count == 1
