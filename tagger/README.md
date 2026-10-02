# Tag Comics Now! (Comics Now Tagger)

An automated, multi-source comic metadata tagger and `ComicInfo.xml` engine built for digital comic libraries (`.cbz`, `.cbr`). 

Tag Comics Now operates both as an independent web application/REST microservice and as the dedicated tagging engine embedded within [Comics Now](file:///opt/comics-now).

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture & Directory Layout](#architecture--directory-layout)
- [Supported Metadata Sources](#supported-metadata-sources)
- [Metadata Normalization & Synthesis](#metadata-normalization--synthesis)
- [ComicInfo.xml Storage Modes](#comicinfoxml-storage-modes)
- [Configuration](#configuration)
- [REST API Reference](#rest-api-reference)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running Standalone](#running-standalone)
  - [Running Inside Comics Now](#running-inside-comics-now)
- [Testing](#testing)

---

## Overview

Digital comic archives often contain inconsistent, missing, or inaccurate metadata. Tag Comics Now queries multiple comic and bookstore databases simultaneously, normalizes disparate naming conventions into standard publisher and creator taxonomies, validates cover art using perceptual hashing, and writes clean `ComicInfo.xml` metadata either directly into `.cbz` files or alongside archives as external sidecar files.

---

## Key Features

- **10 Metadata Providers**: Aggregates metadata across comic book catalogs, general book databases, and specialty comic retailers.
- **Sequential Multi-Source Synthesis**: Queries enabled sources in sequence, scoring candidates against filename and cover cues, and synthesizing missing fields (e.g. filling in colorists or publication dates from secondary sources).
- **Perceptual Cover Matching**: Extracts front covers from CBZ archives on the fly and computes image hashes (`dhash`, `phash`, `ahash`) via Pillow & ImageHash to verify cover artwork matches candidates.
- **Strict Role Disambiguation**: Differentiates writers, pencillers, inkers, colorists, letterers, cover artists, and editors, stripping scraper noise and marketing boilerplate from descriptions.
- **Redundant Title & Edition Cleanup**: Eliminates redundant format tags (`(TPB)`, `[HC]`, `(Digital)`) and prevents duplicate titles when issue titles match the series name.
- **Collected Edition & Volume Support**: Accurately maps volume numbers to `<Volume>` and `<Number>` for graphic novels, collected editions (e.g. Epic Collections), and trade paperbacks.
- **Fast CBZ Stream Writing**: Injects updated `ComicInfo.xml` into CBZ archives using direct byte stream copying to avoid decompressing and recompressing entire gigabyte-sized archives.
- **Sidecar Mode**: Optionally saves `.ComicInfo.xml` files adjacent to archives, leaving the original media untouched (ideal for read-only mounts or CBR files).
- **Idempotent Scanning & Tracking**: Uses an SQLite database (`enhanced_tracking.db`) to record file modification timestamps (`mtime`) and sources, skipping already-processed archives on subsequent runs.
- **Server-Sent Events (SSE) Streaming**: Delivers real-time, step-by-step progress events over HTTP (`/api/tag-file-stream`).
- **Scheduled Automation**: Built-in background scheduler for automated periodic library scans.

---

## Architecture & Directory Layout

```
tagger/
├── app.py                      # Flask microservice & web routing entry point
├── requirements.txt            # Python dependencies
├── scheduler_config.json       # Scheduler, source keys, & field selection config
├── enhanced_tracking.db        # SQLite tracking DB for file modification timestamps
├── scan_logs/                  # Historical JSON scan execution logs
├── templates/
│   └── index.html              # Standalone web UI interface
├── static/                     # Web UI static assets (CSS, JS)
├── tagger_app/
│   ├── config.py               # Runtime configuration loader
│   ├── core/
│   │   ├── cache.py            # Disk and memory caching
│   │   ├── comicinfo.py        # ComicInfo.xml reader, generator, and CBZ/sidecar writer
│   │   ├── covers.py           # Archive cover extraction and perceptual hashing
│   │   ├── limiter.py          # Per-domain rate defense and request throttler
│   │   ├── metadata.py         # Taxonomic normalization, role disambiguation, and scoring
│   │   └── query.py            # Filename normalization and query parsing
│   ├── persistence/
│   │   ├── scan_logs.py        # Scan log record storage and JSON serialization
│   │   └── tracking_db.py      # SQLite helper for tracked/enhanced comics
│   ├── scheduler/
│   │   └── state.py            # Background scheduler state management
│   └── sources/
│       ├── registry.py         # Provider registration and lifecycle manager
│       ├── amazon.py           # Amazon Books scraper
│       ├── blackwells.py       # Blackwell's UK bookstore scraper
│       ├── comicvine.py        # Comic Vine API provider
│       ├── forbiddenplanet.py  # Forbidden Planet scraper
│       ├── gcd.py              # Grand Comics Database (GCD) scraper
│       ├── goodreads.py        # Goodreads scraper
│       ├── googlebooks.py      # Google Books API provider
│       ├── lcg.py              # League of Comic Geeks scraper
│       ├── metron.py           # Metron API provider (via mokkari)
│       └── waterstones.py      # Waterstones UK bookstore scraper
└── tests/                      # Pytest test suite (130+ unit & integration tests)
```

---

## Supported Metadata Sources

| Source | Provider Key | Type | Authentication |
|---|---|---|---|
| **Comic Vine** | `src-comicvine` | REST API | Optional API Key |
| **Metron** | `src-metron` | REST API | Optional Username & Password |
| **Google Books** | `src-googlebooks` | REST API | Optional API Key |
| **Grand Comics Database (GCD)** | `src-gcd` | Web Scraper | None |
| **League of Comic Geeks** | `src-lcg` | Web Scraper | None |
| **Goodreads** | `src-goodreads` | Web Scraper | None |
| **Blackwell's** | `src-blackwells` | Web Scraper | None |
| **Waterstones** | `src-waterstones` | Web Scraper | None |
| **Amazon** | `src-amazon` | Web Scraper | None |
| **Forbidden Planet** | `src-forbiddenplanet` | Web Scraper | None |

---

## Metadata Normalization & Synthesis

The engine applies rigorous filtering to guarantee clean, standard metadata:

1. **Publisher Codex**: Normalizes publisher aliases (e.g. `Marvel Comics`, `Marvel Worldwide`, `Marvel UK` &rarr; `Marvel`; `DC Universe`, `Vertigo`, `DC Black Label` &rarr; `DC Comics`) and grounds against the user's existing library codex.
2. **Redundant Title Pruning**: If the scraped `Title` matches the `Series` name (even with `#1`, `Vol. 1`, or edition tags), the `Title` is left blank to prevent duplicate UI headers in comic readers.
3. **Creator Roles**: Segregates raw contributor names into distinct `Writer`, `Penciller`, `Inker`, `Colorist`, `Letterer`, `CoverArtist`, and `Editor` fields. Strips corporate entities, solicit marketing lines ("From the creators of..."), and generic labels ("Various").
4. **Volume & Issue Harmonization**: If a book is identified as a volume (e.g. `Volume 26` of an Epic Collection or TPB) without an explicit issue number, the volume number automatically populates both `<Volume>` and `<Number>` so reader applications index and sequence it properly.

---

## ComicInfo.xml Storage Modes

Configurable via `metadata_storage` in configuration:

- **`archive`** (Default for CBZ):
  Updates `ComicInfo.xml` directly at the root of the `.cbz` archive. The writer parses the ZIP central directory, replaces or inserts the XML block, and preserves original image offsets without re-encoding image streams.
- **`sidecar`** (Required for CBR or read-only storage):
  Writes an external XML file with the naming format `<comic-filename>.ComicInfo.xml` in the same directory as the comic file, leaving the archive binary unmodified.

---

## Configuration

Configuration is managed via `scheduler_config.json` (or environment overrides):

```json
{
  "config": {
    "default_directory": "/path/to/comics",
    "interval_value": 1,
    "interval_unit": "day",
    "enabled": false,
    "comicvine_api_key": "",
    "google_books_api_key": "",
    "metron_user": "",
    "metron_pass": "",
    "confidence_threshold": 0.9,
    "lower_threshold": 0.8,
    "upper_threshold": 0.9,
    "batch_concurrency": 4,
    "metadata_storage": "sidecar",
    "selected_fields": [
      "Writer",
      "Penciller",
      "Inker",
      "Colorist",
      "Letterer",
      "CoverArtist",
      "Editor",
      "Genre",
      "PageCount",
      "Characters",
      "Teams",
      "Locations"
    ],
    "enabled_sources": [
      "src-comicvine",
      "src-metron",
      "src-gcd",
      "src-lcg",
      "src-goodreads",
      "src-blackwells",
      "src-waterstones",
      "src-googlebooks",
      "src-amazon",
      "src-forbiddenplanet"
    ],
    "force_reprocess": false,
    "legacy_xml_fallback": true
  }
}
```

### Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `APP_HOST` | `127.0.0.1` | Bind address for Flask server |
| `PORT` | `5000` | Port for Flask server |
| `FLASK_DEBUG` | `0` | Debug mode toggle |
| `DATA_DIR` | `tagger/` | Root storage for database and logs |
| `TRACKING_DB_PATH` | `<DATA_DIR>/enhanced_tracking.db` | Path to tracking SQLite database |
| `SCAN_LOGS_DIR` | `<DATA_DIR>/scan_logs` | Directory for JSON scan logs |
| `SCHEDULER_CONFIG_PATH` | `<DATA_DIR>/scheduler_config.json` | Path to scheduler configuration file |

---

## REST API Reference

### Health & Status
- **`GET /api/health`**: Returns engine status and version.

### Tagging & Scanning
- **`POST /api/tag-file`**: Evaluates a single file and returns metadata candidates.
- **`POST /api/tag-file-stream`**: Evaluates a file and streams live Server-Sent Events (`data: { type: "progress"|"result"|"error" }`) showing per-source candidate lookups.
- **`POST /api/apply-tag`**: Applies selected metadata to a comic file (`archive` or `sidecar`).
- **`POST /api/search`**: Executes a manual query across all or selected sources (`all`, `comicvine`, `googlebooks`, `forbiddenplanet`, etc.).

### Scheduler & Execution
- **`GET /scheduler-info`**: Retrieves current scheduler status, next scheduled run, and history.
- **`POST /scheduler-update`**: Updates scheduler timing, source selections, and threshold settings.
- **`POST /scheduler-trigger`**: Manually triggers an immediate background library scan.

### Logs & History
- **`GET /api/logs`**: Lists all recorded scan logs.
- **`GET /api/logs/<log_id>`**: Retrieves detailed JSON results for a specific scan run.
- **`DELETE /api/logs/<log_id>`**: Deletes a scan log.
- **`POST /api/enhanced-comics/clear`**: Clears the enhancement tracking database to force re-processing.

---

## Getting Started

### Prerequisites

- Python 3.10+
- `libarchive` / `zip` (for archive operations)

### Installation

1. Create and activate a Python virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Running Standalone

Launch the tagger microservice:
```bash
python3 app.py
```
Open [http://localhost:5000](http://localhost:5000) in your web browser to access the standalone tagger dashboard.

### Running Inside Comics Now

When used as part of Comics Now:
- The Node.js server automatically manages and spawns `app.py` via `server/services/tagger-process.js`.
- All tagger requests from Comics Now UI routes (`/comics-sutherlandgrove/api/comictagger/*`) proxy directly to the internal Python daemon on port 5000.
- When Comics Now is managed via systemd (`comics-now.service`), restarting the main service automatically handles the tagger worker process.

---

## Testing

The tagger includes a comprehensive pytest test suite validating all sources, normalization rules, and web endpoints:

```bash
pytest tests/
```

Run specific source tests:
```bash
pytest tests/test_forbiddenplanet.py
pytest tests/test_comicvine_volumes.py
pytest tests/test_field_by_field_merge.py
```
