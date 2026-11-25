# Comics Now! v5.1.2 Release Notes

**Comics Now! v5.1.2** resolves a critical container startup failure where native SQLite bindings were missing from the production Docker image.

---

## 🐛 Bug Fixes & Improvements

* **Docker & Native Module Compilation**:
  * Removed `--ignore-scripts` from `npm ci` in the multi-stage Docker build, enabling native addon lifecycle scripts to run properly during image compilation.
  * Restored prebuilt and source compilation of `better-sqlite3` native bindings (`better_sqlite3.node`) and `onnxruntime-node` binaries inside the container, resolving startup crashes on Node 22 (Issue #132).
