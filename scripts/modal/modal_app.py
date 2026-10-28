"""
Comics Guided View – Modal GPU inference service.

Deploy once:  modal deploy modal_app.py
Upload models: modal run modal_app.py::upload_models

The deployed function is called by runner.py to do panel/bubble detection
on a batch of comic pages, returning the same JSON structure that
comics-now writes to metadata/guided_view/{id}.json.
"""

import io
import modal

app = modal.App("comics-guided-view")

model_vol = modal.Volume.from_name("comics-guided-models", create_if_missing=True)

INFERENCE_IMAGE = (
    modal.Image.from_registry(
        "nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04",
        add_python="3.11",
    )
    .pip_install(
        "onnxruntime-gpu==1.18.1",  # compiled for CUDA 11.8 + cuDNN 8
        "Pillow>=10.4",
        "numpy>=1.24",
    )
)

# ── constants matching panel-detector.js DEFAULTS ────────────────────────────
INPUT_SIZE       = 640
CONF_MANGA       = 0.1
CONF_WESTERN     = 0.15
CONF_BUBBLE      = 0.1
IOU_NMS          = 0.15
SCAN_BELOW_PX    = 80
SCAN_BELOW_THRESH = 190

# ── container-level session cache (loaded once per warm container) ────────────
_sessions: dict = {}


def _get_session(model_type: str):
    import onnxruntime as ort, os
    if model_type in _sessions:
        return _sessions[model_type]
    models_dir = os.environ.get("GUIDED_MODELS_DIR", "/models")
    paths = {
        "manga":   f"{models_dir}/manga/manga.onnx",
        "western": f"{models_dir}/western/western.onnx",
        "bubble":  f"{models_dir}/bubble/speech_bubble_detector.onnx",
    }
    path = paths[model_type]
    if not os.path.exists(path):
        if model_type == "western" and os.path.exists(paths["manga"]):
            path = paths["manga"]
        else:
            raise FileNotFoundError(f"Model missing: {path}")
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 4
    sess = ort.InferenceSession(
        path, sess_options=opts,
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )
    _sessions[model_type] = sess
    return sess


# ── geometry helpers (JS ports) ───────────────────────────────────────────────

def _iou(a, b):
    xi = max(a[0], b[0]); yi = max(a[1], b[1])
    xb = min(a[0]+a[2], b[0]+b[2]); yb = min(a[1]+a[3], b[1]+b[3])
    inter = max(0.0, xb-xi) * max(0.0, yb-yi)
    union = a[2]*a[3] + b[2]*b[3] - inter
    return inter / union if union > 0 else 0.0


def _nms(boxes: list, thresh: float) -> list:
    boxes = sorted(boxes, key=lambda b: b[4], reverse=True)
    kept = []
    while boxes:
        top = boxes.pop(0)
        kept.append(top)
        boxes = [b for b in boxes if _iou(top, b) < thresh]
    return kept


def _intersection_over_area(a, b) -> float:
    xi = max(a[0], b[0]); yi = max(a[1], b[1])
    wi = min(a[0]+a[2], b[0]+b[2]) - xi
    hi = min(a[1]+a[3], b[1]+b[3]) - yi
    if wi <= 0 or hi <= 0:
        return 0.0
    area = a[2] * a[3]
    return (wi * hi) / area if area > 0 else 0.0


def _is_bubble_in_panel(bubble, panel) -> bool:
    cx = bubble[0] + bubble[2] / 2
    cy = bubble[1] + bubble[3] / 2
    return (panel[0] <= cx <= panel[0]+panel[2]
            and panel[1] <= cy <= panel[1]+panel[3])


XY_CUT_OVERLAP_RATIO = 0.08


def _find_best_axis_cut(indexed_boxes: list, axis: str, overlap_ratio: float = 0.0):
    n = len(indexed_boxes)
    if n <= 1:
        return None

    is_y = (axis == "y")
    if is_y:
        sorted_boxes = sorted(indexed_boxes, key=lambda item: (item[1][1], item[1][1] + item[1][3], item[0]))
    else:
        sorted_boxes = sorted(indexed_boxes, key=lambda item: (item[1][0], item[1][0] + item[1][2], item[0]))

    prefix_max_end = [0.0] * n
    max_end = float("-inf")
    for i, (_, b) in enumerate(sorted_boxes):
        end = (b[1] + b[3]) if is_y else (b[0] + b[2])
        if end > max_end:
            max_end = end
        prefix_max_end[i] = max_end

    min_coord = sorted_boxes[0][1][1] if is_y else sorted_boxes[0][1][0]
    max_coord = prefix_max_end[-1]

    best_idx = -1
    best_gap = float("-inf")

    for i in range(n - 1):
        next_start = sorted_boxes[i + 1][1][1] if is_y else sorted_boxes[i + 1][1][0]
        prev_end = prefix_max_end[i]
        gap = next_start - prev_end

        min_allowed_gap = 0.0
        if overlap_ratio > 0.0:
            first_span = max(1.0, prev_end - min_coord)
            second_span = max(1.0, max_coord - next_start)
            min_allowed_gap = -min(first_span, second_span) * overlap_ratio

        if gap >= min_allowed_gap and gap > best_gap:
            best_gap = gap
            best_idx = i

    if best_idx == -1:
        return None
    return sorted_boxes[: best_idx + 1], sorted_boxes[best_idx + 1 :]


def _fallback_linear_sort(indexed_boxes: list, type_: str) -> list:
    if type_ == "manga":
        return sorted(indexed_boxes, key=lambda item: (item[1][1] * 1.5 - (item[1][0] + item[1][2]), item[0]))
    return sorted(indexed_boxes, key=lambda item: (item[1][1] * 5.0 + item[1][0], item[0]))


def _xy_cut_partition(indexed_boxes: list, type_: str) -> list:
    if len(indexed_boxes) <= 1:
        return indexed_boxes

    clean_y = _find_best_axis_cut(indexed_boxes, "y", 0.0)
    if clean_y:
        first, second = clean_y
        return _xy_cut_partition(first, type_) + _xy_cut_partition(second, type_)

    clean_x = _find_best_axis_cut(indexed_boxes, "x", 0.0)
    if clean_x:
        first, second = clean_x
        if type_ == "manga":
            return _xy_cut_partition(second, type_) + _xy_cut_partition(first, type_)
        return _xy_cut_partition(first, type_) + _xy_cut_partition(second, type_)

    tol_y = _find_best_axis_cut(indexed_boxes, "y", XY_CUT_OVERLAP_RATIO)
    if tol_y:
        first, second = tol_y
        return _xy_cut_partition(first, type_) + _xy_cut_partition(second, type_)

    tol_x = _find_best_axis_cut(indexed_boxes, "x", XY_CUT_OVERLAP_RATIO)
    if tol_x:
        first, second = tol_x
        if type_ == "manga":
            return _xy_cut_partition(second, type_) + _xy_cut_partition(first, type_)
        return _xy_cut_partition(first, type_) + _xy_cut_partition(second, type_)

    return _fallback_linear_sort(indexed_boxes, type_)


def _sort_boxes(items: list, type_: str) -> list:
    if not items or len(items) <= 1:
        return items
    indexed = list(enumerate(items))
    return [b for _, b in _xy_cut_partition(indexed, type_)]


def _include_below_text(boxes: list, gray, orig_h: int, orig_w: int, cur_h: int = None, cur_w: int = None) -> list:
    """Extend panel boxes downward to capture translation notes (port of JS includeBelowText)."""
    import numpy as np
    if cur_h is None or cur_w is None:
        cur_h, cur_w = orig_h, orig_w
    scale_x = cur_w / orig_w
    scale_y = cur_h / orig_h
    for b in boxes:
        scan_y = int((b[1] + b[3]) * scale_y)
        furthest_ink_y = scan_y
        found_any_ink = False
        x_start = max(0, int((b[0] + b[2] * 0.1) * scale_x))
        x_end   = min(cur_w, int((b[0] + b[2] * 0.9) * scale_x))
        scan_below_px = int(SCAN_BELOW_PX * scale_y)
        for y in range(scan_y, min(cur_h, scan_y + scan_below_px)):
            row_has_ink = bool(np.any(gray[y, x_start:x_end] < SCAN_BELOW_THRESH))
            if row_has_ink:
                furthest_ink_y = y + 2
                found_any_ink = True
            else:
                if found_any_ink and y > furthest_ink_y + 4:
                    break
                if not found_any_ink and y > scan_y + 5:
                    break
        if found_any_ink:
            b[3] = min(float(orig_h - b[1]), float((furthest_ink_y / scale_y) - b[1]))
    return boxes


def _preprocess(img_bytes: bytes, fit: str, orig_w: int = None, orig_h: int = None):
    """Return (tensor, sx, sy, px, py, orig_w, orig_h, gray_np)."""
    import numpy as np
    from PIL import Image
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    cur_w, cur_h = img.size
    if orig_w is None:
        orig_w = cur_w
    if orig_h is None:
        orig_h = cur_h
    gray = np.array(img.convert("L"))

    if fit == "fill":
        resized = img.resize((INPUT_SIZE, INPUT_SIZE), Image.BILINEAR)
        sx, sy = orig_w / INPUT_SIZE, orig_h / INPUT_SIZE
        px = py = 0.0
    else:  # contain
        scale = max(orig_w, orig_h) / INPUT_SIZE
        scale_cur = INPUT_SIZE / max(cur_w, cur_h)
        nw, nh = round(cur_w * scale_cur), round(cur_h * scale_cur)
        padded = Image.new("RGB", (INPUT_SIZE, INPUT_SIZE), (0, 0, 0))
        # sharp's fit:'contain' centres the image in the letterbox — paste at
        # the same offset or every box comes back shifted by padX/padY.
        padded.paste(img.resize((nw, nh), Image.BILINEAR),
                     ((INPUT_SIZE - nw) // 2, (INPUT_SIZE - nh) // 2))
        resized = padded
        sx = sy = scale
        px = (INPUT_SIZE * scale - orig_w) / 2
        py = (INPUT_SIZE * scale - orig_h) / 2

    arr = np.array(resized, dtype=np.float32) / 255.0
    tensor = arr.transpose(2, 0, 1)[np.newaxis]  # 1×3×640×640
    return tensor, sx, sy, px, py, orig_w, orig_h, gray


def _prepare_page_tensors(img_bytes: bytes, comic_type: str = "manga", orig_w: int = None, orig_h: int = None) -> dict:
    """Decode image once and generate required tensors for panels and bubbles."""
    import numpy as np
    from PIL import Image
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    cur_w, cur_h = img.size
    if orig_w is None:
        orig_w = cur_w
    if orig_h is None:
        orig_h = cur_h
    gray = np.array(img.convert("L"))

    # contain tensor (used for bubbles in all comics and panels in manga)
    scale = max(orig_w, orig_h) / INPUT_SIZE
    scale_cur = INPUT_SIZE / max(cur_w, cur_h)
    nw, nh = round(cur_w * scale_cur), round(cur_h * scale_cur)
    padded = Image.new("RGB", (INPUT_SIZE, INPUT_SIZE), (0, 0, 0))
    padded.paste(img.resize((nw, nh), Image.BILINEAR),
                 ((INPUT_SIZE - nw) // 2, (INPUT_SIZE - nh) // 2))
    contain_arr = np.array(padded, dtype=np.float32) / 255.0
    contain_tensor = contain_arr.transpose(2, 0, 1)[np.newaxis]
    contain_px = (INPUT_SIZE * scale - orig_w) / 2
    contain_py = (INPUT_SIZE * scale - orig_h) / 2
    contain_info = (contain_tensor, scale, scale, contain_px, contain_py)

    if comic_type == "manga":
        panel_info = contain_info
    else:
        resized = img.resize((INPUT_SIZE, INPUT_SIZE), Image.BILINEAR)
        fill_arr = np.array(resized, dtype=np.float32) / 255.0
        fill_tensor = fill_arr.transpose(2, 0, 1)[np.newaxis]
        panel_info = (fill_tensor, orig_w / INPUT_SIZE, orig_h / INPUT_SIZE, 0.0, 0.0)

    return {
        "panel": panel_info,
        "bubble": contain_info,
        "contain": contain_info,
        "orig_w": orig_w,
        "orig_h": orig_h,
        "cur_w": cur_w,
        "cur_h": cur_h,
        "gray": gray,
    }


def _parse_output(data, dims, sx, sy, px, py, threshold, filter_cls=None) -> list:
    """Parse ONNX output into [x,y,w,h,conf] boxes. Handles both YOLOv8 output formats."""
def _rdp_simplify(points: list, epsilon: float) -> list:
    import math
    if not points or len(points) <= 3:
        return points
    max_dist = 0.0
    index = 0
    start = points[0]
    end = points[-1]
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    len_sq = dx * dx + dy * dy

    for i in range(1, len(points) - 1):
        p = points[i]
        if len_sq == 0:
            dist = math.hypot(p[0] - start[0], p[1] - start[1])
        else:
            t = max(0.0, min(1.0, ((p[0] - start[0]) * dx + (p[1] - start[1]) * dy) / len_sq))
            proj_x = start[0] + t * dx
            proj_y = start[1] + t * dy
            dist = math.hypot(p[0] - proj_x, p[1] - proj_y)
        if dist > max_dist:
            index = i
            max_dist = dist

    if max_dist > epsilon:
        left = _rdp_simplify(points[: index + 1], epsilon)
        right = _rdp_simplify(points[index:], epsilon)
        return left[:-1] + right
    return [start, end]


def _extract_polygon_from_proto(coeffs, proto_data, proto_dims, box, sx: float, sy: float, px: float, py: float, orig_w: int, orig_h: int):
    import math
    if coeffs is None or proto_data is None or len(proto_dims) < 4:
        return None
    num_protos = proto_dims[1]
    proto_h = proto_dims[2]
    proto_w = proto_dims[3]

    in_x1 = (box[0] + px) / sx
    in_y1 = (box[1] + py) / sy
    in_x2 = (box[0] + box[2] + px) / sx
    in_y2 = (box[1] + box[3] + py) / sy

    px1 = max(0, int(math.floor(in_x1 * (proto_w / INPUT_SIZE))))
    py1 = max(0, int(math.floor(in_y1 * (proto_h / INPUT_SIZE))))
    px2 = min(proto_w - 1, int(math.ceil(in_x2 * (proto_w / INPUT_SIZE))))
    py2 = min(proto_h - 1, int(math.ceil(in_y2 * (proto_h / INPUT_SIZE))))

    if px2 <= px1 or py2 <= py1:
        return None

    left_edge = []
    right_edge = []
    plane_size = proto_h * proto_w

    for py_i in range(py1, py2 + 1):
        row_min_x = -1
        row_max_x = -1
        row_offset = py_i * proto_w
        for px_i in range(px1, px2 + 1):
            idx = row_offset + px_i
            logit = 0.0
            for c in range(num_protos):
                logit += float(coeffs[c]) * float(proto_data[c * plane_size + idx])
            if logit > 0.0:
                if row_min_x == -1:
                    row_min_x = px_i
                row_max_x = px_i
        if row_min_x != -1:
            oy = max(0, min(orig_h, round(((py_i + 0.5) * (INPUT_SIZE / proto_h)) * sy - py)))
            ox_min = max(0, min(orig_w, round(((row_min_x + 0.5) * (INPUT_SIZE / proto_w)) * sx - px)))
            ox_max = max(0, min(orig_w, round(((row_max_x + 0.5) * (INPUT_SIZE / proto_w)) * sx - px)))
            left_edge.append([ox_min, oy])
            right_edge.append([ox_max, oy])

    if len(left_edge) < 2:
        return None
    raw_contour = left_edge + list(reversed(right_edge))
    epsilon = max(3.0, math.hypot(box[2], box[3]) * 0.025)
    simplified = _rdp_simplify(raw_contour, epsilon)
    return simplified if len(simplified) >= 3 else raw_contour[:4]


def _parse_output(data, dims, sx, sy, px, py, threshold, filter_cls=None, has_proto=False) -> list:
    """Parse ONNX output into [x,y,w,h,conf,(coeffs)] boxes. Handles both YOLOv8/v11 bbox and seg formats."""
    boxes = []
    if len(dims) >= 3 and dims[1] == 300 and dims[2] in (6, 38):
        stride = dims[2]
        with_mask = (stride == 38 and has_proto)
        for i in range(300):
            o = i * stride
            conf = float(data[o+4])
            cls  = int(data[o+5])
            if conf <= threshold:
                continue
            if filter_cls is not None and cls != filter_cls:
                continue
            x1 = data[o+0]*sx - px; y1 = data[o+1]*sy - py
            x2 = data[o+2]*sx - px; y2 = data[o+3]*sy - py
            w, h = x2-x1, y2-y1
            if w > 10 and h > 10:
                coeffs = list(data[o+6:o+38]) if with_mask else None
                boxes.append([x1, y1, w, h, conf, coeffs])
    elif len(dims) >= 3 and dims[1] >= 5 and dims[2] == 8400:
        N = 8400
        total_ch = dims[1]
        with_mask = (total_ch >= 37 and has_proto)
        mask_start_ch = total_ch - 32
        xd = data[:N]; yd = data[N:2*N]
        wd = data[2*N:3*N]; hd = data[3*N:4*N]
        cd = data[4*N:5*N]
        for i in range(N):
            if cd[i] <= threshold:
                continue
            w = wd[i]*sx; h = hd[i]*sy
            cx = xd[i]*sx - px; cy = yd[i]*sy - py
            coeffs = [float(data[(mask_start_ch + c) * N + i]) for c in range(32)] if with_mask else None
            boxes.append([cx-w/2, cy-h/2, w, h, float(cd[i]), coeffs])
    return boxes


def _detect_panels(img_bytes: bytes = None, comic_type: str = "manga",
                   conf_threshold=None, filter_cls=None, prepared: dict = None,
                   return_polygons: bool = False):
    if prepared is not None:
        tensor, sx, sy, px, py = prepared["contain"] if comic_type == "manga" else prepared["panel"]
        orig_w = prepared["orig_w"]
        orig_h = prepared["orig_h"]
        cur_w = prepared.get("cur_w", orig_w)
        cur_h = prepared.get("cur_h", orig_h)
        gray = prepared["gray"]
    else:
        fit = "contain" if comic_type == "manga" else "fill"
        tensor, sx, sy, px, py, orig_w, orig_h, gray = _preprocess(img_bytes, fit)
        cur_w, cur_h = orig_w, orig_h

    # Western falls back to manga model (no western.onnx in this library)
    sess = _get_session("manga")
    outputs = sess.run(None, {sess.get_inputs()[0].name: tensor})
    out = outputs[0]
    proto_out = outputs[1] if len(outputs) > 1 else None
    data = out.flatten()

    threshold = conf_threshold or (CONF_WESTERN if comic_type == "western" else CONF_MANGA)
    boxes = _parse_output(data, out.shape, sx, sy, px, py, threshold, filter_cls, has_proto=(proto_out is not None))
    boxes = _nms(boxes, IOU_NMS)

    if comic_type == "manga":
        boxes = _include_below_text(boxes, gray, orig_h, orig_w, cur_h, cur_w)

    if len(boxes) > 1:
        page_area = orig_w * orig_h
        boxes = [b for b in boxes if (b[2]*b[3]) / page_area < 0.98]

    if not boxes:
        return ([[0, 0, orig_w, orig_h]], {}) if return_polygons else [[0, 0, orig_w, orig_h]]

    rounded_boxes = []
    polygons = {}
    proto_flat = proto_out.flatten() if proto_out is not None else None
    proto_shape = proto_out.shape if proto_out is not None else None

    for b in boxes:
        rb = [round(b[0]), round(b[1]), round(b[2]), round(b[3])]
        rounded_boxes.append(rb)
        coeffs = b[5] if len(b) > 5 else None
        if coeffs is not None and proto_flat is not None:
            poly = _extract_polygon_from_proto(coeffs, proto_flat, proto_shape, b, sx, sy, px, py, orig_w, orig_h)
            if poly and len(poly) >= 3:
                polygons[f"{rb[0]},{rb[1]},{rb[2]},{rb[3]}"] = poly

    if return_polygons:
        return rounded_boxes, polygons
    return rounded_boxes


def _detect_bubbles(img_bytes: bytes = None, comic_type: str = "western", prepared: dict = None) -> list:
    if prepared is not None:
        tensor, sx, sy, px, py = prepared["contain"]
    else:
        tensor, sx, sy, px, py, *_ = _preprocess(img_bytes, "contain")
    sess = _get_session("bubble")
    out = sess.run(None, {sess.get_inputs()[0].name: tensor})[0].flatten()
    N = 8400
    xd=out[:N]; yd=out[N:2*N]; wd=out[2*N:3*N]; hd=out[3*N:4*N]
    c0=out[4*N:5*N]; c1=out[5*N:6*N]
    boxes = []
    for i in range(N):
        conf = max(float(c0[i]), float(c1[i]))
        if conf <= CONF_BUBBLE:
            continue
        w = wd[i]*sx*1.1; h = hd[i]*sy*1.1
        cx = xd[i]*sx - px; cy = yd[i]*sy - py
        boxes.append([cx-w/2, cy-h/2, w, h, conf])
    kept = _nms(boxes, 0.4)
    raw = [[round(b[0]), round(b[1]), round(b[2]), round(b[3])] for b in kept]
    return _sort_boxes(raw, comic_type)


def _build_manga_sequence(raw_panels: list, explicit_bubbles: list) -> list:
    """Port of buildMangaSequence from panel-detector.js."""
    if explicit_bubbles:
        panels = _sort_boxes(raw_panels, "manga")
        assigned: set = set()
        panel_objs = []
        for panel in panels:
            p_bubbles = []
            for i, bubble in enumerate(explicit_bubbles):
                if i not in assigned and (
                    _is_bubble_in_panel(bubble, panel)
                    or _intersection_over_area(bubble, panel) >= 0.6
                ):
                    p_bubbles.append(bubble)
                    assigned.add(i)
            panel_objs.append({"panel": panel,
                                "bubbles": _sort_boxes(p_bubbles, "manga")})
        orphans = [b for i, b in enumerate(explicit_bubbles) if i not in assigned]
        seq = []
        for obj in panel_objs:
            seq.extend(obj["bubbles"])
            seq.append(obj["panel"])
        seq.extend(orphans)
        return seq

    if not raw_panels:
        return []
    # No explicit bubbles: infer parent/child structure from containment
    is_child = [False] * len(raw_panels)
    for i in range(len(raw_panels)):
        for j in range(len(raw_panels)):
            if i != j and _intersection_over_area(raw_panels[i], raw_panels[j]) >= 0.7:
                is_child[i] = True
                break
    panels     = [b for i, b in enumerate(raw_panels) if not is_child[i]]
    all_bubbles = [b for i, b in enumerate(raw_panels) if is_child[i]]
    if not panels:
        return raw_panels
    assigned, panel_objs = set(), []
    for panel in _sort_boxes(panels, "manga"):
        p_bubbles = []
        for i, bubble in enumerate(all_bubbles):
            if i not in assigned and _intersection_over_area(bubble, panel) >= 0.6:
                p_bubbles.append(bubble)
                assigned.add(i)
        panel_objs.append({"panel": panel,
                            "bubbles": _sort_boxes(p_bubbles, "manga")})
    orphans = [b for i, b in enumerate(all_bubbles) if i not in assigned]
    seq = []
    for obj in panel_objs:
        seq.extend(obj["bubbles"])
        seq.append(obj["panel"])
    seq.extend(orphans)
    return seq


def _build_hybrid_western_sequence(panels: list, bubbles: list) -> list:
    """For Western comics, dialogue follows speech bubbles directly in their natural reading order."""
    if not bubbles:
        return []
    return _sort_boxes(bubbles, "western")


# ── Modal function ────────────────────────────────────────────────────────────

@app.function(
    image=INFERENCE_IMAGE,
    gpu="T4",
    volumes={"/models": model_vol},
    timeout=900,
)
def detect_pages_batch(pages: list, comic_type: str) -> dict:
    """
    pages      – list of [page_name: str, image_bytes: bytes]
    comic_type – "manga" or "western"

    Returns {page_name: {panels, bubbles, sequence}} matching the
    schema written to metadata/guided_view/{id}.json by panel-detector.js.
    """
    results = {}
    for item in pages:
        if len(item) == 4:
            page_name, img_bytes, orig_w, orig_h = item
        else:
            page_name, img_bytes = item[0], item[1]
            orig_w, orig_h = None, None
        try:
            # Mirror processComic in panel-detector.js exactly
            prepared = _prepare_page_tensors(img_bytes, comic_type, orig_w=orig_w, orig_h=orig_h)
            raw_panels, polygons = (
                _detect_panels(comic_type="manga", conf_threshold=0.1, prepared=prepared, return_polygons=True)
                if comic_type == "manga"
                else _detect_panels(comic_type="manga", conf_threshold=0.5, filter_cls=0, prepared=prepared, return_polygons=True)
            )
            panels  = _sort_boxes(raw_panels, comic_type)
            bubbles = _detect_bubbles(comic_type=comic_type, prepared=prepared)
            sequence = (
                _build_manga_sequence(raw_panels, bubbles)
                if comic_type == "manga"
                else _build_hybrid_western_sequence(panels, bubbles)
            )
            page_entry = {
                "panels":   panels,
                "bubbles":  bubbles,
                "sequence": sequence if sequence else panels,
            }
            if polygons:
                page_entry["polygons"] = polygons
            results[page_name] = page_entry
        except Exception as exc:
            import sys, traceback
            print(f"[Modal] Error processing {page_name}: {exc}", file=sys.stderr)
            traceback.print_exc()
            results[page_name] = {"panels": [], "bubbles": [], "sequence": []}
    return results


# ── one-time model upload ─────────────────────────────────────────────────────

@app.function(
    image=modal.Image.debian_slim(),
    volumes={"/models": model_vol},
)
def _write_model_file(dest: str, data: bytes) -> None:
    import pathlib
    p = pathlib.Path(dest)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    model_vol.commit()
    print(f"  written {dest}  ({len(data)//1024//1024} MB)")


@app.local_entrypoint()
def upload_models() -> None:
    """Upload ONNX models from /opt/comics-now/models → Modal Volume (run once)."""
    import pathlib
    models_dir = pathlib.Path("/opt/comics-now/models")
    onnx_files = sorted(models_dir.rglob("*.onnx"))
    if not onnx_files:
        print("No .onnx files found under", models_dir)
        return
    for src in onnx_files:
        rel  = src.relative_to(models_dir)
        dest = f"/models/{rel}"
        size_mb = src.stat().st_size / 1024 / 1024
        print(f"Uploading {rel}  ({size_mb:.1f} MB)…")
        _write_model_file.remote(dest, src.read_bytes())
    print("Done — models are in the 'comics-guided-models' Volume.")
