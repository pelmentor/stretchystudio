"""Analyze See-Through depth PSDs — verify format, extract per-layer stats.

For each {character}_depth.psd:
 - List all layers, compare to {character}.psd layer structure
 - For each matching tag: extract grayscale depth + alpha
 - Report mean/min/max depth, coverage area, alpha coverage
 - Determine convention (black=near or white=near) by comparing known
   front-of-character layers vs back-of-character layers
"""

import sys
from pathlib import Path
from psd_tools import PSDImage
from PIL import Image
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(r"d:/Projects/Programming/stretchystudio")


def walk(layer, out):
    if layer.is_group():
        for c in layer:
            walk(c, out)
    else:
        out.append(layer)


def match_tag(name: str):
    """Copy of SS matchTag logic."""
    known = [
        'back hair', 'front hair', 'headwear', 'face',
        'irides', 'eyebrow', 'eyewhite', 'eyelash', 'eyewear',
        'ears', 'earwear', 'nose', 'mouth',
        'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear',
        'legwear', 'footwear', 'tail', 'wings', 'objects',
    ]
    lower = name.lower().strip()
    for t in known:
        if lower == t:
            return t
    for t in known:
        if lower.startswith(t + '-') or lower.startswith(t + ' ') or lower.startswith(t + '_'):
            for suffix in ('-l', '-r'):
                if lower.startswith(t + suffix):
                    return t + suffix
            return t
    return None


def layer_depth_stats(layer, canvas_w, canvas_h):
    """Return dict with depth stats (only where alpha > threshold)."""
    pil = layer.composite()
    if pil is None:
        return None
    if pil.mode != 'RGBA':
        pil = pil.convert('RGBA')
    arr = np.array(pil)  # (h, w, 4)
    rgb = arr[..., :3]
    alpha = arr[..., 3]

    # Depth = mean of RGB (grayscale PSD — R, G, B equal)
    depth = rgb.mean(axis=-1)

    opaque = alpha > 16
    if not opaque.any():
        return None

    d = depth[opaque]
    return {
        'left': layer.left, 'top': layer.top,
        'right': layer.right, 'bottom': layer.bottom,
        'w': layer.right - layer.left, 'h': layer.bottom - layer.top,
        'opaque_px': int(opaque.sum()),
        'depth_min': int(d.min()),
        'depth_max': int(d.max()),
        'depth_mean': float(d.mean()),
        'depth_median': float(np.median(d)),
        'depth_std': float(d.std()),
        # Check R/G/B equality — should be grayscale
        'is_grayscale': bool(np.all(rgb[..., 0] == rgb[..., 1]) and np.all(rgb[..., 1] == rgb[..., 2])),
    }


def analyze(name: str):
    art_path = ROOT / f"{name}.psd"
    depth_path = ROOT / f"{name}_depth.psd"
    if not depth_path.exists():
        print(f"[{name}] depth PSD missing")
        return None

    art_psd = PSDImage.open(art_path) if art_path.exists() else None
    depth_psd = PSDImage.open(depth_path)

    print(f"\n{'='*70}")
    print(f"  {name.upper()}  —  depth PSD {depth_path.name}")
    print(f"{'='*70}")
    print(f"Canvas: depth {depth_psd.width}×{depth_psd.height}",
          f" art {art_psd.width}×{art_psd.height}" if art_psd else "")
    if art_psd and (depth_psd.width, depth_psd.height) != (art_psd.width, art_psd.height):
        print("  *** CANVAS SIZE MISMATCH ***")

    # Flatten + collect tagged layers
    art_tags = set()
    if art_psd:
        art_flat = []
        for top in art_psd:
            walk(top, art_flat)
        for l in art_flat:
            t = match_tag(l.name or '')
            if t:
                art_tags.add(t)

    depth_flat = []
    for top in depth_psd:
        walk(top, depth_flat)

    print(f"Depth PSD layers: {len(depth_flat)} total")

    # Tag match analysis
    depth_tag_map = {}
    for l in depth_flat:
        t = match_tag(l.name or '')
        if t:
            depth_tag_map[t] = l

    print(f"Tagged in depth: {len(depth_tag_map)}")
    if art_psd:
        only_in_art = art_tags - set(depth_tag_map.keys())
        only_in_depth = set(depth_tag_map.keys()) - art_tags
        print(f"Tags in art only: {sorted(only_in_art) if only_in_art else '—'}")
        print(f"Tags in depth only: {sorted(only_in_depth) if only_in_depth else '—'}")

    # Per-layer depth stats (sorted by mean depth ascending)
    print(f"\n{'tag':<16s} {'w×h':<14s} {'opaque':>9s}  {'depth min..max':<14s} {'mean':>7s} {'med':>6s} {'std':>6s}  gray?")
    print('-' * 85)

    stats_rows = []
    for tag, layer in depth_tag_map.items():
        s = layer_depth_stats(layer, depth_psd.width, depth_psd.height)
        if s is None:
            stats_rows.append((999, tag, None))
            continue
        stats_rows.append((s['depth_mean'], tag, s))

    # Sort by mean depth ascending (smallest first)
    stats_rows.sort()
    for _, tag, s in stats_rows:
        if s is None:
            print(f"{tag:<16s} (empty/no alpha)")
            continue
        print(f"{tag:<16s} "
              f"{s['w']:>5d}×{s['h']:<6d}  "
              f"{s['opaque_px']:>9d}  "
              f"{s['depth_min']:>3d}..{s['depth_max']:<3d}       "
              f"{s['depth_mean']:>7.1f} "
              f"{s['depth_median']:>6.0f} "
              f"{s['depth_std']:>6.1f}  "
              f"{'yes' if s['is_grayscale'] else 'NO'}")

    return stats_rows


def main():
    results = {}
    for name in ('waifu', 'shelby', 'girl'):
        depth_path = ROOT / f"{name}_depth.psd"
        if depth_path.exists():
            results[name] = analyze(name)
        else:
            print(f"\n[{name}] depth PSD missing — skip")

    # Cross-character comparison: convention check.
    # 'front hair' and 'face' should be relatively NEAR (low depth if black=near)
    # 'back hair', 'legwear', 'footwear' should be FAR
    print(f"\n{'='*70}")
    print("  CONVENTION CHECK — mean depth by role")
    print(f"{'='*70}")
    near_candidates = ['front hair', 'face', 'nose', 'eyewhite-l', 'eyewhite-r']
    far_candidates = ['back hair', 'legwear', 'legwear-l', 'legwear-r',
                      'footwear', 'footwear-l', 'footwear-r', 'tail']
    for name, rows in results.items():
        if rows is None: continue
        tag_means = {t: s['depth_mean'] for _, t, s in rows if s}
        near = [tag_means[t] for t in near_candidates if t in tag_means]
        far  = [tag_means[t] for t in far_candidates  if t in tag_means]
        near_avg = sum(near) / len(near) if near else None
        far_avg  = sum(far)  / len(far)  if far  else None
        verdict = ''
        if near_avg is not None and far_avg is not None:
            if near_avg < far_avg:
                verdict = 'BLACK=NEAR (low depth values = near viewer)'
            else:
                verdict = 'WHITE=NEAR (high depth values = near viewer)'
        print(f"  {name:<8s} near_avg={near_avg}  far_avg={far_avg}   -> {verdict}")


if __name__ == '__main__':
    main()
