# Comics Now! v2.4.1 Release Notes

Welcome to **Comics Now! v2.4.1** — a targeted patch release that refines comic card subtitle presentation in the frontend UI while preserving automated metadata tagging rules.

---

## 🌟 Highlights

### 1. Volume and Part Subtitle Presentation
* **Removed Redundant Title Suppression on UI**: Removed `isTitleRedundantWithSeries` from frontend card rendering logic (`public/js/globals.js`). Titles representing volumes, parts, or books (e.g. `Vol 1`, `Vol 2`, `Part 1`, `Book 1`) are now clearly displayed on Line 2 (the subtitle) of comic cards rather than being suppressed.
* **Preserved Automated Tagging Integrity**: Automated metadata tagging and database deduplication rules remain intact, ensuring scrapers still normalize metadata cleanly.

---

## 📦 Changelog

### Bug Fixes
- `fix(ui)`: display volume, book, and part titles on Line 2 (subtitle) of comic cards
- `fix(ui)`: remove frontend `isTitleRedundantWithSeries` helper that suppressed volume titles

### Testing & Verification
- `test(ui)`: add unit tests in `tests/comicCardTitleSubtitleRule.test.js` validating display of `Vol 1`, `Vol 2`, and `Part 1` subtitles

---

## 🧪 Verification & Test Results
- **Node.js / Jest**: **124 of 124 test suites passed** (1,007 of 1,007 tests passed).
- **Python / Pytest**: **150 of 150 tests passed**.
- **Data Safety**: 100% compliant with Comics Now Rules 1 & 2. Zero deletions or modifications to user reading progress, reading lists, or comic files.
