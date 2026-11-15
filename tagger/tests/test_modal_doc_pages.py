import inspect
import io
import pathlib
import sys

import pymupdf
from PIL import Image

SCRIPTS_DIR = pathlib.Path(__file__).resolve().parents[2] / "scripts"
MODAL_DIR = SCRIPTS_DIR / "modal"
for p in (str(MODAL_DIR), str(SCRIPTS_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

import doc_pages  # noqa: E402
import doc_worker  # noqa: E402


def test_read_pdf_pages_matches_viewer_180_dpi():
    sig = inspect.signature(doc_pages.read_pdf_pages)
    assert sig.parameters["dpi"].default == 180


def test_read_pdf_pages_matches_doc_worker_dimensions_on_embedded_jpeg(tmp_path):
    # Create a 200x300 JPEG embedded into a 768x1152 pt PDF page
    img = Image.new("RGB", (200, 300), color=(40, 80, 120))
    img_buf = io.BytesIO()
    img.save(img_buf, format="JPEG")

    pdf_path = tmp_path / "embedded.pdf"
    doc = pymupdf.open()
    page = doc.new_page(width=768, height=1152)
    page.insert_image(page.rect, stream=img_buf.getvalue())
    doc.save(str(pdf_path))
    doc.close()

    with pymupdf.open(str(pdf_path)) as d:
        viewer_bytes = doc_worker.render_pdf_page_bytes(d, 0, dpi=180)
    modal_bytes = doc_pages.read_pdf_pages(str(pdf_path), ["page-0001.jpg"])["page-0001.jpg"]

    viewer_size = Image.open(io.BytesIO(viewer_bytes)).size
    modal_size = Image.open(io.BytesIO(modal_bytes)).size
    assert viewer_size == (200, 300)
    assert modal_size == viewer_size

