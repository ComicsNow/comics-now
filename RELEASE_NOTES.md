# Comics Now! v5.1.1 Release Notes

**Comics Now! v5.1.1** is a critical security and stability patch delivering hardened SVG logo sanitization with sandbox isolation, atomic publisher logo updates, reading list MCP non-destructive defaults, UI card control button preservation, and complete CI test suite parity.

---

## 🐛 Bug Fixes & Security Hardening

* **Security & SVG Static Serving**:
  * Hardened the SVG logo sanitizer with recursive tag stripping, banning SMIL animations (`<animate>`, `<set>`), and stripping control characters in URL schemes.
  * Added `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'` and `X-Content-Type-Options: nosniff` headers to the static `/logos` endpoint.

* **Publisher Logos & UI Card Preservation**:
  * Fixed atomic file replacement in publisher logo uploads: new artwork is validated and staged in temporary files before previous logos are unlinked.
  * Emitted logo events now respect subpath base URLs and include timestamp cache-busting query strings.
  * Isolated publisher card logos inside dedicated containers, preventing live update events from removing reading progress banners or action buttons.
  * Resolved event listener leaks and duplicate keydown bindings in the logo zoom lightbox modal.

* **Reading List MCP Safety**:
  * Set default parameters on `sync_reading_lists_to_all_users` to non-destructive (`overwrite: false, prune: false`), safeguarding custom lists against unintended pruning.

* **Safe DOM Construction & Architecture Ratchet**:
  * Enforced safe text node construction in settings naming rules and sync modals.
  * Hoisted dynamic runtime imports in log retention services and expanded architectural ratchet test coverage across background scripts and plugins.
  * Corrected template interpolation handling in the Tailwind class inventory test suite.
