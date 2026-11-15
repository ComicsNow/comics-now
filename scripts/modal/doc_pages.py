"""PDF and image/fixed-layout comic EPUB page listing & extraction for Modal."""

from __future__ import annotations

import importlib.util
import pathlib
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
_SRC_RE = re.compile(r"""(?:src|xlink:href|href)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
_PAGE_PREFIX = "page-"


def _natural_key(name: str):
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", name)]


def _local_tag(tag: str) -> str:
    return tag.split("}")[-1].lower() if tag else ""


def _resolve_zip_path(base_dir: str, href: str) -> str:
    clean = href.split("#", 1)[0].split("?", 1)[0].strip()
    joined = posixpath.join(base_dir, clean) if base_dir else clean
    return posixpath.normpath(joined).lstrip("./")


def _pdf_page_index(page_name: str) -> int:
    stem = pathlib.Path(page_name).stem
    if stem.startswith(_PAGE_PREFIX):
        try:
            return int(stem[len(_PAGE_PREFIX):]) - 1
        except ValueError:
            pass
    raise ValueError(f"Invalid PDF page token: {page_name}")


def _import_pymupdf():
    try:
        import pymupdf
        return pymupdf
    except ImportError:
        import fitz
        return fitz


def list_pdf_pages(comic_path: str) -> list[str]:
    fitz = _import_pymupdf()

    doc = fitz.open(comic_path)
    try:
        return [f"page-{i + 1:04d}.jpg" for i in range(len(doc))]
    finally:
        doc.close()


def _load_doc_worker():
    """Share PDF page rendering with scripts/doc_worker.py so Modal matches viewer dimensions."""
    worker_path = pathlib.Path(__file__).resolve().parents[1] / "doc_worker.py"
    spec = importlib.util.spec_from_file_location("comics_now_doc_worker", str(worker_path))
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load doc_worker from {worker_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_pdf_pages(comic_path: str, page_names: list[str], dpi: int = 180) -> dict[str, bytes]:
    fitz = _import_pymupdf()
    render_pdf_page_bytes = _load_doc_worker().render_pdf_page_bytes

    doc = fitz.open(comic_path)
    results: dict[str, bytes] = {}
    try:
        for name in page_names:
            idx = _pdf_page_index(name)
            if 0 <= idx < len(doc):
                results[name] = render_pdf_page_bytes(doc, idx, dpi=dpi)
    finally:
        doc.close()
    return results


def _find_opf_path(zf: zipfile.ZipFile, names_lower: dict[str, str]) -> str | None:
    if "meta-inf/container.xml" in names_lower:
        try:
            root = ET.fromstring(zf.read(names_lower["meta-inf/container.xml"]))
            for elem in root.iter():
                if _local_tag(elem.tag) == "rootfile" and elem.attrib.get("full-path"):
                    return elem.attrib["full-path"]
        except ET.ParseError:
            pass
    for n in zf.namelist():
        if n.lower().endswith(".opf"):
            return n
    return None


def _parse_opf_pages(zf: zipfile.ZipFile, opf_path: str, names_lower: dict[str, str]) -> list[str]:
    opf_key = names_lower.get(opf_path.lower())
    if not opf_key:
        return []
    try:
        root = ET.fromstring(zf.read(opf_key))
    except ET.ParseError:
        return []

    opf_dir = posixpath.dirname(opf_key)
    manifest: dict[str, tuple[str, str, str]] = {}
    cover_id: str | None = None
    spine_ids: list[str] = []

    for elem in root.iter():
        tag = _local_tag(elem.tag)
        if tag == "meta" and elem.attrib.get("name", "").lower() == "cover":
            cover_id = elem.attrib.get("content")
        elif tag == "item" and elem.attrib.get("id") and elem.attrib.get("href"):
            item_id = elem.attrib["id"]
            href = _resolve_zip_path(opf_dir, elem.attrib["href"])
            media = elem.attrib.get("media-type", "").lower()
            props = elem.attrib.get("properties", "").lower()
            manifest[item_id] = (href, media, props)
            if "cover-image" in props.split():
                cover_id = cover_id or item_id
        elif tag == "itemref" and elem.attrib.get("idref"):
            spine_ids.append(elem.attrib["idref"])

    ordered: list[str] = []
    seen: set[str] = set()

    def _add(entry: str) -> None:
        actual = names_lower.get(entry.lower())
        if actual and actual not in seen and pathlib.Path(actual).suffix.lower() in _IMAGE_EXTS:
            seen.add(actual)
            ordered.append(actual)

    if cover_id and cover_id in manifest:
        _add(manifest[cover_id][0])

    for idref in spine_ids:
        item = manifest.get(idref)
        if not item:
            continue
        href, media, _ = item
        if media.startswith("image/") or pathlib.Path(href).suffix.lower() in _IMAGE_EXTS:
            _add(href)
            continue
        actual_xhtml = names_lower.get(href.lower())
        if actual_xhtml:
            try:
                text = zf.read(actual_xhtml).decode("utf-8", errors="ignore")
            except Exception:
                continue
            xhtml_dir = posixpath.dirname(actual_xhtml)
            for match in _SRC_RE.findall(text):
                cand = _resolve_zip_path(xhtml_dir, match)
                _add(cand)
    return ordered


def list_epub_pages(comic_path: str) -> list[str]:
    with zipfile.ZipFile(comic_path) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/") and "__MACOSX" not in n]
        names_lower = {n.lower(): n for n in names}
        opf_path = _find_opf_path(zf, names_lower)
        ordered = _parse_opf_pages(zf, opf_path, names_lower) if opf_path else []
        if ordered:
            return ordered
        imgs = [n for n in names if pathlib.Path(n).suffix.lower() in _IMAGE_EXTS]
        return sorted(imgs, key=_natural_key)


def read_epub_pages(comic_path: str, page_names: list[str]) -> dict[str, bytes]:
    with zipfile.ZipFile(comic_path) as zf:
        return {name: zf.read(name) for name in page_names if name in zf.namelist()}
