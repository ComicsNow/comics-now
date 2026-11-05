# Comics Now! v3.2.0 Release Notes

Welcome to **Comics Now! v3.2.0** — a minor release introducing a configurable **Page Cache Limit** under **Settings → General**. Administrators can now cap the rendered-page cache directly in the web UI, see current usage at a glance, and apply changes immediately without restarting the server.

---

## 🌟 What's New in v3.2.0

### 1. Configurable Page Cache Limit (Default: 200 MB)
* **Settings → General → Page Cache Limit (MB)** (`#page-cache-max-input`):
  - Number input with a **50–10240 MB** range and a live usage summary (`#page-cache-usage`), for example: `Using 450 MB of 700 MB across 1,200 files`.
  - Persisted to both `config.json` and the SQLite `settings` table through `POST /api/v1/settings`.
* **Live changes — no restart required**:
  - The cache cap is read from the live configuration on every prune. Lowering the limit immediately evicts the oldest cached pages down to 85% of the new cap; raising it applies to subsequent pruning.
  - Prune requests are coalesced, so a limit change arriving during an in-flight prune triggers another pass with the new cap.
* **New product default: 200 MB**:
  - `DEFAULT_MAX_PAGE_CACHE_MB` and `DEFAULT_CONFIG.pageCacheMaxMb` are now `200`.
  - Installations that have not configured a value adopt the 200 MB default on their first boot after upgrading.
* **Statistics and validation**:
  - `GET /api/v1/settings` now returns `pageCacheMaxMb`, `pageCacheUsageBytes`, and `pageCacheFileCount`.
  - Cache measurements exclude in-flight `*.tmp.*` files (previously counted by the prune scan).
  - The limit is validated (integer, 50–10240 MB) before any other setting is written. Partial settings payloads leave it untouched.

### Upgrade note
If you rely on a cache larger than 200 MB, set `pageCacheMaxMb` in `config.json` (or in **Settings → General**) before upgrading. Existing caches above the new cap are trimmed to 85% of the cap the first time the server prunes, including at startup.

---

## 📦 v3.2.0 Changelog
1. `feat(settings)`: add configurable page cache limit with live pruning (`3205093`)

---

## 🧪 Verification & Test Results
- **Full Jest suite**: `159 suites passed, 1285 tests passed`.
- **Architecture ratchet**: all touched modules remain under the 380-line ceiling.
- **Production build**: Tailwind CSS and the Vite client bundle compiled successfully and deployed to `comics-now.service`.
- **Live no-restart verification**: changed the limit through `POST /api/v1/settings` and confirmed the service PID remained unchanged.

---

# Previous Release: Comics Now! v3.1.x

- Independent CBR and PDF source-file retention controls after `.cbz` conversion, defaulting to **Keep Originals**.
- See GitHub Releases for v3.1.0 and v3.1.1.
