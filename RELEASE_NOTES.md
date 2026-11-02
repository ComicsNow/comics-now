# Comics Now! v2.6.0 Release Notes

Welcome to **Comics Now! v2.6.0** — a milestone release delivering major viewer ergonomics enhancements, precision interactive zoom refinements, parallelized tagging engine optimizations, cloud GPU inference resilience, and a modernized modular architecture.

---

## 🌟 Highlights

### 1. Interactive Tap-to-Zoom & Viewer Ergonomics
* **Overlay Click-to-Close Dismissal**: Clicking anywhere directly on the active zoom overlay (`#bubble-magnifier-overlay` or inner image) immediately dismisses the magnification view without inadvertently firing background click points or advancing pages.
* **Western Speech Bubble Safety Margins**: Added a proactive +4% horizontal and +3% vertical safety margin outward to Western speech bubble bounding boxes, ensuring italicized text, punctuation quotes, and edge letters are never clipped when magnified.
* **Manga Panel Zoom Tap Prioritization**: Eliminated expanded bubble hit padding (`hitPad = 0`) specifically in Manga Panel Zoom mode, allowing readers to freely tap artwork to trigger panel zoom without dialogue bubbles intercepting the click.
* **Streamlined Toolbar Controls**: Replaced continuous automated guided view toggles with responsive, on-demand interactive tap-to-zoom controls tailored separately for Western and Manga reading styles.

### 2. Guided View GPU Inference Pipeline Resilience
* **Fault-Tolerant Image & Archive Processing**: Enhanced the cloud inference runner with automatic support for truncated images via Pillow reader, corrupted archive CRC-32 header tolerance, and automatic worker cancel latch resets across batch executions to ensure smooth unattended batch runs.

### 3. Architecture Modernization & Modular Subsystems
* **Comprehensive Monolith Decomposition**:
  - **Core Database & Configuration**: Decomposed `server/db.js` into modular connection, schema migrations, user preferences, and access control submodules (`server/db/`). Decomposed `server/config.js` into environment parsing, filesystem paths, tagger configurations, and configuration store (`server/config/`).
  - **Server Lifecycle & Bootstrapping**: Modularized `server.js` into dedicated lifecycle coordination, API rate-limiting, and route bootstrapping submodules (`server/lifecycle.js`).
  - **Library Navigation & Smartlists**: Decomposed `public/js/library/smartlists.js` into predicates, publisher matching, offline downloaded sync, and dynamic counters (`public/js/library/smartlists/`). Modularized `public/js/library/smart-filters.js` into buttons, predicate evaluation, and views (`public/js/library/filters/`). Modularized `public/js/library/device-library.js` into storage and UI submodules (`public/js/library/device/`).
  - **Scanner & Organization**: Decomposed `server/services/library-scan.js` into recursive directory crawler, scan lock coordinator, orphaned asset cleanup, and background scheduler. Decomposed `server/services/organization.js` into matching patterns and file relocation submodules.
  - **Guided View Admin & Service Engine**: Decomposed frontend `public/js/guided-reader.js` into live logs streaming, Modal cloud configuration, status polling, and tab event binding (`public/js/guided-admin/`). Modularized backend `server/services/guided-reader.js` into state tracking, settings management, processor coordination, queue management, and background worker execution (`server/services/guided/`).
  - **Admin Management Routes**: Decomposed `server/routes/admin/library-mgmt.js` into scan metadata, comic move operations, and tree log streaming (`server/routes/admin/library/`). Decomposed `server/routes/admin/comictagger.js` into settings persistence, execution spawning, and SSE log streaming (`server/routes/admin/comictagger/`).
  - **Offline Status & Sync**: Decomposed `public/js/offline/status.js` into progress synchronization and IndexedDB cache reconciliation (`public/js/offline/status/`).
  - **Metadata & Tagger Sources**: Modularized Gemini metadata and tagger services into prompt builders, normalizers, evaluators, and resolvers. Decomposed ComicVine source client (`comicvine.py`) into API client and parser submodules. Modularized Reading Curator MCP server into matching and database engines.
* **Centralized Reactive Store**:
  - Implemented a unified reactive store (`public/js/store.js`) with an event bus, state hydration, audit trails, and explicit action dispatchers for viewer, navigation, and filter states.
  - Eliminated global state mutations on `window`, routing state changes through explicit store actions.
* **Safe DOM Construction & HTML Sanitization**:
  - Deployed a declarative tagged template engine and HTML entity sanitization (`public/js/templates.js`).
  - Migrated settings, modals, viewer overlays, cards, and offline sync queues to safe element creation and `clearElement()`.
* **Top-Level Module Imports**:
  - Hoisted module dependencies across backend routes into deterministic top-level file headers.
* **Clean Bundling & Canonical Namespace**:
  - Consolidated frontend modules cleanly under the unified `window.ComicsNow` namespace.

### 4. Automated Tagger Performance & Concurrency
* **Parallel Source Lookups**: Implemented concurrent queries across ComicVine, Bedetheque, AniList, MangaUpdates, and GCD with deterministic index collation and tiered candidate limits, speeding up multi-source comic matching.

---

## 📦 Changelog

### Features
- `feat(store)`: implement reactive store core, audit trail, event bus, and persistent state hydration
- `feat(store)`: implement viewer, navigation, and filter state actions
- `feat(ui)`: implement declarative tagged template engine and safe DOM construction utilities

### Performance
- `perf(tagger)`: parallelize source queries with deterministic index collation and tiered candidate limits

### Bug Fixes
- `fix(viewer)`: dismiss zoom overlay on click instead of triggering hidden background points
- `fix(viewer)`: add 4% horizontal and 3% vertical safety margin to Western speech bubble zoom
- `fix(viewer)`: use exact hit bounds for bubbles in manga-panel-zoom to prioritize panel taps
- `fix(modal)`: allow loading truncated images in Pillow reader
- `fix(modal)`: bypass strict CRC assert on archives with corrupted entry headers
- `fix(guided)`: clear cancelCurrent and isCancelled state latch across worker runs
- `fix(scan)`: handle Dirent objects properly in directory crawler and load status submodules in reading list tests

### Refactoring & Code Health
- `refactor(smartlists)`: decompose public library smartlists into predicates, publisher-match, downloaded, and counters submodules
- `refactor(guided)`: decompose public guided-reader into logs, modal, status, and events submodules
- `refactor(config)`: decompose server config into env, paths, tagger-config, and store submodules
- `refactor(offline)`: decompose offline status into progress-sync and db-sync submodules
- `refactor(db)`: decompose server database into connection, schema, preferences, and access submodules
- `refactor(admin)`: decompose comictagger routes into settings, execution, and stream submodules
- `refactor(admin)`: decompose library-mgmt routes into scan-meta, move, and tree-logs submodules
- `refactor(guided)`: decompose guided-reader service into state, settings, processor, queue, and worker submodules
- `refactor(library)`: decompose smart-filters into buttons, predicate, and views submodules
- `refactor(library)`: decompose device-library into storage and ui submodules
- `refactor(gemini)`: decompose gemini-tagger into evaluator and resolver submodules
- `refactor(events)`: extract settings and tagger tab event listeners into tabs submodule
- `refactor(tagger)`: decompose comicvine source into parser and query client
- `refactor(server)`: decompose main server script into lifecycle, rate-limits, and api bootstrap submodules
- `refactor(scan)`: decompose library scan service into crawler, lock, cleanup, and scheduler submodules
- `refactor(library)`: decompose series card renderer into banner and card builder submodules
- `refactor(library)`: decompose library status engine into calculator and dom-sync submodules
- `refactor(server)`: decompose gemini-metadata service into modular prompt and normalizer
- `refactor(library)`: modularize library.js into navigation, smart-scope, and search-controls submodules
- `refactor(server)`: modularize organization.js into patterns and relocator submodules
- `refactor(settings)`: modularize settings.js into libraries and form-sync submodules
- `refactor(mcp)`: modularize reading_curator.py into matcher and db submodules
- `refactor(library)`: modularize render/comics.js into card-builder submodule
- `refactor(viewer)`: modularize viewer-server.js into preloader and navigation submodules
- `refactor(server)`: modularize server/routes/user/library.js into catalog and folders submodules
- `refactor(backend)`: modularize tagger/app.py monolith into focused blueprints and submodules
- `refactor(tagger)`: modularize comictagger.js monolith into focused submodules
- `refactor(viewer)`: modularize fullscreen.js monolith into focused submodules
- `refactor(library)`: modularize monolithic render.js into focused submodules
- `refactor(frontend)`: eliminate defensive load-order polyfills and consolidate namespaces
- `refactor(ui)`: eliminate direct innerHTML assignments across settings, modals, viewer, and offline queue
- `refactor(ui)`: migrate core library card components to declarative tagged templates
- `refactor(ui)`: systematically migrate container clears to clearElement
- `refactor(server)`: decouple circular dependencies and hoist core requirements to file headers

### Documentation
- `docs`: clarify removal of automated guided view buttons in favor of interactive tap-to-zoom

---

## 🧪 Verification & Test Results
- **Full Test Suite Coverage**: 100% test pass rate across all Jest unit/integration suites, Python tagger test suites, and MCP curator test suites.
- **Production Asset Compilation**: Tailwind CSS and Vite production client bundles compiled cleanly.
