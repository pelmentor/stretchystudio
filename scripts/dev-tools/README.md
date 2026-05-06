# Dev tools

Reverse-engineering / forensic / smoke-test utilities for the Live2D export pipeline. Each script is single-purpose, runnable directly with `python` or `node`, and prints to stdout.

These are **not part of the runtime.** Nothing the app ships imports them. They exist to (a) byte-diff `.moc3` and `.cmo3` files against Cubism Editor's reference output during a bug hunt, (b) verify import / synthesis correctness against a real `.cmo3`, and (c) explore unfamiliar Cubism XML/binary structures before writing parser/emitter code.

## Install

Standard library only for the `.mjs` scripts (Node 18+). The Python scripts add `Pillow` + `psd-tools` for the depth-PSD analyzer:

```bash
pip install Pillow psd-tools    # only for analyze_depth_psd.py
```

## Python (.py)

### `moc3_inspect.py <path.moc3> [section_filter]`

Decode a `.moc3` binary and dump every section with offsets, sizes, and sample data. Optionally filter sections by substring. Use this when byte-diffing two moc3 files (Cubism Editor export vs. SS export) to find which fields disagree.

```bash
python scripts/dev-tools/moc3_inspect.py path/to/model.moc3
python scripts/dev-tools/moc3_inspect.py path/to/model.moc3 warp_deformer
```

### `moc3_inspect_mesh.py <path.moc3>`

Dump every art-mesh's keyform positions + sample vertices. Useful for verifying mesh vertex layouts after a refactor of the mesh writer.

### `moc3_inspect_rot.py <path.moc3>`

Dump rotation-deformer keyforms (per-keyform angle + scale). Used to validate the rotation-deformer keyform plan that `moc3writer.js` emits.

### `moc3_inspect_warp.py <path.moc3>`

Dump every warp-deformer's keyform grid as raw position arrays. Useful for spotting collapsed / NaN warp keyforms after a rig refactor.

### `analyze_depth_psd.py <character>`

For SOTA depth-PSDs (`{character}_depth.psd`): list every layer, verify it matches the structure of `{character}.psd`, extract grayscale + alpha, and report depth conventions (black-near vs. white-near) by comparing known front / back layers. Used during the depth-PSD pipeline bring-up to confirm the convention before wiring it to Live2D Z-order.

### `verify_body_analyzer.py`

Sanity-check the body analyzer's output against a known-good reference. Reads the analyzer's JSON output and prints any keypoint that has drifted more than the per-joint tolerance. Used as a regression check before refactoring the body analyzer.

## Node (.mjs) — verify_*

End-to-end correctness checks of the `.cmo3` import + rig synthesis pipeline. Each one constructs (or reads) a project, runs the relevant module, and asserts on the result. Most accept a `.cmo3` path as the first arg and default to `shelby.cmo3`.

| Script | What it asserts |
|---|---|
| `verify_arm_cascade.mjs` | Arm sway physics: handwear has no `ParamArmSwayX`, `ParamRotation_leftElbow` exists, topwear rigWarp emits 9 keyforms (Shirt + Bust × 3 angles), `PhysicsSetting_ArmSnake` fires |
| `verify_cmo3_import.mjs` | `.cmo3` → SS project synthesiser produces a project with the expected shape (browser API polyfills included so this runs headless) |
| `verify_cmo3_unpack.mjs` | `caffUnpacker.js` + `cmo3Inspect.js` agree on metadata for a real `.cmo3`; diff against a known-good reference when adjusting either module |
| `verify_full_import_to_rigspec.mjs` | End-to-end: import `.cmo3` → run `initializeRigFromProject` → assert rigSpec contains structural warps, rotation deformers, art meshes wired correctly |
| `verify_mask_import.mjs` | sweep #17 maskConfigs synthesis from cmo3 `clipGuidList` |
| `verify_param_groups.mjs` | Parameter group tree + Random Pose group list match Hiyori's layout (root + N sub-groups, params reference sub-group as parent, not root) |
| `verify_physics.mjs` | Session 29 physics emission: direct XML fragment matches Hiyori's structure + full `generateCmo3` integration smoke |
| `verify_rotation_import.mjs` | sweep #15 rotation-deformer → group synthesis (boneRole assigned, pivot populated) |
| `verify_variant_import.mjs` | sweep #18 variant pairing (base + `.suffix` siblings recognized, `Param<Suffix>` registered) |
| `verify_warp_parents.mjs` | sweep #16 chain walk: face region rigWarps parent to FaceParallaxWarp, neck to NeckWarp, others to BodyXWarp |

## Node (.mjs) — debug_*

Print what the import path *currently produces* at intermediate stages — used while a bug is fresh, to find where a downstream symptom first appears.

| Script | What it dumps |
|---|---|
| `debug_rigwarp_link.mjs` | Per-part rigWarp linkage as resolved by `cmo3PartExtract` |
| `debug_rotation_pivots.mjs` | Rotation-deformer pivot positions as parsed from the cmo3 |
| `debug_warp_chain.mjs` | All warp deformers + their parent chain, ordered root→leaf |

## Node (.mjs) — dump_*

Print the first occurrence of a specific Cubism XML construct from a `.cmo3` so we can understand its encoding before writing parser/emitter code. Read-only.

| Script | What it dumps |
|---|---|
| `dump_artmesh_sample.mjs` | First `CArtMeshSource` (vertices / triangles / UVs / texture refs encoding) |
| `dump_hiyori_xml.mjs` | Full Hiyori `main.xml` from the bundled reference cmo3 |
| `dump_texture_sample.mjs` | First `CTextureInput_ModelImage` + `CModelImage` (texture path wiring) |

## Node (.mjs) — inspect_*

Decode and grep specific subsystems of an existing `.cmo3`.

| Script | What it does |
|---|---|
| `inspect_cmo3.mjs <path> [pattern]` | Generic CAFF reader: unpacks `main.xml`, optionally greps for a pattern. The go-to tool for "what did the export actually emit?" |
| `inspect_draw_order.mjs` | Walk Hiyori's `drawableSourceSet` and print `drawOrder` per part (no path arg — bound to the bundled reference) |
| `inspect_shelby_order.mjs <path>` | Decode `shelby_smile.cmo3` (or arg) and print part / draw-order summary |
| `inspect_v14_xml.mjs` | Generate a fresh `cmo3` and verify the v14 end-of-`CModelSource` block has all required fields in the right order |

## Node (.mjs) — order audits

Drop-in scripts for specific structural questions about a single reference cmo3.

| Script | Question it answers |
|---|---|
| `check_variant_order.mjs <cmo3>` | Is `face.smile` positioned correctly relative to `face` in the `_sources` array? |
| `hiyori_parts_order.mjs` | Walk Hiyori's `CPartSource` blocks and print parts in declaration order with their GUIDs |
| `shelby_head_order.mjs [path]` | Decode `shelby_smile.cmo3` and list the head part's `_childGuids` in order with mesh names |

## Style

These are intentionally small and procedural — no abstractions, no test harness, no CLI framework. Each one is meant to be read in under a minute and modified inline when the moc3 / cmo3 / PSD format changes. If a script grows past ~200 lines, split it before reaching for classes.

Common Node-side polyfill: most `verify_*` / `debug_*` scripts that import the cmo3 import path stub `URL.createObjectURL` — the import service uses it to mint texture refs, which Node 18+ doesn't ship by default. Copy the polyfill from `verify_cmo3_import.mjs` if you write a new one.
