# Comics Now! v5.1.0 Release Notes

**Comics Now! v5.1.0** introduces a centralized Publisher Logos Manager with staged non-destructive editing and ComicVine integration, automatic orphaned `ComicInfo.xml` sidecar cleanup with the Companion Guard, complete companion metadata sync parity to PDF and EPUB formats, and resilient thumbnail generation for vintage scanned archives.

---

## 🚀 Features & Enhancements in v5.1.0

* **Centralized Publisher Logos Manager & ComicVine Logo Integration**:
  * **Dedicated Admin Management Interface**: Added a dedicated **Publisher Logos** tab under Settings (and a right-click / long-press **Change Publisher Logo** context menu shortcut on library publisher cards) to discover, inspect, and manage logos across all library publishers.
  * **Staged Non-Destructive Workflow**: Logo modifications (Upload, ComicVine Fetch, Delete) are staged in memory with visual status badges (`● Pending Save`, `● Pending Delete`) and a sticky floating action bar (`Save Changes`, `Discard All`). Logo changes are never written to disk until the administrator explicitly clicks **Save Changes**.
  * **Smart Filtering & Real-Time Search**: Filter publisher cards by **All**, **With Logo**, or **Missing**, alongside real-time search filtering. Publishers with missing logos remain visible in the `Missing` view while staging changes until saved.
  * **ComicVine Logo Fetching & Magic Byte Sniffing**: Fetch high-resolution publisher artwork directly from ComicVine with live spinner feedback. Features automatic binary magic byte detection to handle mislabeled image formats (e.g. PNG files served with `.jpg` extensions), full GIF image support, and automated rejection of ComicVine's blank placeholder files.
  * **Contrast-Aware Display & Zoom Modal**: Borderless card containers dynamically adapt their background (light vs. dark) based on luminance and alpha channel analysis of transparent logos. Clicking any logo opens an interactive high-resolution Zoom Lightbox displaying format and pixel dimensions.
* **Orphaned `ComicInfo.xml` Sidecar Cleanup & The Companion Guard**:
  * Library scan cleanup now automatically removes orphaned `.ComicInfo.xml` sidecar files from disk when a comic archive no longer exists.
  * **Storage Reachability Guard**: Missing file cleanup is strictly aborted if top-level library roots or subfolders are unreachable or experience I/O errors (e.g. unmounted network storage).
  * **The Companion Guard**: Before deleting any `.ComicInfo.xml`, the scanner verifies whether any companion format (`.cbz`, `.cbr`, `.pdf`, `.epub`) sharing that stem still exists on disk. If any companion format remains, the sidecar is strictly preserved.
* **PDF & EPUB Companion Metadata Sync Parity**:
  * Converted CBZ comics with kept original PDF or EPUB files now mirror tagged metadata back to their original companion files, matching CBR behavior.
  * Automatically writes adjacent `.ComicInfo.xml` sidecars for non-ZIP formats (CBR, PDF, EPUB) rather than attempting ZIP repacking.
* **Resilient Thumbnail Generation for Vintage Scans**:
  * Enabled permissive image decoding (`failOn: 'none'`) in Sharp, allowing older scanned archives with non-standard EXIF markers or trailing pre-marker bytes to generate cover thumbnails cleanly without throwing fatal errors.
  * Added 0-byte cache eviction: if an interrupted or corrupted 0-byte thumbnail file is detected on disk, it is immediately unlinked and regenerated rather than cached.
  * Automatic thumbnail repair during library maintenance now detects and heals 0-byte thumbnail files in addition to missing records.
