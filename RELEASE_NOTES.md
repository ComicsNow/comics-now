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
* **Modular Subsystems**:
  - Modularized the Python backend tagger into focused Flask blueprints (`tagger_app/blueprints/`, `tagger_app/services/`).
  - Modularized frontend ComicTagger into dedicated submodules (`public/js/comictagger/`).
  - Modularized Fullscreen Reader into dedicated viewer submodules (`public/js/viewer/fullscreen/`).
  - Modularized Library Renderer into dedicated library submodules (`public/js/library/render/`).
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

### Refactoring & Code Health
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
- **Test Suites**: 100% test pass rate across all viewer, tagger, and guided view test suites.
- **Production Asset Compilation**: Tailwind CSS and Vite production bundles verified clean.
