import io
from typing import Any, Dict, List, Optional
from PIL import Image, ImageDraw, ImageFont


def _load_font(size: int = 16) -> ImageFont.ImageFont:
    try:
        # Common DejaVu / Liberation fonts on Linux
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
    except Exception:
        try:
            return ImageFont.truetype("DejaVuSans-Bold.ttf", size)
        except Exception:
            return ImageFont.load_default()


def render_guided_overlay(
    image_bytes: bytes,
    items: List[Dict[str, Any]],
    order: Optional[List[str]] = None,
    output_format: str = "PNG",
) -> bytes:
    """Render bounding boxes and reading-order sequence badges on top of a comic page image.

    Args:
        image_bytes: Raw bytes of the original page image (JPEG, WebP, PNG).
        items: List of guided view items, each with:
               id: str
               kind: "bubble" | "panel"
               box: [x, y, w, h]
        order: List of item IDs representing the 1-based reading sequence order.
        output_format: "PNG" or "JPEG" or "WEBP". Default is "PNG".

    Returns:
        Bytes of the composited image.
    """
    base_img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    img_w, img_h = base_img.size

    # Create transparent overlay layer for alpha blending
    overlay = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Scale stroke & badge dimensions proportionally to image resolution
    ref_dim = min(img_w, img_h)
    line_width = max(2, int(ref_dim / 350))
    badge_radius = max(12, int(ref_dim / 45))
    font_size = max(10, int(badge_radius * 1.1))
    font = _load_font(font_size)

    # Style colors matching GVE Now
    PANEL_STROKE = (45, 212, 191, 230)       # #2dd4bf (teal)
    PANEL_FILL = (45, 212, 191, 35)
    BUBBLE_STROKE = (251, 191, 36, 230)     # #fbbf24 (amber)
    BUBBLE_FILL = (251, 191, 36, 40)
    BADGE_BG = (23, 26, 33, 230)             # #171a21
    TEXT_COLOR = (255, 255, 255, 255)

    order_map = {}
    if order:
        for idx, item_id in enumerate(order, start=1):
            order_map[item_id] = idx
    else:
        for idx, it in enumerate(items, start=1):
            if "id" in it:
                order_map[it["id"]] = idx

    # Pass 1: Draw box fills and outlines
    for item in items:
        box = item.get("box")
        if not box or len(box) < 4:
            continue
        x, y, w, h = box[0], box[1], box[2], box[3]
        x0, y0 = x, y
        x1, y1 = x + w, y + h

        kind = item.get("kind", "panel")
        stroke_color = BUBBLE_STROKE if kind == "bubble" else PANEL_STROKE
        fill_color = BUBBLE_FILL if kind == "bubble" else PANEL_FILL

        # Draw translucent filled rectangle
        draw.rectangle([x0, y0, x1, y1], fill=fill_color, outline=stroke_color, width=line_width)

    # Pass 2: Draw sequence badges (drawn after all boxes so badges stay on top)
    for item in items:
        item_id = item.get("id")
        seq_num = order_map.get(item_id)
        if seq_num is None:
            continue

        box = item.get("box")
        if not box or len(box) < 4:
            continue
        x, y = box[0], box[1]
        kind = item.get("kind", "panel")
        ring_color = BUBBLE_STROKE if kind == "bubble" else PANEL_STROKE

        # Center badge at the top-left of the box (offset inward so it doesn't get clipped)
        cx = max(badge_radius + 2, min(img_w - badge_radius - 2, x + badge_radius + 2))
        cy = max(badge_radius + 2, min(img_h - badge_radius - 2, y + badge_radius + 2))

        # Circular badge background
        draw.ellipse(
            [cx - badge_radius, cy - badge_radius, cx + badge_radius, cy + badge_radius],
            fill=BADGE_BG,
            outline=ring_color,
            width=max(2, int(line_width * 0.8)),
        )

        # Centered number text
        text = str(seq_num)
        try:
            bbox = draw.textbbox((0, 0), text, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
        except Exception:
            tw, th = 8, 8
        draw.text((cx - tw / 2, cy - th / 2 - 1), text, fill=TEXT_COLOR, font=font)

    # Composite overlay onto base image
    composited = Image.alpha_composite(base_img, overlay).convert("RGB")

    out_buf = io.BytesIO()
    fmt = output_format.upper()
    if fmt == "WEBP":
        composited.save(out_buf, format="WEBP", quality=90)
    elif fmt == "JPEG":
        composited.save(out_buf, format="JPEG", quality=90)
    else:
        composited.save(out_buf, format="PNG")

    return out_buf.getvalue()
