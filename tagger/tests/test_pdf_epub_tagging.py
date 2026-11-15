"""TDD tests for PDF and comic EPUB cover extraction, validation, and sidecar tagging."""

import os
import sys
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

TAGGER_ROOT = Path(__file__).resolve().parents[1]
if str(TAGGER_ROOT) not in sys.path:
    sys.path.insert(0, str(TAGGER_ROOT))


def _make_jpeg_bytes(color=(120, 40, 200), size=(60, 90)):
    buf = BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def _make_epub(epub_path: Path):
    with zipfile.ZipFile(epub_path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>'
            "</container>",
        )
        zf.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0" encoding="utf-8"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
            "<manifest>"
            '<item id="c" href="images/z-cover.jpg" media-type="image/jpeg" properties="cover-image"/>'
            '<item id="p2" href="images/001.jpg" media-type="image/jpeg"/>'
            "</manifest>"
            '<spine><itemref idref="p2"/></spine>'
            "</package>",
        )
        zf.writestr("OEBPS/images/z-cover.jpg", _make_jpeg_bytes((200, 10, 10)))
        zf.writestr("OEBPS/images/001.jpg", _make_jpeg_bytes((10, 200, 10)))


def test_is_safe_cbz_path_accepts_pdf_and_epub(tmp_path):
    from tagger_app.config import is_safe_cbz_path

    pdf_file = tmp_path / "issue.pdf"
    epub_file = tmp_path / "issue.epub"
    pdf_file.write_bytes(b"%PDF-1.4\n")
    _make_epub(epub_file)

    assert is_safe_cbz_path(str(pdf_file)) is True
    assert is_safe_cbz_path(str(epub_file)) is True


def test_clean_search_query_strips_epub():
    from tagger_app.core.query import clean_search_query

    assert clean_search_query("Absolute Batman 001 (2024).epub") == "Absolute Batman"


def test_extract_cover_from_epub_uses_opf_cover(tmp_path):
    from tagger_app.core.comic_files import extract_cover_from_comic

    epub_file = tmp_path / "comic.epub"
    _make_epub(epub_file)
    out_dir = tmp_path / "covers"

    cover = extract_cover_from_comic(str(epub_file), output_dir=str(out_dir))
    assert os.path.isfile(cover)
    with Image.open(cover) as im:
        assert im.getpixel((10, 10))[0] > 150


def test_extract_cover_from_pdf(tmp_path):
    fitz = pytest.importorskip("fitz")
    from tagger_app.core.comic_files import extract_cover_from_comic

    pdf_file = tmp_path / "comic.pdf"
    doc = fitz.open()
    page = doc.new_page(width=200, height=300)
    page.draw_rect(page.rect, color=(0, 0, 1), fill=(0, 0, 1))
    doc.save(str(pdf_file))
    doc.close()

    out_dir = tmp_path / "covers"
    cover = extract_cover_from_comic(str(pdf_file), output_dir=str(out_dir))
    assert os.path.isfile(cover)


def test_write_comic_info_forces_sidecar_for_epub_even_when_archive_mode(tmp_path):
    from tagger_app.core.comicinfo import write_comic_info, sidecar_path_for

    epub_file = tmp_path / "comic.epub"
    _make_epub(epub_file)
    before_bytes = epub_file.read_bytes()

    write_comic_info(str(epub_file), "<ComicInfo><Series>Test</Series></ComicInfo>", storage_mode="archive")

    assert epub_file.read_bytes() == before_bytes
    assert os.path.isfile(sidecar_path_for(str(epub_file)))
