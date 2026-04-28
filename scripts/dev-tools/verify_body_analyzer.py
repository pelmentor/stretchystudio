"""Independent ground-truth check of bodyAnalyzer.js output.

Reads each PSD, composites layer alpha for core/limb body tags directly,
computes the same metrics bodyAnalyzer.js computes, and diffs against the
rig.log.json produced by the live export. Purpose: catch analyzer bugs
before Step 2 consumes these metrics.
"""

import json
import sys
from pathlib import Path
from psd_tools import PSDImage
from PIL import Image
import numpy as np

ROOT = Path(r"d:/Projects/Programming/stretchystudio")

CORE_TAGS = {"topwear", "bottomwear"}
LIMB_TAGS = {"legwear", "legwear-l", "legwear-r",
             "footwear", "footwear-l", "footwear-r"}
ALPHA_THRESHOLD = 16


def match_tag(name: str):
    known = ["neck", "neckwear", "topwear", "handwear", "bottomwear",
             "legwear", "footwear"]
    lower = name.lower().strip()
    for t in known:
        if lower == t:
            return t
    for t in known:
        if lower.startswith(t + "-") or lower.startswith(t + " ") or lower.startswith(t + "_"):
            # Preserve -l/-r suffix for legwear/footwear since those are separately tracked.
            if t in ("legwear", "footwear", "handwear"):
                # Find variant
                for suffix in ("-l", "-r"):
                    if lower.startswith(t + suffix):
                        return t + suffix
                return t
            return t
    return None


def walk(layer, out):
    if layer.is_group():
        for c in layer:
            walk(c, out)
    else:
        out.append(layer)


def composite_layer_alpha(layer, canvas_w, canvas_h):
    """Return a boolean mask (canvas_h, canvas_w) of where this layer has alpha > threshold."""
    pil = layer.composite()
    if pil is None:
        return None
    if pil.mode != "RGBA":
        pil = pil.convert("RGBA")
    mask_full = np.zeros((canvas_h, canvas_w), dtype=bool)
    left, top = layer.left, layer.top
    right, bottom = layer.right, layer.bottom
    arr = np.array(pil)  # (h, w, 4)
    alpha = arr[..., 3] > ALPHA_THRESHOLD
    lh, lw = alpha.shape
    # Clip to canvas
    cl, ct = max(0, left), max(0, top)
    cr, cb = min(canvas_w, left + lw), min(canvas_h, top + lh)
    sl = cl - left
    st = ct - top
    sr = sl + (cr - cl)
    sb = st + (cb - ct)
    if cr > cl and cb > ct:
        mask_full[ct:cb, cl:cr] = alpha[st:sb, sl:sr]
    return mask_full


def analyze(psd_path: Path):
    psd = PSDImage.open(psd_path)
    W, H = psd.width, psd.height
    flat = []
    for layer in psd:
        walk(layer, flat)

    core_mask = np.zeros((H, W), dtype=bool)
    full_mask = np.zeros((H, W), dtype=bool)
    core_tags_found = []
    limb_tags_found = []

    topwear_bbox = None
    bottomwear_bbox = None

    for layer in flat:
        if not layer.visible:
            continue
        tag = match_tag(layer.name or "")
        if not tag:
            continue
        is_core = tag in CORE_TAGS
        is_limb = tag in LIMB_TAGS
        if not (is_core or is_limb):
            continue
        m = composite_layer_alpha(layer, W, H)
        if m is None or not m.any():
            continue
        if is_core:
            core_tags_found.append(tag)
            core_mask |= m
        if is_limb:
            limb_tags_found.append(tag)
        full_mask |= m

        # Layer bbox (for topwear/bottomwear — matches JS's mesh-vertex bbox semantics
        # only approximately; JS uses mesh vertices, here we use alpha bbox).
        ys, xs = np.where(m)
        if len(xs) == 0:
            continue
        lb = {"minX": int(xs.min()), "maxX": int(xs.max()),
              "minY": int(ys.min()), "maxY": int(ys.max())}
        if tag == "topwear":
            topwear_bbox = union_bbox(topwear_bbox, lb)
        elif tag == "bottomwear":
            bottomwear_bbox = union_bbox(bottomwear_bbox, lb)

    # Per-row stats
    core_any = core_mask.any(axis=1)
    full_any = full_mask.any(axis=1)

    # core left/right
    def row_lr(mask_row):
        xs = np.where(mask_row)[0]
        if len(xs) == 0:
            return (-1, -1)
        return (int(xs[0]), int(xs[-1]))

    core_lr = [row_lr(core_mask[y]) for y in range(H)]
    full_lr = [row_lr(full_mask[y]) for y in range(H)]

    rows_with_core = np.where(core_any)[0]
    rows_with_full = np.where(full_any)[0]

    if len(rows_with_core) == 0:
        return {"skipped": "empty-core", "W": W, "H": H,
                "core_tags_found": core_tags_found,
                "limb_tags_found": limb_tags_found}

    core_top_y = int(rows_with_core[0])
    core_bottom_y = int(rows_with_core[-1])
    full_top_y = int(rows_with_full[0]) if len(rows_with_full) else core_top_y
    full_bottom_y = int(rows_with_full[-1]) if len(rows_with_full) else core_bottom_y

    def width_at(y, lr):
        l, r = lr[y]
        return (r - l + 1) if l >= 0 else 0

    def center_at(y, lr):
        l, r = lr[y]
        if l < 0: return None
        return (l + r) / 2

    # Weighted spine + max width
    sum_num = 0.0; sum_den = 0.0
    max_w = 0; max_w_y = core_top_y
    for y in range(core_top_y, core_bottom_y + 1):
        l, r = core_lr[y]
        if l < 0: continue
        w = r - l + 1
        cx = (l + r) / 2
        sum_num += cx * w
        sum_den += w
        if w > max_w:
            max_w = w; max_w_y = y
    spine_x_overall = sum_num / sum_den if sum_den > 0 else None

    # hip candidates
    hip_top_max_y = topwear_bbox["maxY"] if topwear_bbox else None
    hip_widest = max_w_y
    hip_span_mid = (core_top_y + core_bottom_y) // 2
    hip_y = hip_top_max_y if (bottomwear_bbox and hip_top_max_y is not None) else hip_widest

    # Sampled profile
    SAMPLES = 20
    profile = []
    for s in range(SAMPLES + 1):
        t = s / SAMPLES
        y = round(core_top_y + t * (core_bottom_y - core_top_y))
        profile.append({
            "t": round(t, 3),
            "y": y,
            "coreWidth": width_at(y, core_lr),
            "fullWidth": width_at(y, full_lr),
            "spineX": round(center_at(y, core_lr), 2) if center_at(y, core_lr) is not None else None,
        })

    return {
        "W": W, "H": H,
        "coreTagsFound": sorted(set(core_tags_found)),
        "coreMeshCount": len(core_tags_found),
        "limbTagsFound": sorted(set(limb_tags_found)),
        "limbMeshCount": len(limb_tags_found),
        "topwearBbox": topwear_bbox,
        "bottomwearBbox": bottomwear_bbox,
        "anchors": {
            "shoulderY": core_top_y,
            "hipY": hip_y,
            "hipCandidates": {
                "topwearMaxY": hip_top_max_y,
                "widestCoreY": hip_widest,
                "spanMid": hip_span_mid,
            },
            "feetY": full_bottom_y,
            "spineX_atShoulder": round(center_at(core_top_y, core_lr), 2) if center_at(core_top_y, core_lr) is not None else None,
            "spineX_atHip": round(center_at(hip_y, core_lr), 2) if center_at(hip_y, core_lr) is not None else None,
            "spineX_overall": round(spine_x_overall, 2) if spine_x_overall is not None else None,
        },
        "widthStats": {
            "maxCoreWidth": max_w,
            "maxCoreWidthY": max_w_y,
            "shoulderWidth": width_at(core_top_y, core_lr),
            "hipWidth": width_at(hip_y, core_lr),
            "feetSpreadWidth": width_at(full_bottom_y, full_lr),
            "coreHeight": core_bottom_y - core_top_y + 1,
            "fullHeight": full_bottom_y - full_top_y + 1,
        },
        "widthProfile": profile,
    }


def union_bbox(a, b):
    if a is None: return b
    if b is None: return a
    return {
        "minX": min(a["minX"], b["minX"]),
        "maxX": max(a["maxX"], b["maxX"]),
        "minY": min(a["minY"], b["minY"]),
        "maxY": max(a["maxY"], b["maxY"]),
    }


def diff(name, jsd, pyd):
    def pget(d, *keys, default=None):
        for k in keys:
            if d is None: return default
            d = d.get(k, default) if isinstance(d, dict) else default
        return d
    print(f"\n=== {name.upper()} ===")
    print(f"canvas JS {jsd['canvas']}  PY {pyd['W']}x{pyd['H']}")
    b = jsd["body"]
    print(f"\n  JS coreTags: {b['coreTagsFound']}  count {b.get('coreMeshCount', '?')}")
    print(f"  PY coreTags: {pyd['coreTagsFound']}  count {pyd['coreMeshCount']}")
    print(f"\n  JS limbTags: {b['limbTagsFound']}  count {b.get('limbMeshCount', '?')}")
    print(f"  PY limbTags: {pyd['limbTagsFound']}  count {pyd['limbMeshCount']}")

    print(f"\n  topwearBbox   JS: {b['topwearBbox']}")
    print(f"                PY: {pyd['topwearBbox']}")
    print(f"  bottomwearBbox JS: {b['bottomwearBbox']}")
    print(f"                 PY: {pyd['bottomwearBbox']}")

    for k in ("shoulderY", "hipY", "feetY", "spineX_overall", "spineX_atShoulder", "spineX_atHip"):
        jv = b["anchors"].get(k)
        pv = pyd["anchors"].get(k)
        diff = ""
        if jv is not None and pv is not None:
            try:
                diff = f"  delta={float(jv)-float(pv):+.2f}"
            except Exception:
                pass
        print(f"  {k:20s} JS={jv}  PY={pv}{diff}")

    print(f"\n  hipCandidates JS: {b['anchors'].get('hipCandidates')}")
    print(f"                PY: {pyd['anchors']['hipCandidates']}")

    for k in ("maxCoreWidth", "maxCoreWidthY", "shoulderWidth", "hipWidth",
              "feetSpreadWidth", "coreHeight", "fullHeight"):
        jv = b["widthStats"].get(k)
        pv = pyd["widthStats"].get(k)
        diff = ""
        if jv is not None and pv is not None:
            try:
                diff = f"  delta={float(jv)-float(pv):+.2f}"
            except Exception:
                pass
        print(f"  {k:20s} JS={jv}  PY={pv}{diff}")


def main():
    for name in ("girl", "waifu", "shelby"):
        psd = ROOT / f"{name}.psd"
        log = ROOT / f"{name}.rig.log.json"
        if not psd.exists() or not log.exists():
            print(f"skip {name}: missing files")
            continue
        with open(log) as f:
            jsd = json.load(f)
        pyd = analyze(psd)
        diff(name, jsd, pyd)


if __name__ == "__main__":
    main()
