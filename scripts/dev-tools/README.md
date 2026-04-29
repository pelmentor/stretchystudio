# Python dev tools

Small reverse-engineering / forensic utilities used during the Live2D
export work and the SOTA depth-PSD analysis. Each script is
single-purpose, runnable directly with `python <script>`, and prints
to stdout.

These are **dev tools**, not part of the runtime. Nothing in the app
imports them; they exist to inspect reference `.moc3` files exported
from Cubism Editor (or anywhere else) and to validate the depth-PSD
format that the SOTA pipeline expects.

## Install

The scripts use only the Python standard library plus `Pillow` for
the depth-PSD analyzer. No `requirements.txt` because of how small
the surface is — install on demand:

```bash
# moc3 inspectors only
python --version    # 3.8+ recommended

# depth-PSD analyzer also needs Pillow + psd-tools
pip install Pillow psd-tools
```

## Scripts

### `moc3_inspect.py <path.moc3> [section_filter]`

Decode a `.moc3` binary and dump every section with offsets, sizes,
and sample data. Optionally filter sections by substring.

Use this when byte-diffing two moc3 files (Cubism Editor export vs.
Stretchy Studio export) to find which fields disagree.

```bash
python scripts/dev-tools/moc3_inspect.py path/to/model.moc3
python scripts/dev-tools/moc3_inspect.py path/to/model.moc3 warp_deformer
```

### `moc3_inspect_mesh.py <path.moc3>`

Dump every art-mesh's keyform positions + sample vertices. Useful
for verifying mesh vertex layouts after a refactor of the mesh
writer.

### `moc3_inspect_rot.py <path.moc3>`

Dump rotation-deformer keyforms (per-keyform angle + scale). Used
to validate the rotation-deformer keyform plan that
`moc3writer.js` emits.

### `moc3_inspect_warp.py <path.moc3>`

Dump every warp-deformer's keyform grid as raw position arrays.
Useful for spotting collapsed / NaN warp keyforms after a rig
refactor.

### `analyze_depth_psd.py <character>`

For SOTA depth-PSDs (`{character}_depth.psd`): list every layer,
verify it matches the structure of `{character}.psd`, extract
grayscale + alpha, and report depth conventions
(black-near vs. white-near) by comparing known front / back layers.

Used during the depth-PSD pipeline bring-up to confirm the
convention before wiring it to Live2D Z-order.

### `verify_body_analyzer.py`

Sanity-check the body analyzer's output against a known-good
reference. Reads the analyzer's JSON output and prints any
keypoint that has drifted more than the per-joint tolerance.

Used as a regression check before refactoring the body analyzer.

## Style

These are intentionally small and procedural — no abstractions, no
test harness, no CLI framework. Each one is meant to be read in
under a minute and modified inline when the moc3 / PSD format
changes. If a script grows past ~200 lines, split it before
reaching for classes.
