# Comics Now! v3.0.0 Release Notes

Welcome to **Comics Now! v3.0.0** — a landmark major release defined by a complete **47-module architectural modernization** across the entire frontend, backend, Python tagger, and MCP server stack, alongside persistent local Device Libraries with live sync feedback, relevance-ranked library search, non-Gemini multi-source metadata synthesis, unified double-tap zoom and viewer ergonomics, and offline Service Worker shell isolation.

---

## 🌟 Highlights

### 1. Complete Tier 1–8 Architecture Modernization (47 / 47 Monoliths Decomposed)
* **Tier 1 Monolith Decompositions**:
  - **Frontend Application (`public/app.js`)**: Decomposed into modular bootstrap, offline-first library loader, and reading list modal/detail/action submodules (`public/js/app/`).
  - **MCP Server (`mcp/comics_mcp/server.py`)**: Decomposed into cohesive tool domains (`core.py`, `library.py`, `reading_lists.py`, `tagging.py`, `guided_view.py` under `mcp/comics_mcp/tools/`).
  - **Continuous Reader (`public/js/continuous.js`)**: Decomposed into state, progress, viewport, renderer, controls, and lifecycle submodules (`public/js/continuous/`).
  - **Offline Downloads (`public/js/offline/downloads.js`)**: Decomposed into fetcher, queue, UI, and storage submodules (`public/js/offline/downloads/`).
  - **Backend Services & Routes**: Decomposed `server/routes/user/reading-lists.js`, `server/routes/user/metadata.js`, `server/services/metadata.js`, and `tagger/tagger_app/core/metadata.py` into focused, single-responsibility submodules.
* **Tier 2–4 Modular Subsystems**:
  - Decomposed all remaining 39 Tier 2, Tier 3, and Tier 4 modules across `public/js/` (`globals`, `sync`, `reading-list-dag`, `metadata`, `comicvine`, `viewer/navigation`, `viewer/page-previews`, `offline/db-comics`, `progress`, `reading-lists`, `settings`, `smartlists`, `smart-filters`, `device-library`, `guided-reader`) and `server/` (`db`, `config`, `lifecycle`, `library-scan`, `organization`, `guided-reader`, `panel-detector`, `tagger`, `gemini-metadata`, `gemini-tagger`, `admin` routes) so every newly created and refactored module remains under the 380-line ceiling enforced by `tests/architectureRatchet.test.js`.
* **Centralized Reactive Store & Safe DOM Templates**:
  - Unified frontend state management (`public/js/store/`) with action dispatchers, audit trails, and declarative HTML template escaping (`public/js/ui/template.js`).

### 2. Local Device Libraries: Persistent Storage, Deduplication & Live Sync Feedback
* **Zero Repeated Permission Prompts**: Local `.cbz` and `.cbr` files added via **Add Device Library** (or upgraded from existing handle-based libraries) are now persisted directly as IndexedDB `Blob`s (`deviceComics`). Once synced, local comics display **Saved on Device** and open immediately across future browser sessions without re-prompting `"Allow this site to view and copy files"`.
* **Automatic Folder Deduplication**: Re-adding or updating a folder with the same name reuses its existing library ID (`findExistingLibraryIdByName`), automatically cleans up historical duplicate entries in IndexedDB, and prevents duplicate `.device-library-card` elements in the DOM.
* **Multi-Library Root View Preservation**: When a user has 1 server library and 1 or more local Device Libraries, the app now recognizes the combined library count (`deviceLibraryCount`) and stays on the **Libraries** root view instead of auto-skipping to the default server library's publisher view.
* **Live Background Sync Progress (`#device-library-sync-toast`)**: Large local folders are processed sequentially to prevent memory spikes while updating both the library card (`Syncing (X / Y)...` $\rightarrow$ `Saved on Device`) and a floating bottom-right progress banner showing the current filename, comic counter, and progress bar.

### 3. Library Search Filtering & Relevance Ranking
* **Strict Field Filtering**: Selecting a specific search filter (`Title`, `Series`, `Publisher`, `Character`, or `All`) is now honored end-to-end across both the client (`public/js/library/search.js`) and server (`server/routes/user/library/catalog.js`) instead of falling back to an unfiltered match.
* **Multi-Tier Relevance Ordering**: Search results are now ranked by relevance tier (exact match $\rightarrow$ prefix match $\rightarrow$ whole-word match $\rightarrow$ series/title match $\rightarrow$ description/metadata substring match) before alphabetical tie-breaking, so searching `"Batman"` surfaces *Batman* series and issues first rather than incidental character mentions.

### 4. Manual Metadata Search Feedback & Non-Gemini Staged Synthesis
* **Visual Candidate Selection Feedback**: Selecting a candidate in Manual Metadata Search highlights the active card with a green ring (`ring-2 ring-green-500`), displays an **`✓ Applied`** badge, and updates both `#search-status` and `#save-status`.
* **Deterministic Multi-Source Synthesis (Without Gemini)**: Staging metadata from multiple sources when Gemini is disabled now synthesizes the best fields deterministically via `POST /api/v1/metadata/synthesize` (`server/services/metadata/merger.js`) using the same field-priority and union rules as automated tagging.
* **Cover Preview Modal Guard**: Viewing and closing a full-size cover image inside the manual search modal (`#cover-preview-modal`) no longer falsely triggers the unsaved-changes confirmation dialog.
* **Gemini Disable Toggle Enforcement & Payload Trim**: Enforced the Gemini disable toggle across both automated and manual tagging pipelines and omitted bulky `previewBuffer` data from `/api/v1/tag-comics-now/pending` responses.

### 5. Interactive Tap-to-Zoom, Scrubber & Continuous Reader Ergonomics
* **Unified Double-Tap Zoom & Control Activation**: Rebuilt fullscreen double-tap zoom and tap-zone detection so middle-page and letterbox taps reliably toggle reader controls without double-tap second clicks immediately dismissing zoom.
* **Fullscreen Page Scrubber Drag Guard**: Holding or dragging the fullscreen page scrubber slider (`#fullscreen-scrubber-slider`) now pauses and resets the fullscreen control auto-hide timer so the scrubber never disappears mid-drag.
* **Overlay Click-to-Close & Bubble Margins**: Clicking the active zoom overlay (`#bubble-magnifier-overlay`) cleanly dismisses magnification; added +4% horizontal and +3% vertical safety margins for Western speech bubbles and prioritized panel taps (`hitPad = 0`) in Manga Panel Zoom mode.
* **Continuous Reader Lifecycle Cleanup**: Disabling continuous scrolling mode now reliably cleans up continuous DOM containers even when the viewer is already hidden.

### 6. Offline Reading & PWA Service Worker (`v9.2`) Isolation
* **App Shell Cache Protection**: Hardened `public/service-worker.js` (`v9.2`) so only navigations to the application's own root/entry document can refresh the cached app shell, and `sec-fetch-dest: iframe` or `/plugins/` requests bypass the PWA cache. Cold-booting the PWA while offline reliably loads the Comics Now! shell and opens downloaded comics from IndexedDB.

---

## 📦 Changelog (9 Consolidated Commits)

1. `refactor(arch)`: implement centralized store, safe template engine, hoisted requires, and ratchet suite
2. `fix(guided)`: improve panel zoom hit bounds, bubble margins, archive resilience, and worker cancel latch
3. `refactor(tier4)`: decompose Tier 4 server, library, viewer, settings, and MCP modules
4. `refactor(tier3)`: decompose Tier 3 guided reader, smart filters, config, db, and admin routes
5. `refactor(tier2)`: decompose Tier 2 frontend and backend modules
6. `fix(viewer)`: unify double-tap zoom, fullscreen control activation, and router navigation
7. `refactor(tier1)`: decompose Tier 1 monoliths across `app.js`, MCP server, continuous reader, and routes
8. `fix(tagger)`: add manual search feedback, non-Gemini staged synthesis, Gemini toggle enforcement, and scrubber guard
9. `feat!(library)`: persist device library blobs with live sync UI, rank search results, and isolate SW shell cache

---

## 🧪 Verification & Test Results
- **Node / Jest Test Suite**: `157 passed, 157 total` (`1,262 passed, 0 failed`).
- **Python MCP Test Suite (`mcp/tests`)**: `39 passed, 39 total` (`60` registered MCP tools verified).
- **Guided View Engine (`gve-now`)**: `42 passed, 42 total` (`406 passed, 0 failed`, live health check `ok: true`).
- **Production Asset Compilation**: Tailwind CSS (`npm run build:css`) and Vite client bundle (`npm run build`) compiled cleanly and deployed to `comics-now.service`.
