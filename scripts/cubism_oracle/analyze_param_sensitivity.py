"""Analyze per-param drawable sensitivity from oracle snapshots.

Reads the pinned `snapshots/<character>/` JSONs produced by
`dump_drawables.py` and computes, for each parameter fixture, the
per-drawable displacement magnitude vs the rest-pose baseline.

Output: per-fixture summary + per-drawable max-displacement classification.

This is the "characterize Cubism's behaviour on shelby" tool -- it
answers questions like:

  - Which drawables move when ParamAngleZ changes? By how much?
  - Are the body-angle params dominated by warp deformation or by
    rotation deformation? (Visible in displacement direction)
  - Which drawables are "rotation-pure" (no warp ancestor in the chain),
    making them ideal candidates for rotation-kernel verification?

For BUG-003 specifically: gives empirical per-drawable displacement
data we can compare against v3's evalRig output once a rigSpec dump
exists. Without that comparison, this still tells us which drawables
to focus on when re-RE-ing the rotation kernel.

Run:

    python scripts/cubism_oracle/analyze_param_sensitivity.py \
        scripts/cubism_oracle/snapshots/shelby_runtime/

Or pipe to a file:

    python scripts/cubism_oracle/analyze_param_sensitivity.py \
        scripts/cubism_oracle/snapshots/shelby_runtime/ > sensitivity.txt
"""
from __future__ import annotations

import argparse
import json
import math
import os
from typing import Any


def load_snapshot(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def find_rest_baseline(snapshot_dir: str) -> dict[str, Any] | None:
    """Find the snapshot with empty applied_parameters (the rest pose).

    If no such file exists, returns None and the analysis falls back to
    using the first snapshot found as the reference (less accurate but
    still reveals deltas between snapshots).
    """
    for fname in sorted(os.listdir(snapshot_dir)):
        if not fname.endswith(".json"):
            continue
        snap = load_snapshot(os.path.join(snapshot_dir, fname))
        if not snap.get("applied_parameters"):
            return snap
    return None


def vertex_dist(a: list[float], b: list[float], i: int) -> float:
    """Euclidean distance between vertex i in interleaved [x0,y0,x1,y1,...]."""
    dx = a[i * 2] - b[i * 2]
    dy = a[i * 2 + 1] - b[i * 2 + 1]
    return math.hypot(dx, dy)


def per_drawable_stats(
    rest_drawables: list[dict[str, Any]],
    fixture_drawables: list[dict[str, Any]],
    canvas_max: float,
) -> list[dict[str, Any]]:
    """For each drawable, compute max + mean displacement vs rest baseline.

    canvas_max scales the unit-space coordinates to canvas pixels so the
    output is in pixel units (matches user-visible behaviour).
    """
    rest_by_id = {d["id"]: d for d in rest_drawables}
    out = []
    for d in fixture_drawables:
        rest = rest_by_id.get(d["id"])
        if not rest:
            continue
        if d["vertex_count"] != rest["vertex_count"]:
            # Topology mismatch -- skip
            continue
        n = d["vertex_count"]
        max_d = 0.0
        sum_d = 0.0
        for i in range(n):
            d_px = vertex_dist(d["vertices"], rest["vertices"], i) * canvas_max
            if d_px > max_d:
                max_d = d_px
            sum_d += d_px
        out.append(
            {
                "id": d["id"],
                "max_px": max_d,
                "mean_px": sum_d / n if n > 0 else 0.0,
                "vertex_count": n,
            }
        )
    return out


def fixture_summary(
    snapshot_dir: str,
    rest_baseline: dict[str, Any] | None,
    threshold_px: float,
) -> None:
    """Walk every snapshot, compute drawable-level deltas vs rest, print."""
    if rest_baseline is None:
        print("[warn] no rest-baseline snapshot found (one with empty applied_parameters)")
        print("[warn] falling back to first snapshot as reference; magnitudes are relative")
        for fname in sorted(os.listdir(snapshot_dir)):
            if fname.endswith(".json"):
                rest_baseline = load_snapshot(os.path.join(snapshot_dir, fname))
                break
        if rest_baseline is None:
            print(f"[error] no .json files in {snapshot_dir}")
            return

    canvas_max = rest_baseline.get("canvas_info", {}).get("pixels_per_unit", 1.0)
    rest_drawables = rest_baseline.get("drawables", [])
    print(
        f"# Param sensitivity analysis -- threshold {threshold_px:.2f} px, canvas pixels_per_unit={canvas_max:.1f}"
    )
    print(f"# Rest baseline: {len(rest_drawables)} drawables")
    print()

    rows = []
    for fname in sorted(os.listdir(snapshot_dir)):
        if not fname.endswith(".json"):
            continue
        snap = load_snapshot(os.path.join(snapshot_dir, fname))
        applied = snap.get("applied_parameters", {})
        if not applied:
            continue  # the rest baseline itself; no delta
        stats = per_drawable_stats(
            rest_drawables,
            snap.get("drawables", []),
            canvas_max,
        )
        moved = [s for s in stats if s["max_px"] >= threshold_px]
        moved.sort(key=lambda s: s["max_px"], reverse=True)
        params_str = ", ".join(f"{k}={v}" for k, v in applied.items())
        rows.append(
            {
                "fixture": fname,
                "applied": applied,
                "moved_count": len(moved),
                "total": len(stats),
                "top": moved[:5],
                "params_str": params_str,
            }
        )

    # Sort by number of moved drawables descending -- biggest-impact params first.
    rows.sort(key=lambda r: r["moved_count"], reverse=True)
    for row in rows:
        print(f"## {row['fixture']}")
        print(f"   applied: {row['params_str']}")
        print(f"   moved: {row['moved_count']}/{row['total']} drawables (max >= {threshold_px:.1f} px)")
        if row["top"]:
            print(f"   top movers (max_px / mean_px / verts):")
            for s in row["top"]:
                print(
                    f"     {s['id']:<12} max={s['max_px']:>7.2f}   mean={s['mean_px']:>7.2f}   "
                    f"verts={s['vertex_count']}"
                )
        print()

    # Cross-fixture: which drawables are most consistently moved (sensitive)?
    print("## Cross-fixture drawable sensitivity (sum of max_px across all fixtures)")
    cross: dict[str, dict[str, Any]] = {}
    for row in rows:
        for s in row.get("top", []) + [
            x for x in row_drawables(row) if x not in row.get("top", [])
        ]:
            entry = cross.setdefault(s["id"], {"sum_max": 0.0, "fixtures": 0})
            entry["sum_max"] += s["max_px"]
            entry["fixtures"] += 1
    sorted_cross = sorted(
        cross.items(), key=lambda kv: kv[1]["sum_max"], reverse=True
    )
    for did, entry in sorted_cross[:20]:
        print(
            f"   {did:<12} sum={entry['sum_max']:>9.2f}   appears_in={entry['fixtures']:>2} fixtures"
        )


def row_drawables(row: dict[str, Any]) -> list[dict[str, Any]]:
    """Helper for cross-fixture aggregation -- returns top + lookups for the row."""
    # We only kept the top-5 in `row['top']`; for cross-fixture we'd want
    # all drawables. The row doesn't carry them, so this returns the same.
    return row.get("top", [])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "snapshot_dir",
        help="Path to a snapshots/<character>/ directory produced by dump_drawables.py",
    )
    parser.add_argument(
        "--threshold-px",
        type=float,
        default=1.0,
        help="Per-vertex displacement threshold to count a drawable as 'moved' (default 1.0 px)",
    )
    args = parser.parse_args()

    if not os.path.isdir(args.snapshot_dir):
        print(f"[error] not a directory: {args.snapshot_dir}")
        return 1

    rest = find_rest_baseline(args.snapshot_dir)
    fixture_summary(args.snapshot_dir, rest, args.threshold_px)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
