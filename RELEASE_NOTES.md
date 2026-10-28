# Comics Now! v2.4.0 Release Notes

Welcome to **Comics Now! v2.4.0** — a feature, metadata resilience, and scraper performance release introducing **Manual Comic Title Preservation**, **Expanded 10–20 Result Metadata Limits**, **urllib3 v2 Scraper Compatibility**, and **Pure NumPy pHash Resilience**.

---

## 🌟 Highlights

### 1. Manual Metadata Title Preservation
* **Non-Destructive Manual Editing**: Manual edits to a comic's metadata (via the metadata form, library management API, or MCP tools) now strictly preserve whatever title is entered (including standalone volume labels like `vol 1`, `Issue 1`, or `#1`).
* **Intelligent Scraper Deduplication**: Web scrapers (ComicVine, GCD) continue to strip redundant title strings when story titles are absent, while manual human edits explicitly retain the entered title via the new `preserveTitle: true` pipeline option across `renderMetadataDisplay()`, `saveMetadataToComic()`, and `buildComicInfoXml()`.

### 2. Expanded Search Result Limits (10–20 Results)
* **Comprehensive Metadata Search**: Increased result limits across all external metadata providers:
  - **GCD (Grand Comics Database)**: Up to **20 issues** across active series (iterates past single-issue one-shots to capture active series).
  - **ComicVine**: Up to **20 results** across issues and volumes.
  - **League of Comic Geeks (LCG)**: Up to **20 results**.
  - **Google Books**: Up to **20 results** via Google Books API.
  - **Metron Cloud**: Up to **20 results**.
  - **Web Book Scrapers** (*Amazon, Blackwell's, Waterstones, Forbidden Planet, Goodreads*): Up to **10 results** per provider.

### 3. Scraper Resilience & Dependency Compatibility
* **urllib3 v2 `appengine` Compatibility Shim**: Added compatibility shims across tagger startup to prevent `requests_toolbelt` import crashes when running under modern `urllib3 >= 2.0`, restoring search connectivity for LCG, Amazon, Blackwell's, Waterstones, Goodreads, and Forbidden Planet.
* **Pure NumPy 2D DCT pHash Fallback**: Added a self-contained NumPy-based 2D Discrete Cosine Transform fallback in cover perceptual hashing (`_compute_phash`), preventing binary C-extension version skew crashes between system SciPy and modern NumPy.

---

## 📦 Changelog

### Features & Enhancements
- `feat(metadata)`: preserve user-entered comic titles on manual edit and sidecar save (`preserveTitle: true`)
- `feat(tagger)`: increase metadata search results to 10–20 across GCD, ComicVine, LCG, Metron, Google Books, and book scrapers
- `feat(tagger)`: iterate GCD series to return up to 20 valid active issues

### Bug Fixes & Reliability
- `fix(tagger)`: add urllib3 v2 backward-compatibility shim for `requests_toolbelt` / `cloudscraper`
- `fix(covers)`: implement pure NumPy 2D DCT fallback in cover perceptual hashing to eliminate binary SciPy incompatibility
- `fix(metadata)`: remove duplicate lowercase metadata keys (`title`, `issue_title`) on manual form submission

### Testing & Validation
- `test(metadata)`: add integration and unit tests for title preservation on manual saves and standalone volume strings (e.g. `Animal` with `vol 1`)
- `test(covers)`: verify pHash cover matching resilience across identical, resized, and dissimilar covers

---

## 🧪 Verification & Test Results
- **Node.js / Jest**: **124 of 124 test suites passed** (1,006 of 1,006 tests passed).
- **Python / Pytest**: **150 of 150 tests passed**.
- **Data Safety**: 100% compliant with Comics Now Rules 1 & 2. Zero deletions or modifications to user reading progress, reading lists, or comic database records.

---

## 🚀 Deployment & Distribution
Pushed release tags automatically build and publish:
* **Docker Hub**: `docker pull comicsnowdev/comics-now:2.4.0`
* **GitHub Container Registry (GHCR)**: `docker pull ghcr.io/comicsnow/comics-now:2.4.0`
* **npm Registry**: `npx comics-now@2.4.0`
