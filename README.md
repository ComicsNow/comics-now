# Comics Now!

A modern, simple web app for managing and reading your digital comic book collection.

## Features

**Reading Experience**
- **Smart Guided View:** Advanced panel navigation using a smooth CSS magnifier overlay.
  - **Manga Logic:** A complete narrative flow that takes you through every speech bubble *and* the full panel (Right-to-Left).
  - **Western Logic:** Focuses purely on dialogue, zooming sequentially through speech bubbles for effortless reading (similar to Google Books).
- **Manual Zoom:** Double-click or double-tap anywhere on a page to instantly zoom into that specific area using the magnifier.
- **Specialized Reading Modes:**
  - **Bubble Zoom:** Automatically jumps through speech bubbles.
  - **Hot Zoom:** Interactive "point-and-click"—tap any bubble or panel to zoom.
  - **Continuous Mode:** Vertical scrolling for webtoons.
  - **Manga Mode:** Per-user Right-to-Left layout.
  - **Landscape & Full Image:** Optimized layouts for different screens.
- **Progress Tracking & Sync:** Saves and syncs reading progress across all devices.
- **End-of-Comic Navigation:** Prompts for the next issue or reading list item upon completion.

**Library & Organization**
- **Library Structures:** Organize your server-side comics in two distinct ways:
  - **Metadata Mode:** Groups by Publisher → Series → Issue using `ComicInfo.xml` metadata.
  - **Folder Mode:** Mirrors your physical folder structure directly, ignoring internal metadata.
- **Local Device Library:** Read comics stored directly on your phone or computer without uploading them to the server.
- **Reading Lists:** Create custom collections and drag-and-drop reading orders for events or crossovers.
- **Bulk Management:** Easily mark entire series or publishers as read/unread.

**Format & Metadata Support**
- **Supported Formats:** Read CBZ and CBR files seamlessly.
- **Auto-Conversion:** Automatically converts PDF and CBR files to the more efficient CBZ format during scanning.
- **Metadata Management:** Integrates with ComicTagger to fetch rich metadata and covers from ComicVine. Metadata is written directly into the comic files as `ComicInfo.xml`.

**Offline & Sync**
- **Offline Reading:** Download individual comics, series, or entire reading lists to read without internet.
- **Background Downloads:** A reliable download queue that continues working even if you close the app.

**Administration**
- **Access Control:** Multi-user support with detailed access controls.
- **Secure Login:** Optional integration with Cloudflare Zero Trust.

## Guided View AI

The Smart Guided View is powered by custom-trained **YOLOv8** computer vision models running via **ONNX Runtime**.

- **Models:** Optimized models for Manga (nested panel/bubble detection) and Western comics (speech bubble focus).
- **Settings:**
  - **Inference:** 640x640 input resolution.
  - **Thresholds:** 0.1 Confidence, 0.4 IOU (Non-Maximum Suppression).
  - **Smart Expansion:** Automatically scans up to 40px below panels to capture translation notes.
  - **Padding:** Applies a 2% safety margin to all detected areas for comfortable reading.

## Installation & Setup

1. **Clone the repository:**
   `git clone <repository-url>`
   `cd comics-now`

2. **Install system requirements:**
   Ubuntu/Debian: `sudo apt install poppler-utils zip unrar`

3. **Install app dependencies:**
   `npm install`

4. **Configure:**
   Copy the example config: `cp config.example.json config.json`
   Edit `config.json` to add your comic folders.

5. **Start:**
   `npm start`

Access the app in your browser at `http://localhost:3000`.

*See the [API Documentation](docs/API.md) for full technical details.*
