# Comics Now! v3.1.0 Release Notes

Welcome to **Comics Now! v3.1.0** — introducing independent **CBR** and **PDF** source-file retention controls after `.cbz` conversion, defaulting safely to **Keep Originals** on new installations while allowing administrators to configure **Keep** or **Delete** per format directly in **Settings → Comics Defaults → Allowed Library Formats**.

---

## 🌟 What's New in v3.1.0

### 1. Independent CBR & PDF Post-Conversion Retention Settings (`Keep` by Default)
* **Safe Non-Destructive Default (`Keep Originals`)**:
  - Previously, `.cbr` conversion unconditionally deleted the source `.cbr` file after creating the `.cbz` archive, while `.pdf` conversion had no configurable retention toggle.
  - Both `delete_cbr_after_conversion` and `delete_pdf_after_conversion` now default to `false` (**Keep Originals**) in `DEFAULT_CONFIG` (`server/config/store.js`) and `config.example.json`.
* **Granular Format Controls in Web UI (`Settings → Comics Defaults → Allowed Library Formats`)**:
  - **Original CBR Files After Conversion** (`#cbr-conversion-originals-select`): Choose between **Keep CBR Originals (Default)** and **Delete CBR After Conversion**.
  - **Original PDF Files After Conversion** (`#pdf-conversion-originals-select`): Choose between **Keep PDF Originals (Default)** and **Delete PDF After Conversion**.
  - Integrated with the **Comics Defaults** dirty-state indicator (`#comics-defaults-dirty-indicator`) and persisted to both `config.json` and the SQLite `settings` table via `GET /api/v1/settings` and `POST /api/v1/settings`.
* **Conversion Pipeline & Scanner Idempotency**:
  - Updated `server/services/library-conversion.js`, `scripts/convert_cbr_to_cbz.sh`, and `scripts/pdf2cbz.sh` to pass and honor `DELETE_ORIGINALS=true|false` independently for `.cbr` and `.pdf` conversions.
  - Hardened `server/services/scan/crawler.js` to check if a sibling `.cbz` file already exists on disk before invoking `convertCbrToCbz` or `convertPdfToCbz`, preventing kept `.cbr` and `.pdf` originals from being re-converted on subsequent library scans.

---

## 📦 v3.1.0 Changelog
1. `feat(settings)`: add separate CBR and PDF keep/delete after conversion settings (default keep) (`b515eee`)

---

## 🧪 Verification & Test Results
- **Conversion & Settings Unit Tests (`tests/conversionDeleteOriginalsSetting.test.js`, `tests/userSettings.test.js`, `tests/settings.test.js`, `tests/configExample.test.js`)**: `26 passed, 0 failed`.
- **Architectural Ratchet & Tailwind Inventory (`tests/architectureRatchet.test.js`, `tests/style/tailwind-class-inventory.test.js`)**: `6 passed, 0 failed` (extracted `public/js/settings/library-pref-row.js` to keep all settings modules well below the 380-line ceiling).
- **Production Asset Compilation**: Tailwind CSS (`npm run build:css`) and Vite client bundle (`npm run build`) compiled cleanly and deployed to `comics-now.service`.

---

# Previous Major Release: Comics Now! v3.0.0

Welcome to **Comics Now! v3.0.0** — a landmark major release defined by a complete **47-module architectural modernization** across the entire frontend, backend, Python tagger, and MCP server stack, alongside persistent local Device Libraries with live sync feedback, relevance-ranked library search, non-Gemini multi-source metadata synthesis, unified double-tap zoom and viewer ergonomics, and offline Service Worker shell isolation.

### v3.0.0 Highlights
1. **Complete Tier 1–8 Architecture Modernization (47 / 47 Monoliths Decomposed)**: Decomposed all Tier 1–4 monoliths across `public/js/`, `server/`, `tagger/tagger_app/`, and `mcp/comics_mcp/` under the 380-line Single Responsibility Ceiling enforced by `tests/architectureRatchet.test.js`.
2. **Local Device Libraries**: Persistent IndexedDB `Blob` storage, automatic folder deduplication, multi-library root view preservation, and live background sync progress (`#device-library-sync-toast`).
3. **Library Search Filtering & Relevance Ranking**: Strict field filtering (`Title`, `Series`, `Publisher`, `Character`, `All`) and multi-tier relevance ordering.
4. **Manual Metadata Search Feedback & Non-Gemini Staged Synthesis**: Visual candidate selection feedback and deterministic multi-source synthesis (`POST /api/v1/metadata/synthesize`).
5. **Interactive Tap-to-Zoom, Scrubber & Continuous Reader Ergonomics**: Unified double-tap zoom, fullscreen scrubber drag guard, and continuous reader lifecycle cleanup.
6. **Offline Reading & PWA Service Worker (`v9.2`) Isolation**: Hardened app shell cache protection for offline cold-boots.
