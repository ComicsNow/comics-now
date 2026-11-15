#!/usr/bin/env python3
"""Helper worker for PDF/EPUB info, page rendering, cover extraction, and metadata."""

import argparse
import json
import os
import sys

try:
    import pymupdf as fitz  # PyMuPDF
except ImportError:
    try:
        import fitz  # Legacy PyMuPDF alias
    except ImportError:
        fitz = None


def validate_safe_path(file_path):
    if not file_path or not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    if os.path.islink(file_path):
        raise ValueError(f"Refusing to open symlink: {file_path}")


def format_page_name(index_zero_based):
    return f"page-{index_zero_based + 1:04d}.jpg"


def render_pdf_page_bytes(doc, page_index, dpi=180):
    if page_index < 0 or page_index >= len(doc):
        raise IndexError(f"Page index {page_index} out of range (0..{len(doc) - 1})")
    page = doc.load_page(page_index)
    # Fast lossless-extract path for scanned single-image comic pages without rotation/overlays
    try:
        images = page.get_images(full=True)
        if len(images) == 1 and page.rotation == 0:
            xref = images[0][0]
            extracted = doc.extract_image(xref)
            ext = (extracted.get("ext") or "").lower()
            img_bytes = extracted.get("image")
            if img_bytes and ext in ("jpeg", "jpg", "png", "webp"):
                # Only use direct image if it covers >= 70% of the page area
                rect = page.get_image_rects(xref)
                if rect:
                    page_area = abs(page.rect.width * page.rect.height) or 1.0
                    img_area = abs(rect[0].width * rect[0].height)
                    if img_area / page_area >= 0.70 and ext in ("jpeg", "jpg"):
                        return img_bytes
    except Exception:
        pass

    pix = page.get_pixmap(dpi=dpi, alpha=False)
    return pix.tobytes("jpeg", jpg_quality=90)


def handle_info(pdf_path):
    validate_safe_path(pdf_path)
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is not installed")
    with fitz.open(pdf_path) as doc:
        count = len(doc)
        pages = [format_page_name(i) for i in range(count)]
        return {"pageCount": count, "pages": pages}


def handle_page(pdf_path, page_index, dpi, out_path):
    validate_safe_path(pdf_path)
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is not installed")
    with fitz.open(pdf_path) as doc:
        data = render_pdf_page_bytes(doc, page_index, dpi=dpi)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(data)
    return {"ok": True, "bytes": len(data)}


def handle_metadata(pdf_path):
    validate_safe_path(pdf_path)
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is not installed")
    with fitz.open(pdf_path) as doc:
        meta = doc.metadata or {}
        return {
            "title": (meta.get("title") or "").strip(),
            "writer": (meta.get("author") or "").strip(),
            "genre": (meta.get("subject") or "").strip(),
            "summary": (meta.get("keywords") or "").strip(),
            "pageCount": len(doc),
        }


def main():
    parser = argparse.ArgumentParser(description="PDF/Document helper for Comics Now")
    parser.add_argument("--mode", required=True, choices=["info", "page", "cover", "metadata"])
    parser.add_argument("--path", required=True)
    parser.add_argument("--page", type=int, default=0, help="0-based page index")
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    try:
        if args.mode == "info":
            res = handle_info(args.path)
        elif args.mode == "page":
            if not args.out:
                raise ValueError("--out is required for --mode page")
            res = handle_page(args.path, args.page, args.dpi, args.out)
        elif args.mode == "cover":
            if not args.out:
                raise ValueError("--out is required for --mode cover")
            res = handle_page(args.path, 0, args.dpi, args.out)
        elif args.mode == "metadata":
            res = handle_metadata(args.path)
        else:
            raise ValueError(f"Unsupported mode: {args.mode}")
        sys.stdout.write(json.dumps(res))
    except Exception as exc:
        sys.stderr.write(f"{exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
