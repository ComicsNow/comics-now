# Comics Now! v5.0.0 Release Notes

Welcome to **Comics Now! v5.0.0** — a major release introducing native PDF and fixed-layout comic EPUB reading across streaming, offline PWA downloads, and Local Device Library playback, granular multi-format visibility and auto-conversion controls, safe first-install defaults, isolated local ONNX Guided View processing, and PDF/EPUB cover extraction with external `.ComicInfo.xml` sidecar tagging.

---

## ✨ What's New & Highlights in v5.0.0

### 1. Native PDF & Fixed-Layout Comic EPUB Reading
* **Server Streaming & Page Caching**: Added native PDF rendering via `PyMuPDF` (`doc_worker.py`) and OPF cover/spine-ordered comic EPUB extraction (`yauzl`) with MIME-accurate comic downloads and `archiver`-based CBZ packing.
* **Offline PWA & Local Device Library Playback**: Added client-side PDF rendering via self-hosted `pdfjs-dist` (pre-cached in Service Worker `v9.3` for full offline support) and client-side `JSZip` comic EPUB extraction, preserving OPF spine order across offline and local device reading.

### 2. Multi-Format Visibility, Auto-Conversion & Safe First-Install Defaults
* **Format Visibility Checkboxes**: Choose independently which comic formats appear in your library (`CBZ`, `CBR`, `PDF`, `EPUB`).
* **Explicit Auto-Conversion & Original Retention**: Added a master auto-convert toggle (`auto_convert_enabled`), per-format conversion checkboxes (`CBR → CBZ`, `PDF → CBZ`, `EPUB → CBZ`), and per-format Keep/Delete Original selectors (`delete_cbr_after_conversion`, `delete_pdf_after_conversion`, `delete_epub_after_conversion`).
* **Safe First-Install Defaults**: Fresh installs now default to auto-conversion **OFF**, Keep Originals **ON** for all formats, Guided View processing **OFF** (`autoOnAdd: false`, `scheduleEnabled: false`, `useModal: false`), and metadata storage set to **XML Sidecar + DB** (`sidecar`).

### 3. Guided View Hardening (PDF/EPUB, Isolated ONNX Worker & Fallbacks)
* **PDF & Comic EPUB Support**: Extended both Modal GPU and local CPU Guided View pipelines to detect panels and bubbles on `.pdf` and `.epub` comics.
* **Isolated Local ONNX Worker**: Moved `onnxruntime-node` inference into a dedicated `child_process.fork` worker (`onnx-worker.js`) serialized by `localCpuMutex` with immediate `SIGKILL` cancellation support.
* **Detection & Coordinate Alignment Fixes**: Added EXIF orientation normalization (`sharp().rotate()` locally and `ImageOps.exif_transpose` on Modal), a `0.5 → 0.15` confidence retry fallback when western comics return only full-page fallback boxes, shared `doc_worker.py` PDF page extraction for Modal so detected panel/bubble coordinates match the reader 1:1, and resilient trailing-JSON parsing in `modal-detector.js`.

### 4. Cover Extraction & Sidecar Tagging for PDF & Comic EPUB
* **Cover Extraction**: Added `.pdf` first-page rendering and OPF-ordered `.epub` cover extraction in the Python tagger service and Node tagger bridges.
* **Non-Destructive `.ComicInfo.xml` Sidecars**: `.epub`, `.pdf`, and `.cbr` files always write metadata to adjacent `.ComicInfo.xml` sidecars so source archives remain untouched, and staging folder tagger scans strictly filter to supported, allowed comic extensions (ignoring `.xml` sidecars, `.aria2` partial downloads, and hidden files).

---

## ⬆️ Upgrade & Modal GPU Deployment Notes
* **Existing Libraries**: Backward-compatible with existing `comics-now.db` databases and reading lists; user reading progress and reading lists remain untouched.
* **Updating Modal GPU App (`comics-guided-view`)**:
  * Existing Modal deployments continue working for `.cbz`, `.cbr`, `.pdf`, and `.epub` because page extraction runs locally before WebP upload.
  * To enable the remote EXIF orientation fix and `0.5 → 0.15` western zero-panel fallback in `detect_pages_batch`, redeploy `scripts/modal/modal_app.py` once (no model re-upload is needed):
    ```bash
    .venv/bin/python3 -m modal deploy scripts/modal/modal_app.py
    ```
  * If your Modal account defaults to a newer image builder version than your local `modal` Python package supports, pin a supported builder version during deploy (or upgrade `modal` in `.venv`):
    ```bash
    MODAL_IMAGE_BUILDER_VERSION=2025.06 .venv/bin/python3 -m modal deploy scripts/modal/modal_app.py
    ```
* **Client Cache**: Frontend assets are rebuilt into `public/dist/` and `public/vendor/pdfjs/`; Service Worker `v9.3` will automatically update cached offline assets.

---

## 📦 v5.0.0 Changelog
1. `feat(formats)`: add multi-format visibility (`cbz`/`cbr`/`pdf`/`epub`), explicit `auto_convert_enabled`, per-format `EPUB → CBZ` conversion, Keep/Delete original selectors, and safe first-install defaults
2. `feat(reader,offline)`: add native PDF and fixed-layout comic EPUB streaming, offline PWA playback, Local Device Library support, and self-hosted `pdfjs-dist` SW precaching
3. `feat(guided)`: add `.pdf`/`.epub` Guided View support, isolated `SIGKILL`-cancellable local ONNX worker with `localCpuMutex`, EXIF orientation fixes, `0.5 → 0.15` western fallback-box retry, and 1:1 Modal/viewer PDF coordinate parity
4. `feat(tagger)`: add `.pdf`/`.epub` cover extraction, OPF/PDF metadata fallbacks, forced `.ComicInfo.xml` sidecar writes for `.cbr`/`.pdf`/`.epub`, and strict comic-extension filtering in staging scans
