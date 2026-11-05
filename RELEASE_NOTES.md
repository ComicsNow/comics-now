# Comics Now! v3.3.0 Release Notes

Welcome to **Comics Now! v3.3.0** — a minor release focused on making tag search, converted-file management, and format filtering behave consistently across CBZ and CBR libraries. No README or wiki changes are included: these are corrections to behavior that should have worked already.

---

## 🔧 What's Fixed in v3.3.0

### 1. Tag Search now works for CBR — and for any single comic
* **Per-comic Tag Search** is available from the admin comic context menu for any CBZ or CBR, including files outside the scan inbox.
  - Backed by `POST /api/v1/tag-comics-now/run-file` and the new MCP tool `run_tag_search`.
  - Per-file runs are serialized; a full scan, another file run, or a pending review returns a clear `409`.
* **CBR cover matching**:
  - Node extracts the CBR cover and passes it to the Python tagger, which uses the supplied cover before any cache or archive extraction and falls back safely if it is unreadable.
  - `.cbz`, `.cbr`, `.rar`, and `.pdf` extensions are stripped from search queries and similarity scoring.
  - Adjacent sidecars are read first for non-ZIP files, so a complete sidecar next to a CBR counts as complete metadata.
  - CBR writes always go to a sidecar `ComicInfo.xml`; RAR archives are never repacked.
* **Companion mirroring**:
  - A successful auto-tag or review apply mirrors metadata to the linked converted CBZ (`originalPath`) using update-only database writes.
  - Mirrored content is skipped when the primary tag did not verify successfully.

### 2. Converted comics stay linked to their kept originals
* New `comics.originalPath` column, created automatically on upgrade and indexed.
* Full scans backfill links for existing converted files and skip re-conversion while a linked CBZ exists.
* Moving a converted comic carries its kept CBR/PDF original and sidecar alongside it, aborts on destination collisions, and rolls the original back if the comic move fails.
* Renaming a converted comic intentionally leaves the original and its link untouched, so the link stays valid.

### 3. Allowed Library Formats are respected everywhere
* The library view, search results, and folder browser now hide files whose format is disabled in the Allowed Library Formats setting.
* Filtering is read-side only: no database rows or files are removed, and cleanup still deletes only comics whose files are actually gone from disk.

### 4. Guided View detection hardened for CBR
* Each comic is read through one serialized archive session, avoiding repeated RAR extraction.
* Zero-panel results are treated as failures, so empty sidecars are no longer written; sidecar writes are atomic.
* Sidecar reconciliation validates content, preventing empty or corrupt sidecars from masking failed detections during rescans.
* Stale RAR extraction directories are cleaned at startup.
* Modal-guided detection now supports CBR through the project virtual environment, which provides `rarfile`.

### 5. Tagger reliability improvements
* Gemini Vision candidate images served as `application/octet-stream` are recognized by magic bytes instead of being rejected; non-image responses are skipped.
* Temporary Gemini API failures (for example, HTTP 503) now fall back to the standard tagger ranking instead of discarding valid candidates. An explicit visual no-match still rejects candidates.

---

## ⬆️ Upgrade Notes
* The `originalPath` column is added automatically at startup; links for existing converted comics are backfilled during the next full scan.
* CBR tag metadata is written to an adjacent sidecar file. Comic archives are left byte-for-byte unchanged.
* No settings changes are required.

---

## 📦 v3.3.0 Changelog
1. `feat(tagger)`: add per-comic tag search with CBR support (`b44b2bd`)
2. `feat(scan)`: link converted comics to their kept original files (`c4de6ea`)
3. `feat(library)`: hide comics whose format is disabled in settings (`9933997`)
4. `feat(guided)`: harden CBR detection and sidecar lifecycle (`0d52af1`)
5. `test(archive)`: cover temp-dir RAR entry extraction (`ffa60fe`)

---

## 🧪 Verification & Test Results
- **Full Jest suite**: `179 suites passed, 1437 tests passed`.
- **Python tagger suite**: `172 passed`.
- **MCP suite**: `43 passed`.
- **Production build**: Vite client bundle compiled successfully.
- **Live CBR verification**: a complete review → apply cycle tagged both the CBR and its linked CBZ, wrote the sidecar, left the CBR checksum unchanged, and the skip path cleared pending review without starting a full scan.
- **Architecture ratchet**: all touched modules remain under the 380-line ceiling.

---

# Previous Release: Comics Now! v3.2.0

- Configurable **Page Cache Limit** under **Settings → General**, with live usage reporting and immediate pruning — no restart required.
- See GitHub Releases for the full v3.2.0 notes.
