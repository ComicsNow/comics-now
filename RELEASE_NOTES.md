# Comics Now! v2.5.0 Release Notes

Welcome to **Comics Now! v2.5.0** — a feature release introducing precision interactive zoom, dual Manga/Western speech bubble prioritization, and enhanced guided view panel detection.

---

## 🌟 Highlights

### 1. Interactive Tap-to-Zoom & Precision Bubble Detection
* **Dual Zoom Modes for Manga**: Added a dedicated Bubble Zoom button alongside the adaptive Panel Zoom button. Tapping directly on dialogue bubbles prioritizes magnifying the speech bubble for effortless reading, with graceful fallback to panel zoom when tapping outside bubbles.
* **Hit-Detection Tolerance**: Implemented adaptive geometric hit tolerance around speech bubbles (`findBubbleAtPoint` in `geometry.js`) to ensure accurate bubble selection on touchscreens and high-DPI displays.
* **Streamlined Viewer Controls**: Replaced continuous automated guided view toggles with responsive, on-demand interactive tap-to-zoom controls in the reader toolbar.

### 2. Guided View & Panel Detection Enhancements
* **Modal GPU Pipeline Refinement**: Enhanced `modal_app.py` with gutter caption tolerance (80px), text ink tightening, and recursive gutter splitting for superior panel segmentation without clipping dialogue or captions.
* **Lightweight Local ONNX Detection**: Restored the optimized 9.8MB ONNX manga model and streamlined CPU panel detector (`panel-detector.js`, `overlay.js`) for fast local sidecar processing.

---

## 📦 Changelog

### Features
- `feat(guided)`: refine interactive zoom modes, expand bubble tap area, and streamline local panel detector

---

## 🧪 Verification & Test Results
- **Node.js / Jest**: **125 of 125 test suites passed** (1,019 of 1,019 tests passed).
- **Data Safety**: 100% compliant with Comics Now Rules 1 & 2. Zero deletions or modifications to user reading progress, reading lists, or comic files.
