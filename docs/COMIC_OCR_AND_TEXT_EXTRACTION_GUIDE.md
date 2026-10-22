# In-Bubble Comic OCR & Text Extraction Guide

A complete technical guide for running specialized comic OCR models (**manga-ocr** and **GOT-OCR 2.0**) on Google Colab (Free Tier), extracting dialogue from speech bubbles, enriching **GVE-Now** sidecars, and enabling full-text dialogue search in **Comics Now**.

---

## 1. Executive Summary & Feasibility

| Dimension | In-Bubble Comic OCR on Google Colab Free Tier |
| :--- | :--- |
| **Realistic on Colab Free?** | **100% Realistic.** Requires zero model training—only batch inference on cropped bubble images. |
| **Execution Speed** | A free **NVIDIA T4 GPU (16GB VRAM)** processes ~15–25 speech bubbles per second. An entire 24-page comic issue (~120 bubbles) completes in **4 to 8 seconds**. |
| **Model Footprint** | `manga-ocr` (~400MB) runs fast on CPU or GPU. `GOT-OCR 2.0` (580M parameters, ~1.5GB VRAM in FP16) comfortably fits in Colab's 16GB memory. |
| **Value for Comics Now** | **Transformational.** Unlocks global full-text dialogue search across entire comic libraries via SQLite FTS5—a feature virtually nonexistent in self-hosted comic readers. |
| **Value for GVE Now** | Displays dialogue directly within the GVE-Now Inspector panel and stage tooltips, making sequence ordering and typo review effortless. |

---

## 2. Model Evaluation

| Model | Primary Specialty | Architecture | Strengths & Trade-offs |
| :--- | :--- | :--- | :--- |
| **`manga-ocr`** | **Japanese Manga** | ViT + RoBERTa (~400MB) | • Undisputed gold standard for Japanese text.<br>• Handles vertical text, furigana, stylized sound effects (SFX), and low-contrast manga inks.<br>• Japanese only. |
| **`GOT-OCR 2.0`** | **Western Comics & Universal** | 580M Vision-Language Model | • State-of-the-art for stylized Latin scripts, all-caps comic lettering (Blambot, Comicraft).<br>• High tolerance for curved bubbles, skewed text, and exclamation badges.<br>• Requires GPU acceleration for real-time throughput. |
| **`PaddleOCR`** | **Ultra-Lightweight Fallback** | MobileNet / PP-OCR (~15MB) | • Lightweight enough to run CPU-side directly in Node.js.<br>• Lower accuracy on stylized handwritten or angled comic dialogue. |

---

## 3. Architecture & Data Flow

Because Comics Now and GVE Now already produce bounding box coordinates `[x, y, w, h]` and polygon vertices:

```
[Comic Archive (.cbz)]
          │
          ▼
[Extract Page Image into Memory]
          │
          ▼
[Crop Bubble Coordinates [x, y, w, h] + 4px Padding]
          │
          ▼
[Colab Batch OCR (GOT-OCR 2.0 for Western / manga-ocr for Manga)]
          │
          ▼
[Attach Text to Sidecar: "bubbleTexts": [...]]
          │
          ├───────────────────────────────┐
          ▼                               ▼
[GVE-Now Sidecar Storage]       [Comics Now SQLite FTS5]
(guided-view/<comicId>.json)    (comic_dialogue_fts table)
          │                               │
          ▼                               ▼
[In-Editor Text Inspector]      [Global Dialogue Search Bar]
[Web Speech API Narration]      [On-Tap Manga Translation]
```

---

## 4. Enhanced Sidecar Schema

The sidecar format maintains backwards compatibility by adding an optional `bubbleTexts` array parallel to `bubbles`:

```json
{
  "comicId": "superman-action-001",
  "type": "western",
  "pages": {
    "page-001.jpg": {
      "panels": [
        [100, 80, 800, 600]
      ],
      "bubbles": [
        [120, 90, 300, 150],
        [450, 110, 280, 140]
      ],
      "bubbleTexts": [
        "LOOK OUT, CLARK!",
        "HE'S GOT KRYPTONITE!"
      ],
      "sequence": [
        [120, 90, 300, 150],
        [450, 110, 280, 140]
      ]
    }
  }
}
```

---

## 5. Comics Now SQLite FTS5 Full-Text Search Schema

To index dialogue across millions of pages without bloating database size, use SQLite's native FTS5 extension in `comics-now.db`:

```sql
-- 1. Create Virtual Full-Text Search Table
CREATE VIRTUAL TABLE IF NOT EXISTS comic_dialogue_fts USING fts5(
  comic_id UNINDEXED,
  page_name UNINDEXED,
  bubble_index UNINDEXED,
  dialogue,
  tokenize = 'porter unicode61'
);

-- 2. Index Dialogue per Bubble
INSERT INTO comic_dialogue_fts(comic_id, page_name, bubble_index, dialogue)
VALUES ('superman-action-001', 'page-001.jpg', 0, 'LOOK OUT, CLARK!');

-- 3. Instant Search Query (across tens of thousands of issues)
SELECT 
  c.id, 
  c.name, 
  c.series, 
  fts.page_name, 
  fts.bubble_index, 
  snippet(comic_dialogue_fts, 3, '<b>', '</b>', '...', 10) AS match_snippet
FROM comic_dialogue_fts fts
JOIN comics c ON c.id = fts.comic_id
WHERE comic_dialogue_fts MATCH 'kryptonite'
LIMIT 25;
```

---

## 6. Complete Google Colab Batch Processing Script

Run this script in a Colab notebook with a **T4 GPU**:

```python
# Cell 1: Environment Setup
from google.colab import drive
drive.mount('/content/drive')

!pip install -q transformers torch torchvision pillow manga-ocr zipfile36
```

```python
# Cell 2: Production Comic OCR Pipeline
import os
import json
import zipfile
from PIL import Image
import torch
from transformers import AutoModel, AutoTokenizer
from manga_ocr import MangaOcr

class ComicBubbleOCR:
    def __init__(self, mode='western'):
        self.mode = mode
        if mode == 'manga':
            print("Loading manga-ocr for Japanese dialogue...")
            self.mocr = MangaOcr()
        else:
            print("Loading GOT-OCR 2.0 on T4 GPU...")
            self.tokenizer = AutoTokenizer.from_pretrained('ucasLC/GOT-OCR2_0', trust_remote_code=True)
            self.model = AutoModel.from_pretrained(
                'ucasLC/GOT-OCR2_0',
                trust_remote_code=True,
                low_cpu_mem_usage=True,
                device_map='cuda',
                use_safetensors=True,
                torch_dtype=torch.float16
            ).eval()

    def recognize(self, crop_image):
        if self.mode == 'manga':
            return self.mocr(crop_image).strip()
        else:
            with torch.inference_mode():
                result = self.model.chat(self.tokenizer, crop_image, ocr_type='ocr')
            return result.strip()

    def process_issue(self, cbz_path, sidecar_path, output_sidecar_path):
        if not os.path.exists(cbz_path) or not os.path.exists(sidecar_path):
            print(f"File not found: {cbz_path} or {sidecar_path}")
            return

        with open(sidecar_path, 'r', encoding='utf-8') as f:
            sidecar = json.load(f)

        pages = sidecar.get('pages', {})
        total_bubbles = 0

        with zipfile.ZipFile(cbz_path, 'r') as archive:
            for page_name, page_data in pages.items():
                bubbles = page_data.get('bubbles', [])
                if not bubbles:
                    continue

                try:
                    with archive.open(page_name) as img_entry:
                        full_img = Image.open(img_entry).convert('RGB')
                        w_page, h_page = full_img.size
                        
                        bubble_texts = []
                        for b in bubbles:
                            bx, by, bw, bh = b
                            # Pad by 4 pixels to preserve text near borders
                            pad = 4
                            crop_box = (
                                max(0, bx - pad),
                                max(0, by - pad),
                                min(w_page, bx + bw + pad),
                                min(h_page, by + bh + pad)
                            )
                            crop = full_img.crop(crop_box)
                            text = self.recognize(crop)
                            bubble_texts.append(text)
                            total_bubbles += 1

                        page_data['bubbleTexts'] = bubble_texts
                except Exception as err:
                    print(f"Error on page {page_name}: {err}")

        with open(output_sidecar_path, 'w', encoding='utf-8') as f:
            json.dump(sidecar, f, indent=2, ensure_ascii=False)

        print(f"Successfully processed {total_bubbles} speech bubbles -> {output_sidecar_path}")

# Example Usage:
# ocr = ComicBubbleOCR(mode='western')
# ocr.process_issue('Batman_001.cbz', 'Batman_001.json', 'Batman_001_enriched.json')
```

---

## 7. Product Features Enabled in Comics Now & GVE Now

1. **Global Dialogue Search**:
   * Add a `dialogue` search filter to Comics Now's existing library search.
   * Clicking a search hit immediately launches Guided View focused on that exact page and bubble.
2. **Text-to-Speech (A11y Narration)**:
   * During Guided View, as each bubble zooms into focus, invoke the browser's native Web Speech API:
     ```javascript
     if (bubbleText) {
       const utterance = new SpeechSynthesisUtterance(bubbleText);
       window.speechSynthesis.speak(utterance);
     }
     ```
   * Completely client-side, zero server CPU overhead.
3. **On-Tap Manga Translation**:
   * For raw Japanese manga, tapping a bubble displays an interactive tooltip with machine-translated English (via DeepL or local Ollama).
4. **GVE-Now Sequence Verification**:
   * Hovering over bubble badges on the GVE-Now canvas displays the first 25 characters of the dialogue, allowing immediate human verification of reading order correctness without having to decipher small fonts at high zoom.
