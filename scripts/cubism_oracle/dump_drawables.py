"""
Cubism oracle harness — emits ground-truth post-eval vertex positions for a
given (.moc3, parameter dict) pair.

Used by the warp-evaluator port (CUBISM_WARP_PORT.md). The output JSON is the
canonical pass criterion for every phase: v3's in-app eval must match these
vertex positions within ~0.01 px.

Usage:

    # Dump default-pose snapshot (all parameters at default)
    python dump_drawables.py "D:\\Projects\\Programming\\stretchystudio\\New Folder_cubism\\shelby.moc3"

    # Dump with a parameter override (one value)
    python dump_drawables.py shelby.moc3 --set ParamBodyAngleX=10

    # Dump all rows of the diagnostic param table to a directory
    python dump_drawables.py shelby.moc3 --fixture diagnostic_params.json --out snapshots/

    # Inspect what the moc declares (params, parts, drawables)
    python dump_drawables.py shelby.moc3 --inspect
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from cubism_core import CubismModel, core_version_string, load_dll


def parse_set_args(set_args: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for spec in set_args:
        if "=" not in spec:
            raise SystemExit(f"--set expects NAME=VALUE, got {spec!r}")
        name, value = spec.split("=", 1)
        out[name.strip()] = float(value)
    return out


def snapshot(model: CubismModel, params: dict[str, float] | None = None) -> dict:
    """Apply param dict, run csmUpdateModel, return per-drawable vertex snapshot."""
    model.reset_parameters_to_defaults()
    applied: dict[str, float] = {}
    skipped: list[str] = []
    if params:
        for name, value in params.items():
            try:
                model.set_parameter(name, value)
                applied[name] = value
            except KeyError:
                skipped.append(name)

    model.update()

    counts = model.drawable_vertex_counts()
    positions = model.drawable_vertex_positions()
    drawables = []
    for i, drawable_id in enumerate(model.drawable_ids):
        verts = positions[i]
        flat = [c for xy in verts for c in xy]
        drawables.append(
            {
                "index": i,
                "id": drawable_id,
                "vertex_count": counts[i],
                "vertices": flat,
            }
        )

    return {
        "applied_parameters": applied,
        "skipped_parameters": skipped,
        "canvas_info": model.canvas_info(),
        "drawable_count": model.drawable_count,
        "drawables": drawables,
    }


def inspect(model: CubismModel) -> dict:
    minmax = model.parameter_min_max()
    defaults = model.parameter_default_values()
    return {
        "parameter_count": model.parameter_count,
        "parameters": [
            {"id": pid, "min": mn, "max": mx, "default": dv}
            for pid, (mn, mx), dv in zip(model.parameter_ids, minmax, defaults)
        ],
        "part_count": model.part_count,
        "parts": model.part_ids,
        "drawable_count": model.drawable_count,
        "drawables": [
            {"index": i, "id": did, "vertex_count": vc}
            for i, (did, vc) in enumerate(
                zip(model.drawable_ids, model.drawable_vertex_counts())
            )
        ],
        "canvas_info": model.canvas_info(),
    }


def fixture_filename(name: str, params: dict[str, float]) -> str:
    if not params:
        return f"{name}__default.json"
    parts = [f"{k}={v:g}" for k, v in sorted(params.items())]
    suffix = "__".join(parts)
    if len(suffix) > 60:
        digest = hashlib.sha1(suffix.encode()).hexdigest()[:10]
        suffix = digest
    return f"{name}__{suffix}.json"


def main() -> int:
    ap = argparse.ArgumentParser(description="Cubism oracle: dump post-eval vertex positions.")
    ap.add_argument("moc", help="Path to .moc3 file")
    ap.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="NAME=VAL",
        help="Override one parameter (repeatable).",
    )
    ap.add_argument(
        "--fixture",
        type=Path,
        default=None,
        help='JSON fixture file: list of {"name": str, "params": {ParamX: 1.0, ...}}',
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output dir (for --fixture) or output file (for --set / default snapshot).",
    )
    ap.add_argument(
        "--inspect",
        action="store_true",
        help="Print param/part/drawable inventory instead of vertex snapshot.",
    )
    ap.add_argument(
        "--dll",
        type=Path,
        default=None,
        help="Path to Live2DCubismCore.dll (overrides default + LIVE2D_CUBISM_CORE).",
    )
    ap.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = ap.parse_args()

    dll = load_dll(args.dll)
    moc_path = Path(args.moc)
    print(
        f"[cubism_oracle] Core {core_version_string(dll)}  Moc: {moc_path}",
        file=sys.stderr,
    )

    model = CubismModel.from_file(dll, moc_path)
    print(
        f"[cubism_oracle] params={model.parameter_count} "
        f"parts={model.part_count} drawables={model.drawable_count}",
        file=sys.stderr,
    )

    indent = 2 if args.pretty else None

    if args.inspect:
        out = json.dumps(inspect(model), indent=indent, ensure_ascii=False)
        if args.out:
            Path(args.out).write_text(out, encoding="utf-8")
            print(f"[cubism_oracle] inventory → {args.out}", file=sys.stderr)
        else:
            print(out)
        return 0

    if args.fixture:
        fixtures = json.loads(args.fixture.read_text(encoding="utf-8"))
        out_dir = args.out or Path("snapshots")
        out_dir.mkdir(parents=True, exist_ok=True)
        for entry in fixtures:
            name = entry["name"]
            params = entry.get("params", {})
            snap = snapshot(model, params)
            snap["fixture_name"] = name
            outfile = out_dir / fixture_filename(name, params)
            outfile.write_text(
                json.dumps(snap, indent=indent, ensure_ascii=False), encoding="utf-8"
            )
            print(
                f"[cubism_oracle] {name:<30} applied={len(snap['applied_parameters'])} "
                f"skipped={len(snap['skipped_parameters'])} → {outfile.name}",
                file=sys.stderr,
            )
        return 0

    params = parse_set_args(args.set)
    snap = snapshot(model, params)
    text = json.dumps(snap, indent=indent, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"[cubism_oracle] snapshot → {args.out}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
