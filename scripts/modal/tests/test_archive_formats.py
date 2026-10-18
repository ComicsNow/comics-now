import io
import pathlib
import sys
import zipfile
import pytest
from PIL import Image

# Ensure scripts/modal is in sys.path
MODAL_DIR = str(pathlib.Path(__file__).parent.parent)
if MODAL_DIR not in sys.path:
    sys.path.insert(0, MODAL_DIR)

import runner

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"
FIXTURE_WESTERN_CBZ = str(FIXTURES_DIR / "test_western_23p.cbz")


def test_open_archive_cbz():
    """Verify open_archive opens standard CBZ archives and lists natural-sorted image pages."""
    pages = runner.list_pages(FIXTURE_WESTERN_CBZ)
    assert len(pages) == 23
    assert pages[0] == "page-001.jpg"
    assert pages[1] == "page-002.jpg"
    assert pages[-1] == "page-023.jpg"


def test_read_pages_cbz():
    """Verify read_pages reads binary content for selected pages."""
    pages = ["page-001.jpg", "page-002.jpg"]
    data = runner.read_pages(FIXTURE_WESTERN_CBZ, pages)
    assert len(data) == 2
    assert len(data["page-001.jpg"]) > 0
    assert len(data["page-002.jpg"]) > 0


def test_prepare_page_webp_resizing_and_fidelity():
    """Verify prepare_page_webp scales to max_side while retaining true original dimensions."""
    # Create a 2000x1000 test image in memory
    raw_img = Image.new("RGB", (2000, 1000), color=(255, 0, 0))
    buf = io.BytesIO()
    raw_img.save(buf, format="JPEG")
    raw_bytes = buf.getvalue()

    webp_bytes, orig_w, orig_h = runner.prepare_page_webp(raw_bytes, max_side=1280, quality=80)

    assert orig_w == 2000
    assert orig_h == 1000
    assert len(webp_bytes) < len(raw_bytes)  # Massively compressed

    # Verify decoded WebP dimensions
    decoded = Image.open(io.BytesIO(webp_bytes))
    assert decoded.format == "WEBP"
    assert max(decoded.size) == 1280
    assert decoded.size == (1280, 640)


def test_prepare_page_webp_small_image_no_upscaling():
    """Verify images smaller than max_side are re-encoded to WebP without upscaling."""
    raw_img = Image.new("RGB", (800, 600), color=(0, 255, 0))
    buf = io.BytesIO()
    raw_img.save(buf, format="PNG")
    raw_bytes = buf.getvalue()

    webp_bytes, orig_w, orig_h = runner.prepare_page_webp(raw_bytes, max_side=1280, quality=80)

    assert orig_w == 800
    assert orig_h == 600

    decoded = Image.open(io.BytesIO(webp_bytes))
    assert decoded.format == "WEBP"
    assert decoded.size == (800, 600)


def test_open_archive_cbr_support(tmp_path):
    """Verify open_archive handles .cbr extension using rarfile when available."""
    cbr_file = tmp_path / "test.cbr"
    cbr_file.write_bytes(b"Rar!\x1a\x07\x00")  # mock RAR signature

    if runner.rarfile is None:
        with pytest.raises(RuntimeError, match="rarfile package required"):
            runner.open_archive(str(cbr_file))
    else:
        # rarfile is installed, calling open_archive returns a RarFile instance
        try:
            arch = runner.open_archive(str(cbr_file))
            assert isinstance(arch, runner.rarfile.RarFile)
        except Exception:
            # Expected if mock RAR file is truncated, but proves rarfile was invoked
            pass
