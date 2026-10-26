## 2026-10-26 - Unawaited Config Promise Corrupts System Config
**Vulnerability:** Calling async `readConfig()` without `await` in `handlePostConfig` assigned a Promise object to `cfg`. Serializing a Promise with `JSON.stringify(cfg)` evaluates to `{}` (an empty object), wiping out `config.json` and destroying authentication settings (Cloudflare Zero Trust credentials) and system configurations.
**Learning:** In Node.js / Express routes, unawaited async utility calls that return Promises fail silently when passed to `JSON.stringify()`, resulting in data truncation/loss instead of a runtime type error.
**Prevention:** Always `await` async config reader methods, and ensure unit tests verify that writing settings preserves pre-existing file contents.
