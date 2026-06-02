# Session aggregate — 2026-06-02 round-4

Fourth Workflow audit + autonomous fix sweep. 9 commits (excluding tracking + close-out), **22 / 24 confirmed findings shipped end-to-end**. Tracking: [AUDIT_2026_06_02_R4_SUBSTRATE.md](AUDIT_2026_06_02_R4_SUBSTRATE.md).

## Workflow

`wf_42f51bc7-f49` — 205 agents, ~10M tokens, 33 min. 66 raw → **24 confirmed / 42 refuted** (64% pruning — strictest round, critic was tough on byte-fidelity claims).

Six dimensions: moc3+cmo3 byte writers, Cubism runtime kernels, animation editor surfaces, mesh-edit kernels, bone skinning + constraints, migration chain + keymap dispatcher.

## Commits chronology

| # | Commit | Author | Items | Net |
|---|--------|--------|-------|-----|
| 1 | `509ce66` | Claude | tracking doc | +72 |
| 2 | `19798a6` | pelmentor | WRT-1 + WRT-2 — integer + XML NaN guards | +38 -4 |
| 3 | `79b5bdc` | Claude | v18 cascade A-1/-2/-4/-5 + B-2 | +50 -10 |
| 4 | `d803df4` | pelmentor | CUBISM-PORT-004 — rotation keyform renorm | +19 |
| 5 | `8958142` | Claude | ANIM-1..-5/-11 — selection prune + frame guards + NLA gate + clipboard | +100 -12 |
| 6 | `587a5f1` | pelmentor | MESH-002/-010/-011 — sculpt rest + typed uvs + denorm floor | +26 -4 |
| 7 | `f1eab4a` | Claude | B-1 + B-3 — keymap reportOpFailure + dopesheet stopPropagation | +14 -3 |
| 8 | `5aedfd9` | pelmentor | F1-rotation-units — constraints in degrees end-to-end | +34 -17 |
| 9 | `3ed2e92` | Claude | CUBISM-PORT-007/-008 — alloc hoist + sign-based corner mapping | +51 -29 |

**Net:** ~+400 LOC substantive fixes / new guards, ~−80 LOC of dead silent-failure patterns retired.

## Architectural shifts

1. **NaN guards close across integer + XML writer buckets.** R2 F6 closed `writeF32`; this round closes `writeI32/I16/U8/U32` (silently coerced NaN to 0 via ToInt32) and `XmlBuilder._nodeToXml` (`String(NaN)` produced literal `"NaN"` in cmo3 attributes that Cubism Editor rejected silently). Per RULE-№1: throw at the bad-emitter site instead of corrupting the export.

2. **v18 silent-noop cascade closed.** v18 split `part` nodes into `part` + `{type:'meshData'}` pairs and deleted `node.mesh`. Five callers never updated their `node.mesh.*` reads — `persistArtMeshRuntime` (silent no-op writing artmesh runtime), `groupRotationToBone` (v44 skip), `v47_runtime_parent_strip` (no-op strip), `saveProject` (Float32Array meshData uvs serialised as `{"0":...}`), `selection.selectAllToggle` (KeyA was always 0 vert-count). All five now route through `getMesh(node, project)`.

3. **Animation editor lifecycle correctness.** TimelineEditor selectedKeyframes / DopesheetEditor keyformSelectionStore handles now prune on action switch; `animationStore.setStartFrame` rejects non-finite + clamps to `[0, endFrame-1]`; clipboard captures `sourceActionId` and `pasteKeyframes` refuses with toast on mismatch; NLAEditor's strip-context Edit Action gates on PROTECTED + tweakStripId; Timeline keymap gates on `isContentEditable` + active range selection.

4. **Sculpt strokes survive pose evaluation in Edit Mode.** Sculpt brush apply layer mirrors `x→restX, y→restY` when `editorRef.current.editMode === 'edit'`. Pre-fix the rest position stayed stale, so any param change immediately re-skinned the original rest and silently undid the stroke visually.

5. **Constraint kernel operates in degrees.** `wrapPi → wraps to (-180, 180]` via `FULL_TURN_DEG = 360`; `evalTrackTo` multiplies `Math.atan2` output by 180/π before wrap. Pre-fix constraint output exited in radians and the renderer's `makeLocalMatrix` deg→rad applied PI/180 again — every constraint-driven owner rotated by ~3.14/360 of intended angle.

6. **Cubism warp / rotation hot-loop allocations reduced.** `evalChainAtPoint` Float32Array scratch buffers hoisted to module scope (single-threaded per tick → safe). Warp evaluator's corner-zone OOB branch replaced 4-entry array + 4 find() scans with direct sign-based TL/TR/BL/BR dispatch.

7. **Keymap dispatcher surfaces operator failures.** `dispatcher.js` catch now routes through `reportOpFailure('keymap', err, {opId})` (R1 substrate). Mirror of the R1 menu-invoker fix — closes the sister silent-failure surface. Plus DopesheetEditor's G/Delete/Shift+D handlers now `stopPropagation` so the global dispatcher doesn't ALSO fire transform.translate / selection.delete / edit.duplicate.

## Deferred (2)

- **CUBISM-PORT-001** mask stencil overlap — needs bit-packed channel masking shader (matches `CubismClippingManager_WebGL`).
- **F9-copy-rotation-wrap** — drop wrapPi from evalCopyRotation to preserve unwrapped value across frames. Touches drivers, fcurve interp, motion3 diff export; needs broader unwrap policy.

## RULE-№5 alternation

Strictly maintained Claude ↔ pelmentor across all 9 substantive commits (+ 2 doc commits).

## Open work for next session

Critic-flagged untouched categories (round-5 candidates):
1. **PSD ingestion pipeline + worker pool** — psd.js, psdFinalize.js, psdOrganizer.js, psd.worker.js
2. **can3 + JSON sibling writers** — can3writer.js, can3/, model3json.js (partial coverage from R3)
3. **caffPacker + caffUnpacker** — XML escape, zip-entry encoding, round-trip drift
4. **cmo3 import synthesis** — rigWarpSynth, rotationDeformerSynth, buildRigSpecFromCmo3
5. **Service layer** — RigService, PoseService, ImportService, ExportService, ArmatureModifierService, PsdImportService, projectLibrary, dwposeService

Plus blocked-on-user items: bug-03 Shelby handwear (needs Init Rig re-run), bug-01 BUG-015 BodyAngle (needs drag-repro).

## Resume hint for next Claude

Last commit Claude `3ed2e92` → next must be pelmentor (close-out).

Options ranked by ROI:
1. Round-5 over service-layer + cmo3 import synthesis + PSD pipeline (largest untouched substrate).
2. Pick one DEFERRED item (CUBISM-PORT-001 or F9 — each session-scale).
3. Wait for user Init Rig re-run on bug-03.
