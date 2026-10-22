# Fine-Tuning Comic Panel & Speech Bubble Detectors on Google Colab (Free Tier)

A practical guide for training and fine-tuning instance segmentation models (YOLO11-seg) on comic datasets using Google Colab's free GPU tier, exporting to ONNX, and formatting polygon detections directly for **Comics Now** and **GVE Now**.

---

## 1. Executive Summary & Feasibility

### Is it Realistic on Google Colab Free Tier?
* **With YOLO11-seg (`yolo11s-seg` / `yolo11n-seg`): YES (100% Realistic)**
  * Colab Free provides an **NVIDIA T4 GPU (15–16 GB VRAM)**.
  * Transfer learning from pretrained `yolo11s-seg.pt` on ~1,000–3,000 comic pages for **30–50 epochs** takes **45 to 75 minutes** total.
  * Fits well within Colab's standard 3-4 hour session timeout and memory limits.
  * Exports natively to standard ONNX in one command without unsupported PyTorch operators.
* **With Mask R-CNN or DETR (Mask2Former): NO (Not Recommended)**
  * Heavy memory footprint, slow epoch turnaround on T4 (often causing Colab kernel crashes or OOM errors).
  * Extremely difficult to export cleanly to ONNX for consumption by Node.js (`onnxruntime-node`).

### Is it Valuable for Comics Now & GVE Now?
* **Speech Bubbles (High Value):**
  * Comic bubbles are circular, oval, or jagged burst contours. Rectangular bounding boxes capture adjacent panel lines and background art. Instance polygons isolate text cleanly.
* **Panels (High Value for Manga & Modern Comics):**
  * Manga and dynamic western comics frequently use non-rectangular panels (slanted gutters, diagonal action cuts, trapezoids, splash bleeds).
  * **GVE Now** natively supports polygon vertex arrays (`panelPoints` / `bubblePoints`) alongside bounding boxes in its sidecar schema. Having the detector emit polygons eliminates manual polygon authoring in the stage editor.
* **Runtime Compatibility:**
  * Comics Now already uses `onnxruntime-node` at 640x640 resolution (`server/services/panel-detector.js`).
  * GVE Now sidecars accept both bounding boxes `[x, y, w, h]` and polygon coordinate arrays `[[x, y], ...]` without schema migrations.

---

## 2. GVE-Now Sidecar Data Contract

GVE-Now sidecars (`<comicId>.json`) use the following schema:

```json
{
  "comicId": "issue-001",
  "type": "western",
  "pages": {
    "page-001.jpg": {
      "panels": [
        [120, 80, 850, 600]
      ],
      "bubbles": [
        [150, 100, 320, 210]
      ],
      "sequence": [
        [150, 100, 320, 210]
      ],
      "panelPoints": [
        [[120, 80], [970, 110], [950, 680], [120, 680]]
      ],
      "bubblePoints": [
        [[150, 140], [210, 100], [420, 105], [470, 200], [380, 310], [160, 280]]
      ]
    }
  }
}
```

* Coordinates are **absolute integer pixels** with a top-left origin `(0, 0)`.
* `panelPoints` and `bubblePoints` are parallel arrays to `panels` and `bubbles` respectively. Rectangular items can be set to `null` or 4-point rectangles.

---

## 3. Dataset Preparation

YOLO Segmentation format expects a text file per image (`.txt` corresponding to each `.jpg`/`.png`):
```text
<class_id> <x1> <y1> <x2> <y2> <x3> <y3> ... <xn> <yn>
```
*(All coordinates normalized between 0.0 and 1.0)*

* **Class 0**: `panel`
* **Class 1**: `bubble`

### Open Comic Datasets:
1. **Roboflow Universe**: Search for "Comic Panel Segmentation" or "Speech Bubble Segmentation". Download directly into Colab in **YOLOv11 PyTorch Segmentation** format.
2. **Comic-20k / DCM772**: Great open datasets for French/Belgian and Western graphic novels.
3. **Manga109**: Comprehensive Japanese manga dataset (requires requesting academic license download credentials).

---

## 4. Google Colab Notebook (Complete Code)

### Step 1: Hardware Setup & Drive Mounting
In Colab: **Runtime → Change runtime type → T4 GPU (Free)**.

```python
# Mount Google Drive to persist weights and avoid loss on session disconnect
from google.colab import drive
drive.mount('/content/drive')

# Install dependencies
!pip install -q ultralytics albumentations opencv-python
```

### Step 2: Dataset Configuration (`data.yaml`)

```python
import yaml

dataset_yaml = {
    'path': '/content/dataset',  # Root path to dataset
    'train': 'images/train',
    'val': 'images/val',
    'names': {
        0: 'panel',
        1: 'bubble'
    }
}

with open('/content/data.yaml', 'w') as f:
    yaml.dump(dataset_yaml, f)
```

### Step 3: Fine-Tuning YOLO11-seg

```python
from ultralytics import YOLO

# Load pretrained segmentation model (Small or Nano)
model = YOLO('yolo11s-seg.pt')

# Train on T4 GPU
results = model.train(
    data='/content/data.yaml',
    epochs=40,                                     # 30-50 epochs is ideal for fine-tuning
    imgsz=640,                                     # Standard 640x640 matches comics-now
    batch=16,                                      # Safe for 16GB T4 VRAM
    device=0,                                      # GPU
    project='/content/drive/MyDrive/comics-models',# Persist to Google Drive
    name='comic_panel_bubble_seg',
    save=True,
    patience=10,
    optimizer='AdamW',
    lr0=0.001
)
```

### Step 4: Export to ONNX

```python
# Load the best saved checkpoint from Google Drive
trained_model = YOLO('/content/drive/MyDrive/comics-models/comic_panel_bubble_seg/weights/best.pt')

# Export to ONNX with polygon/mask outputs enabled
trained_model.export(format='onnx', imgsz=640, simplify=True)
print("Model exported to ONNX successfully!")
```

---

## 5. Converting Inference Masks to GVE-Now Polygon JSON

To prevent millions of raw mask pixels from bloating sidecar JSONs, use **Douglas-Peucker approximation (`cv2.approxPolyDP`)** to produce smooth 4-to-12 vertex polygons:

```python
import cv2
import json
import numpy as np
from ultralytics import YOLO

def mask_to_polygon_and_box(mask, original_width, original_height, epsilon_factor=0.012):
    """
    Converts binary instance mask to GVE-Now polygon points and bounding box.
    """
    # Scale mask back to original comic page dimensions
    mask_scaled = cv2.resize(
        mask.astype(np.uint8),
        (original_width, original_height),
        interpolation=cv2.INTER_NEAREST
    )
    
    # Extract contour
    contours, _ = cv2.findContours(mask_scaled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, None
        
    c = max(contours, key=cv2.contourArea)
    
    # Simplify polygon (Douglas-Peucker)
    epsilon = epsilon_factor * cv2.arcLength(c, True)
    approx = cv2.approxPolyDP(c, epsilon, True)
    
    # Convert points to absolute integer coordinates [[x, y], ...]
    points = [[int(pt[0][0]), int(pt[0][1])] for pt in approx]
    
    # Calculate bounding box [x, y, w, h]
    x, y, w, h = cv2.boundingRect(c)
    box = [int(x), int(y), int(w), int(h)]
    
    return box, points

def generate_gve_sidecar_page(image_path, model):
    img = cv2.imread(image_path)
    h, w = img.shape[:2]
    
    results = model.predict(source=img, imgsz=640, conf=0.15)
    result = results[0]
    
    panels, bubbles = [], []
    panel_points, bubble_points = [], []
    
    if result.masks is not None:
        masks = result.masks.data.cpu().numpy()
        classes = result.boxes.cls.cpu().numpy().astype(int)
        
        for mask, cls_id in zip(masks, classes):
            box, points = mask_to_polygon_and_box(mask, w, h)
            if not box:
                continue
                
            if cls_id == 0:  # Panel
                panels.append(box)
                panel_points.append(points)
            elif cls_id == 1:  # Bubble
                bubbles.append(box)
                bubble_points.append(points)
                
    return {
        "panels": panels,
        "bubbles": bubbles,
        "sequence": bubbles if len(bubbles) > 0 else panels,
        "panelPoints": panel_points if len(panel_points) > 0 else None,
        "bubblePoints": bubble_points if len(bubble_points) > 0 else None
    }
```

---

## 6. Colab Free Tier Best Practices

1. **Mount Google Drive first**: Always set `project='/content/drive/MyDrive/...'` in `model.train()`. If Colab disconnects, your weights and checkpoints remain safe in Drive.
2. **Batch sizing**: Use `batch=16` for `yolo11s-seg` and `batch=8` if using `imgsz=1024`.
3. **Prevent Idle Timeouts**: Keep the browser tab open and active during training (~45-60 min).
4. **Target ONNX size**: `yolo11s-seg.onnx` is ~22 MB (much lighter and faster than older 100MB+ detectors).
