# Comics Now! v5.1.3 Release Notes

**Comics Now! v5.1.3** fixes a Settings UI issue where pressing **Enter** while adding a library folder submitted the general settings form instead of saving the new library path.

---

## 🐛 Bug Fixes & Improvements

* **Settings — Library Folders**:
  * Fixed pressing **Enter** inside the new library folder input (`#new-library-path`) submitting the surrounding general settings form instead of triggering the **Add** action, ensuring new library paths persist to `config.json`.
  * Guarded library folder control initialization against duplicate event binding.
