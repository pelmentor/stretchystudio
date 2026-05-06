# Post-Export Polish Plan

Tracking the issue wave reported 2026-05-06 after the moc3 / wizard / N-panel fix push (commit `3590cc3`). Six items spanning bone-interaction UX, validator triage, and an export-modal redesign.

## Status legend
- ⏳ planned, awaiting greenlight
- 🚧 in progress
- ✅ shipped
- ❌ deferred / blocked

---

## 1. Top-right button cluster overlaps N-panel toggle ⏳

**Symptom.** Layers / Reset Pose chevron group at `top-2 right-2` collides with the N-panel collapsed `<` toggle.

**Root cause.** Commit `3590cc3` moved the toggle to `top-1/2 right-2 -translate-y-1/2`. On short canvases (or when the wizard banner consumes the top), 1/2 puts the toggle close to the top-2 row.

**Fix.** Convert the collapsed N-panel toggle into a slim vertical tab on the very right edge — Blender's actual visual idiom — anchored at `top-1/2` of the canvas pane but with `right-0` (flush) and a thin profile (`w-4 h-12`) so it never enters the same x-band as the Reset Pose group. No overlap regardless of canvas height.

**Files.** `src/v3/shell/ToolSettingsPanel.jsx` only.

**Risk.** ~zero. Pure CSS.

---

## 2. Object Mode lets the user rotate bones via arc handles ⏳

**Symptom.** ModePill says "Object Mode" but the yellow rotation arcs around each bone respond to drag and rotate the rig.

**Root cause.** Inverted gates in `src/components/canvas/SkeletonOverlay.jsx`:
- Line 866 (arc render): `if (!ARC_BONE_ROLES.has(role) || skeletonEditMode) continue;` — skips arcs when in Pose/Armature Edit, renders them in Object Mode.
- Line 309 (arc drag): `if (skeletonEditMode) return;` — bails when in Pose/Armature Edit, fires in Object Mode.

This is a pre-BVR pattern: skeleton-edit was originally a single boolean, and arcs were the "object-mode shortcut" to rotate without entering edit mode. After the BVR Edit/Pose split, this affordance contradicts Blender semantics.

**Fix.** Render arcs and accept arc drag only in **Pose Mode** (`editMode === 'skeleton'`). In Object Mode and Armature Edit, no arcs, no drag. Wizard adjust step also gets no arcs (matches the "joints only, no rotation" intent of that step).

**Files.** `src/components/canvas/SkeletonOverlay.jsx` (two gate flips, ~6 lines).

**Risk.** Low. The pose-write fallback to `node.transform.rotation` (no-driver-param case) is untouched, just gated on editMode.

---

## 3. Apply Pose As Rest needs to live near the ModePill ⏳

**Symptom.** Currently inside the Reset Pose chevron popover (top-right). User expects it next to the Object/Pose Mode pill (top-left), Blender-style.

**Fix.** Add a new pill-styled button right of the ModePill (between ModePill and the proportional-edit toggle that already sits there for Mesh Edit mode). Button visible only when `editMode === 'skeleton'` AND there are non-zero poses on at least one bone group. Reuses the existing handler in `CanvasViewport.jsx:2677`. Remove the entry from the Reset Pose popover (popover stays for future bake ops).

**Files.**
- `src/v3/shell/ModePill.jsx` — add button, plumb the handler.
- `src/components/canvas/CanvasViewport.jsx` — remove "Apply Pose As Rest" row from the popover.

**Risk.** Low. Same store action, different mount point.

---

## 4. Pre-rig "Apply Pose As Rest" leaves layers at PSD position ⏳

**Symptom.** Pre-Init-Rig: pose bones via arc → bones move visually. Click Apply Pose As Rest → bones bake to new rest, but mesh layers (parts) snap back to original PSD position. Post-Init-Rig the layers re-align because the rig binds them.

**Root cause (verified via reading `projectStore.applyPoseAsRest` + canvas hierarchy).** Pre-rig, mesh parts are NOT structurally parented under the rotated bones. Shelby's `topwear` is a single mesh under `torso`, not under `rightArm`. So:
- `worldMatrices[topwear]` doesn't include `rightArm.pose.rotation`.
- The `isIdentity` skip at line 706-710 of `applyPoseAsRest` then bypasses topwear.
- After bake, topwear's mesh verts are unchanged; bones moved; parts didn't.

This is a **structural pre-rig limitation**, not a bug in `applyPoseAsRest`. Per-pixel skinning weights only exist after Init Rig.

**Fix (proposed).** Disable the Apply Pose As Rest button pre-Init-Rig. Show tooltip "Run Init Rig first — pose-to-rest needs skinning weights." Eliminates the misleading partial-bake state.

**Files.** `src/v3/shell/ModePill.jsx` (the new button per #3) — gate on `lastInitRigCompletedAt != null`.

**Risk.** Low.

---

## 5. irides-l/r UV count + no-texture warnings persist ⏳

**Symptom.** Export modal shows `PART_UV_LENGTH` and `PART_NO_TEXTURE` for `irides-l` / `irides-r` (and similar for some other meshes per the validator output).

**Root cause hypothesis.** Two distinct subsystems may emit irides-related output:
- **Auto-rig path** (`perPartRigWarps.emit` for irides-l/r — visible in Init Rig logs).
- **PSD organizer / eye-clipping** that builds the mesh and assigns texture binding.

If irides are extracted from the eyewhite layer (cropped subregion) and given their own meshes via the eye-clipping pipeline, they may be:
1. Generated AFTER atlas packing → no atlas region assigned → `texture_indices = -1` or missing.
2. Generated with vertex count != UV count due to UV remapping over the cropped region.

**Investigation step before a fix.** Open one irides part in the project and verify `mesh.vertices.length` vs `mesh.uvs.length / 2` (or `mesh.triangles`-derived UV count) — and check `part.atlasRegion` or equivalent texture binding field. That tells which of (1) / (2) it is.

**Files (likely).** `src/io/live2d/rig/eyeContexts.js` or eye-clipping path in the rig builder; possibly `src/io/textureAtlas.js` for the no-texture-binding side.

**Risk.** Moderate. Eye pipeline is sensitive (variant eyes shipped recently in Session 36). Will tread carefully.

**Estimated effort.** 1-2 sessions.

---

## 6. Export menu UI/UX refactor ⏳ (PLAN ONLY)

**Current state.** One tall vertical scroll dialog with three sections stacked: format groups (Live2D / Frames / Other), Rig Data Source, validation warnings list. ~700 px tall, 600 px wide. Warnings list eats most vertical space when many parts have validation issues. Format-specific options (atlas size, frame range, output scale) appear inline as the format changes, making vertical layout shift.

**Proposed UX (Blender / Figma idiom).**

```
┌──────────────────────────────────────────────────────────────┐
│  Export                                                  [×] │
├──────────────────────────────┬───────────────────────────────┤
│  Format picker (left rail)   │  Selected format: <name>      │
│  ───────────────────────     │  ───────────────────────────  │
│  ▸ Live2D                    │  Description / hint           │
│    ◯ Runtime (.moc3.zip)     │                               │
│    ◯ Project (.cmo3)         │  Format-specific options:     │
│    ◯ Animations (motion3)    │  • atlas size                 │
│  ▸ Frames / Images           │  • frame range                │
│    ◯ PNG sequence            │  • output scale               │
│    ◯ Single frame            │                               │
│  ▸ Other                     │  Rig data source:             │
│    ◯ Spine 4.0               │  ◉ Project edits              │
│                              │  ◯ Regenerate from PSD        │
│                              │                               │
│                              │  ⚠ Warnings (3)         [▾]   │
│                              │  ┌──────────────────────────┐ │
│                              │  │ irides-l UV mismatch     │ │
│                              │  │ irides-l no texture      │ │
│                              │  │ +1 more (collapsible)    │ │
│                              │  └──────────────────────────┘ │
├──────────────────────────────┴───────────────────────────────┤
│                                       [Cancel]  [Export →]   │
└──────────────────────────────────────────────────────────────┘
```

**Wins.**
- No vertical layout shift — left rail is stable.
- Warnings collapsed by default (expand for triage); first 3 + "more" pattern keeps the dialog short.
- Format-specific options always in the same right-side column, easier to find.
- Group headings (Live2D / Frames / Other) remain visible as the user scans formats.

**Implementation outline (when greenlit).**

1. **Phase 1 — Layout split** (~1 hour). Convert the single-column scroll dialog into a 2-column flex (`w-1/3 left rail`, `w-2/3 right pane`). Keep all existing logic; just rearrange JSX. No new state.
2. **Phase 2 — Warnings collapse** (~30 min). Replace the unbounded warning list with a `Collapsible` (Radix) showing top 3 warnings + a "Show all (N)" expand. Severity sorting: errors first, warnings second.
3. **Phase 3 — Format-specific option groups** (~1-2 hours). Pull the inline conditionals (atlas size for runtime, frame range for sequence, etc.) into a `<FormatOptions format={...}>` component that mounts in the right pane. Each format declares its options table.
4. **Phase 4 — Visual polish** (~30 min). Format icons, better spacing, hint copy.

**Total.** ~3-4 hours. Self-contained — touches only `src/v3/shell/ExportModal.jsx` (≤ 600 LOC currently) and possibly extracts a `<FormatRail>` and `<FormatOptions>` sibling component.

**Doesn't include.** fixing the underlying validation warnings (#5 above) — separate work item.

---

## Suggested ship order

1. **#1, #2, #3, #4** in one commit (~30-60 min) — UI / gate fixes, all related to bone interaction.
2. **#5** in a separate commit (~1-2 sessions) — needs investigation first.
3. **#6** as its own commit when the layout direction is greenlit.

---

## 7. Cubism Viewer rejects model.moc3 ✅ FIXED (pending re-export)

**Symptom.** Re-exported `model_live2d/model.moc3` after the previous `keyform_binding_begin_indices = -1` fix. Cubism Viewer still showed "Unable to load the target file."

### False trail #1 — `kfb_begin = -1` sentinel (REVERTED)

I'd hypothesised that empty-param `kfb_begin = -1` was the rejection cause and "fixed" it with a cumulative cursor. **Wrong.** Reading upstream's `moc3writer.js` line 813-826: upstream uses `-1` sentinel for empty params and ships working models. The `-1` IS the convention. Reverted to upstream pattern.

### False trail #2 — orphan bindings (still kept defensively)

User's Init Rig log showed `droppedOrphanRotations: 2, droppedOrphanParams: 2`, and the broken moc3 had `sum(kfb_counts) = 24` vs `n_bindings = 26` — 2 orphan bindings (paramId not in `params`) in the pool. Added a defensive filter in `internBinding` to drop orphan-param bindings before they enter `uniqueBindings`. Fix kept (cleanup of stale deformer bindings on the project side is a followup).

### **Real root cause — entire band data structure missing from emit**

Comparing the broken model.moc3 against the known-good upstream-exported `New Folder/shelby.moc3`:

| Field | shelby (works) | model (broken) |
|------|------|------|
| keyform_bindings | 27 | 24 |
| **keyform_binding_bands** | **25** | **0** |
| Empty-param kfb_begin | `-1` | `14` (cumulative) |

The current `moc3writer.js` destructures `bandBegins, bandCounts, keyformBindingIndices, bindingKeysBegin, bindingKeysCount, flatKeys` from `buildKeyformBindings()` but **never writes them into `sections`**, and **never sets `counts[KEYFORM_BINDING_BANDS]`**. Upstream sets all of these (see `reference/stretchystudio-upstream-original/src/io/live2d/moc3writer.js:1065`).

Result: every mesh / part / deformer references a band index, but the bands array in the wire data is zero-length. Cubism walks `band[i].begin_indices..begin+count` to find binding indices, hits an empty array, can't resolve any binding → reject.

This was a refactor regression — the moc3writer was split across multiple modules and these section emissions were dropped on the floor. The lesson: when refactoring a writer that produces opaque binary, byte-diff the output against a known-good reference BEFORE shipping the refactor.

### Fix

In `src/io/live2d/moc3writer.js`, after `buildKeyformBindings()`:

```js
sections.set('keyform_binding_band.begin_indices', bandBegins);
sections.set('keyform_binding_band.counts', bandCounts);
sections.set('keyform_binding_index.indices', keyformBindingIndices);
sections.set('keyform_binding.keys_begin_indices', bindingKeysBegin);
sections.set('keyform_binding.keys_counts', bindingKeysCount);
sections.set('keys.values', flatKeys);
counts[COUNT_IDX.KEYFORM_BINDING_BANDS] = bandBegins.length;
```

Plus the orphan-binding filter (defense-in-depth) and reverted `kfb_begin = -1` (matching upstream).

**Files touched.**
- `src/io/live2d/moc3writer.js` — section + count restoration.
- `src/io/live2d/moc3/keyformBindings.js` — orphan filter + revert to `-1` sentinel.

**Status.** Fixed in code. User needs to re-export and re-load in Cubism Viewer to verify.

**Followup (separate work items).**
- Trace where orphan deformer bindings survive the Init Rig prune step (so the export-time filter becomes a no-op).

### Audit pass — other potential refactor regressions

After fixing the band-data gap, ran a systematic check: every section in `SECTION_LAYOUT` (`src/io/live2d/moc3/layout.js`) cross-referenced against actual emit calls (`sections.set(...)` plus `Object.entries` spreads in `uvAndIndices.js`).

Result: the 6 binding/keys sections + 1 count fixed in this pass were the **only** real refactor regressions. Remaining "missing" entries are:

- 11 × `glue.*` / `glue_info.*` / `glue_keyform.*` — legitimately not generated. SS doesn't emit GLUEs (Hiyori has them, but auto-rig doesn't produce mesh-stitching glue; the count stays at 0 so Cubism reads zero-length sections).
- 1 × `draw_order_group_object.indices` — **emitted via `Object.entries` spread** in `uvAndIndices.js`, false positive from the literal-string regex.

Net: no other "destructured but never emitted" gaps. The audit also confirmed every count slot (`KEYFORM_POSITIONS`, `WARP_DEFORMER_KEYFORMS`, `ROTATION_DEFORMER_KEYFORMS`, etc.) is set correctly.

**Diff against upstream's emit pattern at `reference/stretchystudio-upstream-original/src/io/live2d/moc3writer.js`:** every section emitted by upstream is now also emitted by SS (after this fix). Counts match. Element types match. The remaining differences are data-shape (different param count / binding pool composition) which are expected per-project.

#### Tactical findings (non-bugs, worth flagging for future cleanup)

- **`counts[KEYFORM_POSITIONS]` is assigned twice** in `moc3writer.js`:
  - Line 192: `counts[KEYFORM_POSITIONS] = totalKeyformPositions` (initial planning value).
  - Line 422: `counts[KEYFORM_POSITIONS] = kfd.allKeyformPositions.length` (final emitted value).

  Second wins. The first assignment is dead — should be removed in a cleanup pass to avoid the implication that two sources of truth exist.

- **`draw_order_group.min_draw_orders=1000, max_draw_orders=200`** in `uvAndIndices.js:76-77` — semantically inverted (max < min). But this matches upstream byte-for-byte and the working `New Folder/shelby.moc3` reference has the same values. It's a Cubism convention quirk; do NOT "fix" the inversion or the file diverges from the working reference.

#### Verification methodology used

When the next moc3 export issue surfaces, this is the workflow that worked:

1. **Inspect the failing file structurally** with `scripts/dev-tools/moc3_inspect.py`. Note section counts, especially per-element count zeros that should be non-zero.
2. **Compare against a known-good reference** — `New Folder/shelby.moc3` (upstream-exported) and `reference/live2d-sample/Hiyori/runtime/hiyori_pro_t11.moc3`. Diff the count-info table side-by-side; anomalies (zero where reference has non-zero) point at missing emit.
3. **For each suspect field**, check both:
   - Is the section data being written? (`sections.set('name', ...)` somewhere in the writer path.)
   - Is the count being assigned? (`counts[COUNT_IDX.NAME] = ...` somewhere.)
4. **Cross-reference upstream's writer at `reference/stretchystudio-upstream-original/src/io/live2d/moc3writer.js`** for the exact emit pattern. The refactor split the writer; check whether each upstream `sections.set(...)` and `counts[...] =` has a corresponding line in the new code.
5. **Use the `python -c '...'` pattern** to read raw bytes at SOT offsets — but compute SOT indices as `2 + i` where `i` is the position in `SECTION_LAYOUT`, NOT in any other section list. Off-by-one in SOT indexing produces garbage data that looks like NaN/orphan-data and sends investigation down false trails.
