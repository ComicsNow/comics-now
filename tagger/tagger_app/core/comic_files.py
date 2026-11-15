"""Supported comic file helpers and cover extraction for CBZ, PDF, and comic EPUB."""

from __future__ import annotations

import io
import os
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile
from PIL import Image

SUPPORTED_COMIC_EXTENSIONS = (".cbz", ".cbr", ".pdf", ".epub")
SIDECAR_ONLY_EXTENSIONS = (".cbr", ".pdf", ".epub")
_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
_SRC_RE = re.compile(r"""(?:src|xlink:href|href)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)


def is_supported_comic_file(file_path: str) -> bool:
    return bool(file_path) and str(file_path).lower().endswith(SUPPORTED_COMIC_EXTENSIONS)


def is_sidecar_only_file(file_path: str) -> bool:
    return bool(file_path) and str(file_path).lower().endswith(SIDECAR_ONLY_EXTENSIONS)


def _save_cover_jpeg(raw_bytes: bytes, dest_path: str, target_width: int = 1024) -> str:
    try:
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        w, h = img.size
        if w > target_width:
            new_h = int(h * target_width / w)
            img = img.resize((target_width, new_h), Image.LANCZOS)
        img.save(dest_path, format="JPEG", quality=85)
    except Exception:
        with open(dest_path, "wb") as out_f:
            out_f.write(raw_bytes)
    return dest_path


def extract_cover_from_pdf(pdf_path: str, output_dir: str = "temp_covers") -> str:
    import fitz

    os.makedirs(output_dir, exist_ok=True)
    doc = fitz.open(pdf_path)
    try:
        if len(doc) == 0:
            raise ValueError(f"Error: PDF has no pages: {pdf_path}")
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(150.0 / 72.0, 150.0 / 72.0), alpha=False)
        dest_path = os.path.join(output_dir, f"cover_{os.path.basename(pdf_path)}.jpg")
        return _save_cover_jpeg(pix.tobytes("jpeg"), dest_path)
    finally:
        doc.close()


def _find_epub_cover_entry(zf: zipfile.ZipFile) -> str:
    names = [n for n in zf.namelist() if not n.endswith("/") and "__MACOSX" not in n]
    names_lower = {n.lower(): n for n in names}

    opf_path = None
    if "meta-inf/container.xml" in names_lower:
        try:
            c_root = ET.fromstring(zf.read(names_lower["meta-inf/container.xml"]))
            for elem in c_root.iter():
                if elem.tag.split("}")[-1].lower() == "rootfile" and elem.attrib.get("full-path"):
                    opf_path = elem.attrib["full-path"]
                    break
        except ET.ParseError:
            pass
    if not opf_path:
        opf_path = next((n for n in names if n.lower().endswith(".opf")), None)

    if opf_path and opf_path.lower() in names_lower:
        try:
            opf_key = names_lower[opf_path.lower()]
            opf_dir = posixpath.dirname(opf_key)
            root = ET.fromstring(zf.read(opf_key))
            manifest = {}
            cover_id = None
            spine_ids = []
            for elem in root.iter():
                tag = elem.tag.split("}")[-1].lower()
                if tag == "meta" and elem.attrib.get("name", "").lower() == "cover":
                    cover_id = elem.attrib.get("content")
                elif tag == "item" and elem.attrib.get("id") and elem.attrib.get("href"):
                    href = posixpath.normpath(posixpath.join(opf_dir, elem.attrib["href"].split("#", 1)[0])).lstrip("./")
                    manifest[elem.attrib["id"]] = (href, elem.attrib.get("media-type", "").lower())
                    if "cover-image" in elem.attrib.get("properties", "").lower().split():
                        cover_id = cover_id or elem.attrib["id"]
                elif tag == "itemref" and elem.attrib.get("idref"):
                    spine_ids.append(elem.attrib["idref"])

            if cover_id and cover_id in manifest:
                cand = names_lower.get(manifest[cover_id][0].lower())
                if cand and cand.lower().endswith(_IMAGE_EXTS):
                    return cand

            for idref in spine_ids:
                href, media = manifest.get(idref, ("", ""))
                cand = names_lower.get(href.lower())
                if cand and (media.startswith("image/") or cand.lower().endswith(_IMAGE_EXTS)):
                    return cand
                if cand:
                    text = zf.read(cand).decode("utf-8", errors="ignore")
                    xdir = posixpath.dirname(cand)
                    for m in _SRC_RE.findall(text):
                        img_cand = posixpath.normpath(posixpath.join(xdir, m.split("#", 1)[0])).lstrip("./")
                        actual = names_lower.get(img_cand.lower())
                        if actual and actual.lower().endswith(_IMAGE_EXTS):
                            return actual
        except Exception:
            pass

    imgs = sorted([n for n in names if n.lower().endswith(_IMAGE_EXTS)])
    if not imgs:
        raise ValueError(f"Error: No cover image found in EPUB: {zf.filename}")
    return imgs[0]


def extract_cover_from_epub(epub_path: str, output_dir: str = "temp_covers") -> str:
    os.makedirs(output_dir, exist_ok=True)
    if not zipfile.is_zipfile(epub_path):
        raise ValueError(f"Error: {epub_path} is not a valid zip/epub file.")
    with zipfile.ZipFile(epub_path, "r") as zf:
        entry = _find_epub_cover_entry(zf)
        dest_path = os.path.join(output_dir, f"cover_{os.path.basename(epub_path)}.jpg")
        return _save_cover_jpeg(zf.read(entry), dest_path)


def extract_cover_from_comic(file_path: str, output_dir: str = "temp_covers") -> str:
    lower = str(file_path).lower()
    if lower.endswith(".pdf"):
        return extract_cover_from_pdf(file_path, output_dir=output_dir)
    if lower.endswith(".epub"):
        return extract_cover_from_epub(file_path, output_dir=output_dir)
    from tagger_app.core.covers import extract_cover_from_cbz

    return extract_cover_from_cbz(file_path, output_dir=output_dir)
