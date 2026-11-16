# Comics Now! v5.0.1 Release Notes

**Comics Now! v5.0.1** is a patch release fixing a settings persistence regression introduced in v5.0.0 where Auto-Conversion and EPUB original-retention settings reverted in the UI immediately after saving.

---

## 🐛 Bug Fixes in v5.0.1

* **Persist Auto-Conversion & EPUB Retention Settings (`server/bootstrap/api-router.js`)**:
  * Wired `getAutoConvertEnabled`, `setAutoConvertEnabled`, `getAutoConvertFormats`, `setAutoConvertFormats`, `getDeleteEpubAfterConversion`, and `setDeleteEpubAfterConversion` into `createConfiguredApiRouter()`.
  * Previously, saving settings via `POST /api/v1/settings` wrote those values to SQLite without updating the in-memory config accessors, causing the subsequent `GET /api/v1/settings` refresh to return `false` / `[]` and reset the UI controls.
* **Lockfile Sync**:
  * Synced `package-lock.json` with `pdfjs-dist` and `@napi-rs/canvas` dependencies so `npm ci` builds succeed in Docker and npm CI workflows.

---

## 🧪 Verification

* Added regression test `tests/apiRouterAutoConvert.test.js` verifying `POST /api/v1/settings` → `GET /api/v1/settings` round-trip persistence for `autoConvertEnabled`, `autoConvertFormats`, and `delete*AfterConversion`.
* Verified full Jest test suite (`223/223` suites, `1671` tests, `1` snapshot passing).
