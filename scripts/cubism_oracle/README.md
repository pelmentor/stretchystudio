# Cubism Oracle Harness

Numeric ground truth for the Cubism warp-evaluator port.
See [CUBISM_WARP_PORT.md](../../docs/live2d-export/CUBISM_WARP_PORT.md)
for the project context.

This is the canonical pass criterion for every phase of the port:
v3's in-app evaluator must match the post-eval drawable vertex
positions produced here, within ~0.01 px per vertex.

## What it does

Loads a `.moc3` file into the official Live2D Cubism Core 5.0
runtime DLL via Python `ctypes`, drives parameters from a fixture
table, and dumps `csmGetDrawableVertexPositions` per drawable to JSON.

No npm install. No browser. No JVM. Pure stdlib Python + the public
`Live2DCubismCore.dll` C ABI.

## Setup

1. Locate `Live2DCubismCore.dll` (Cubism Core 5.x or compatible).
   The default path points at the copy bundled with Ren'Py 8.5 SDK
   (`D:\renpy-8.5.0-sdk\lib\py3-windows-x86_64\Live2DCubismCore.dll`).
   Override with the `LIVE2D_CUBISM_CORE` env var or the `--dll`
   flag if you have the public Cubism Native SDK installed elsewhere.

2. Verify with the inspect command:

       python scripts/cubism_oracle/dump_drawables.py "PATH/TO/some.moc3" --inspect

   Should print the parameter, part, and drawable inventory.

## Common operations

Dump vertex positions at default-pose parameters:

    python scripts/cubism_oracle/dump_drawables.py "New Folder_cubism/shelby.moc3"

Dump with one or more parameter overrides:

    python scripts/cubism_oracle/dump_drawables.py shelby.moc3 \
        --set ParamBodyAngleX=10 --set ParamAngleZ=15

Generate the diagnostic-params baseline (one snapshot per row of the
table in CUBISM_WARP_PORT.md → Verification setup):

    python scripts/cubism_oracle/dump_drawables.py shelby.moc3 \
        --fixture scripts/cubism_oracle/diagnostic_params.json \
        --out scripts/cubism_oracle/snapshots/<character>/

Pretty-print:

    python ... --pretty

## Output format

Each snapshot is JSON with shape:

```jsonc
{
  "applied_parameters": { "ParamBodyAngleX": 10.0 },
  "skipped_parameters": [],
  "canvas_info": {
    "size": [1792.0, 1792.0],
    "origin": [896.0, 896.0],
    "pixels_per_unit": 1792.0
  },
  "drawable_count": 20,
  "drawables": [
    {
      "index": 0,
      "id": "ArtMesh0",
      "vertex_count": 12,
      "vertices": [x0, y0, x1, y1, ...]   // interleaved canvas-px floats
    }
  ]
}
```

Vertex positions are post-`csmUpdateModel` final canvas-space coordinates.
Coordinate units are normalized canvas (range ~`[-1, 1]` mapping to canvas
width/height, scaled by `pixels_per_unit`). To convert to absolute pixels
multiply by `pixels_per_unit`.

## Files in this directory

| File | Purpose |
|------|---------|
| `cubism_core.py` | `ctypes` bindings for `Live2DCubismCore.dll` (39 `csm*` exports + lifecycle helpers) |
| `dump_drawables.py` | Main CLI harness — inspect, single-snapshot, fixture-batch modes |
| `diagnostic_params.json` | 21-row fixture mirroring the diagnostic param table in CUBISM_WARP_PORT.md |
| `snapshots/<character>/` | Pinned baseline JSONs per fixture entry — one per `(character, param-tuple)` |

## What the snapshots are for

These JSONs are the regression net for the port. Phase 1+ will:

1. Load v3's `rigSpec` for the same character
2. Set `paramValues` to match each fixture entry's `applied_parameters`
3. Run v3's in-app evaluator on the rig
4. For each drawable, compute `max |v3.vertex[i] - oracle.vertex[i]|`
5. Assert `max ≤ 0.01 px` (rough float32 noise floor, refined per phase)

When the diff is below threshold across every diagnostic snapshot,
the port is correct for that param's eval path.

## Snapshot validation done in Phase 0

Both `New Folder_cubism/shelby.moc3` (Editor's own export) and
`New Folder/shelby.moc3` (our v3 exporter's output) load successfully
and produce non-zero, plausible per-vertex deltas across the
diagnostic param table. This confirms:

- Oracle harness itself is correct (matches Cubism's expected behavior on a known-good moc3)
- Our v3 exporter is at byte-parity at the load level — any later divergence is in eval, not in moc3 emission
