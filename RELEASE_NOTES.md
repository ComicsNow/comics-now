# Comics Now! v2.1.0 Release Notes

Welcome to **Comics Now! v2.1.0** — a major feature and performance release introducing **Web URL Metadata Tagging with Gemini AI**, **High-Throughput SQLite Performance Tuning**, **Multi-Source Metadata Synthesis**, **Streamlined Card Typography**, and **Continuous Reader Stabilization**.

---

##  Highlights

### 1. Web URL Metadata Tagging & Comics MCP
* **Tag from Any URL**: Seamlessly tag comic issues by passing web links (comic solicitations, fandom wikis, publisher previews, or review pages).
* **Gemini AI Synthesis**: Automatically parses and structures web content into standardized ComicInfo metadata, matching series, issue numbers, creators, and synopsis.
* **Live Daily Quota Tracking**: Web URL requests count toward the daily Gemini AI quota, displayed in real-time in **Settings $\rightarrow$ Tag Comics Now! $\rightarrow$ Gemini AI**.
* **New Comics MCP Tools**:
  - `tag_comic_from_url(comic_id, url, storage)`: One-step comic tagging from any web link.
  - `extract_metadata_from_url(url, filename)`: Web URL metadata extraction dry-run.

### 2. SQLite Performance Optimization & Storage Compaction
* **Zero-Scan Indexing**: Added 4 non-destructive covering and composite indexes:
  - `idx_reading_list_items_list_sort`: Eliminates temporary B-Tree sorts for reading lists and DAG rendering.
  - `idx_reading_lists_user_sort`: Eliminates full table scans on reading list views.
  - `idx_comics_publisher_series`: Answers library grouping directly from a covering index.
  - `idx_user_comic_status_comic`: Replaces full table scans with instant indexed searches on comic progress.
* **Memory & I/O Pragmas**:
  - `mmap_size = 256MB`: Enables zero-copy kernel memory mapping for instant page reads.
  - `temp_store = MEMORY`: Keeps all temporary sorting and grouping structures in RAM.
  - `cache_size = 64MB`: Caches the entire working dataset in memory.
* **Instant Server Startup**: Guarded historical migration loops with completion flags in `settings` to prevent CPU churn and table scanning on server reboots.
* **High Storage Compaction Potential**: Reclaims fragmented and unallocated database space accumulated during intensive library scans and metadata writes, with potential database storage savings of up to 50%+ while strictly preserving all user lists and reading progress.

### 3. Streamlined Comic Card & Viewer Typography
* **Strict 2-Line Hierarchy**:
  - **Line 1**: Series name and issue number (e.g. `Action Comics #1050`).
  - **Line 2**: Distinct story title (e.g. `Kal-El Returns`), only when available.
* **Filename Subtitle Removal**: Completely eliminated raw filenames leaking as secondary labels below comic titles.
* **Clean Fallbacks**: Untagged comics gracefully fall back to clean, sanitized names on Line 1 with empty Line 2.
* **DC All In Styling**: High-contrast Anton display typography and electric blue focus/selection halos.

### 4. Multi-Source Metadata Synthesis & Staging Modal
* **Tri-Source Synthesis**: Combines ComicVine, Grand Comics Database (GCD), and Gemini AI with confidence weighting.
* **Manual Inspection UI**: Review and selectively stage synthesized metadata before saving to archive or sidecar storage.

### 5. Reader Mode Stabilization
* **Continuous Scroll Polish**: Stabilized scroll anchoring and gesture handling in continuous reading mode.
* **Kindle & E-Ink Profiles**: High-contrast rendering and dedicated touch navigation for e-ink devices.

---

## 📦 Changelog

### Features
- `feat(tagger)`: add Web URL metadata tagging with Gemini synthesis, quota tracking, and MCP tools (`c7c45a9`)
- `feat(metadata)`: add Gemini multi-source synthesis and manual staging UI (`ea419b5`)
- `feat(reader)`: continuous reading mode stabilization, clean display titles, and e-ink/kindle support (`f263c25`)
- `feat(ui)`: comic typography, card selection states, and toolbar alignment (`a864f6d`)
- `feat(ui)`: enforce series on line 1 and story title on line 2, removing filename subtitle (`2b9f2f3`)

### Performance & Database
- `perf(db)`: optimize SQLite indexes, memory pragmas, and startup migration guards (`ec93e31`)

### Maintenance & Dependencies
- `chore(deps-dev)`: bump vite from 8.3.0 to 8.3.3 (`d1b0bd9`)

---

## 🧪 Verification & Compatibility
- **Jest Test Suite**: 96 / 96 test suites passed (686 / 686 tests).
- **Python / Pytest**: 37 / 37 tests passed.
- **Data Safety**: 100% backward compatible. Zero resets or modifications to user reading progress, reading lists, or comic files.
- **Greenfield Ready**: New Docker and npm installations automatically initialize with optimized indexes, seeds, and memory pragmas out of the box.

---

## 🚀 Deployment & Distribution
Pushed release tags automatically build and publish:
* **Docker Hub**: `docker pull comicsnowdev/comics-now:2.1.0`
* **GitHub Container Registry (GHCR)**: `docker pull ghcr.io/comicsnow/comics-now:2.1.0`
* **npm Registry**: `npx comics-now@2.1.0`
