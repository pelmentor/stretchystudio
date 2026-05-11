# Phase 7.B Architecture Audit (2026-05-11)

Reviewed commit `9489177` (master). Files examined: all 12 listed in
scope (`blur.js`, `lib/weightPaint/index.js`, `v34_weight_paint_settings.js`,
`sample.js`, `mirror.js`, `normalize.js`, `projectSchemaVersion.js`,
`projectMigrations.js`, `projectStore.js`, `editorStore.js`,
`WeightPaintOverlay.jsx`, `default.js` keymap, `registry.js`,
`ToolSettingsPanel.jsx`). Traced undo discipline, batch correctness,
mirror semantics, blur math, DOM coupling, and N-panel truthfulness.

Phase 7.A lessons confirmed closed: `mirrorWeights` passes `project` to
`beginBatch` (line 263 of `mirror.js`); `normalizeAllWeights` passes
`project` (line 122 of `normalize.js`). No popover added in 7.B so G-3
(stopPropagation) is N/A.

---

## Summary

6 gaps found: **1 HIGH, 3 MED, 2 LOW.**

| ID  | Sev  | One-line |
|-----|------|----------|
| G-1 | HIGH | N-panel `BrushSection` renders a Hardness slider in weight-paint mode that has zero effect — neither draw nor blur reads `brushHardness`; Rule №1 violation (UI element appears functional but does nothing) |
| G-2 | MED  | `mirrorWeights` topology branch early-returns inside the `try` block with no data written; `finally{endBatch()}` runs correctly but the `beginBatch` snapshot was already pushed — one phantom undo slot leaked per "no active group" invocation |
| G-3 | MED  | `sampleWeightFromGlobalCursor` uses `document.querySelector('svg[data-overlay="weightPaint"]')` — singleton assumption; a second viewport instance would return the wrong bounding rect, making eyedropper pick the wrong vertex |
| G-4 | MED  | Blur brush `strength` hard-coded at `0.5` with no user-facing knob — Blender exposes `wpd->wpi.brush_alpha_pressure` (brush Strength) for the blur case; users cannot slow or speed up blur convergence |
| G-5 | LOW  | `buildMirrorVertexMap` bucket key discretizes `v.y` at `1/eps = 1000` units/px; vertices that differ by > `eps = 1e-3` px in the non-mirror axis fall into separate buckets and miss pairing — safe for integer-grid auto-rig output, broken for user-placed sub-pixel verts |
| G-6 | LOW  | `weightPaint.sample` `available()` returns true for any string selection in weight-paint mode including non-meshed parts; operator appears callable in the command palette but silently returns `sampled: false` |

---

## HIGH

### G-1: Hardness slider renders in weight-paint N-panel but has zero effect on any brush

**Files:**
- `src/v3/shell/ToolSettingsPanel.jsx:113-119` — `ContentForMode` renders `<BrushSection />` for `editMode === 'weightPaint'`
- `src/v3/shell/ToolSettingsPanel.jsx:79-86` — `BrushSection` renders the Hardness slider reading/writing `brushHardness`
- `src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx:225` — blur uses `strength: 0.5` (hardcoded)
- `src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx:229` — draw uses `const STRENGTH = 0.5` (hardcoded)
- `src/store/editorStore.js:161` — `brushHardness: 0.5` documented as "deform mode only today"
- `src/components/canvas/CanvasViewport.jsx:2583` — `brushHardness` is sole reader; deform-mode only

**Severity:** HIGH — violates Rule №1. The user moves a slider and
nothing changes. The N-panel presents a false affordance.

**Repro:** Enter Weight Paint mode → N-panel → drag Hardness from 0.0
to 1.0 → paint a stroke with Draw or Blur brush → no observable change
in brush behavior.

**Root cause:** `ContentForMode` returns
`<BrushSection /><WeightPaintSection />` for weight paint.
`BrushSection` surfaces both Size and Hardness knobs and writes
`editorStore.brushHardness`. Neither the draw path nor the blur path in
`flushPaint` reads `brushHardness`:

```js
// blur branch — WeightPaintOverlay.jsx:221-226
updates = computeBlurUpdates({ ..., strength: 0.5 });   // constant

// draw branch — WeightPaintOverlay.jsx:229-236
const STRENGTH = 0.5;                                    // constant
const next = cur + (t - cur) * STRENGTH * a.falloff;
```

`brushHardness` has one reader in the entire codebase:
`CanvasViewport.jsx:2583` inside the deform-mode brush path.

**Fix (FIX):** Replace `<BrushSection />` in the weight-paint branch of
`ContentForMode` with a new `WeightPaintBrushSection` that renders only
the Size slider (shared, intentional per `editorStore.js` comment "size
knob is shared across deform/sculpt/weight"). Add a separate Strength
[0,1] slider in `WeightPaintSection` writing a new
`editorStore.brushStrength` slot (default `0.5`). Wire `flushPaint` to
read `brushStrength` instead of the hardcoded constant for both draw
and blur branches. This closes G-1 and provides the knob that G-4 also
requests.

---

## MEDIUM

### G-2: `mirrorWeights` topology branch leaks a phantom undo snapshot when no active group is set

**File:** `src/v3/operators/weightPaint/mirror.js:263, 287-289, 300-302, 310-320`

**Severity:** MED — undo stack poisoned; Ctrl+Z consumes the phantom
slot and restores to an identical state, silently swallowing the prior
real undo entry.

**Repro:** Enter Weight Paint on a part that has weight groups in
`mesh.weightGroups` but `mesh.activeWeightGroup` is absent (can happen
on first enter before `ensureWeightGroupsForPart` has run for a legacy
mesh) → N-panel "Mirror Weights (Topology)" → toast reports skipped →
Ctrl+Z → undo fires on phantom snapshot (nothing changes) instead of
undoing the actual prior paint stroke.

**Root cause:** `eligibleForMirror` (line 310-320) checks
`Object.keys(mesh.weightGroups).length > 0` but does NOT check
`activeWeightGroup`. A part with groups but no active group passes the
gate. Inside `mirrorWeights`:

```js
// mirror.js:263
beginBatch(project);       // snapshot pushed NOW — cannot be revoked
try {
  if (mode === 'byName') { /* ... */ }
  else {
    const activeName = mesh.activeWeightGroup;
    if (typeof activeName !== 'string' || !mesh.weightGroups[activeName]) {
      return { mirrored: 0, skipped: true, ... };  // line 289 — exits try
    }                                              // no data written
    ...
  }
} finally {
  endBatch();   // line 301 — always runs; _batchDepth→0. Correct.
}
```

JS `finally` guarantees `endBatch()` fires — `_batchDepth` is correctly
restored. However the `pushSnapshot(project)` at `beginBatch` already
executed. The snapshot represents pre-operation state, sits on
`_snapshots`, and the next Ctrl+Z pops it and "restores" to identical
state.

**Fix (FIX, two options — either is correct):**

Option A — move `beginBatch` after the `activeName` guard:
```js
// mirror.js, topology branch
const activeName = mesh.activeWeightGroup;
if (typeof activeName !== 'string' || !mesh.weightGroups[activeName]) {
  return { mirrored: 0, skipped: true, axis, mode, vertexPairs };
}
// Only open the batch when we will actually write:
beginBatch(project);
try {
  const w = mesh.weightGroups[activeName];
  ...
} finally {
  endBatch();
}
```

Option B — add `activeWeightGroup` presence check to
`eligibleForMirror` so the operator reports unavailable when no active
group exists, preventing invocation entirely.

Option B is cleaner (gate closer to the UX surface), but Option A is
the minimal surgical fix.

---

### G-3: `sampleWeightFromGlobalCursor` singleton-assumes the weight-paint SVG

**File:** `src/v3/operators/weightPaint/sample.js:142`

**Severity:** MED — incorrect rect in any multi-viewport environment;
silent wrong-vertex pick or `sampled: false`.

**Root cause:**

```js
const svg = document.querySelector('svg[data-overlay="weightPaint"]');
```

Returns the first DOM match in document order. In the current app
shell, `CanvasArea.jsx:118` mounts `<WeightPaintOverlay />` only when
`!isPreview`, so there is at most one matching SVG. In a Storybook
story mounting two CanvasArea instances, or if split-view is added to
the shell, the first SVG's `getBoundingClientRect()` may be for a
different viewport pane. The eyedropper then projects the cursor
against the wrong origin, picking the wrong vertex or returning
`sampled: false`.

**Fix (DOCUMENT-AS-DEVIATION for v1; FIX before split-view):**
Register the active overlay's rect via a module-level getter when the
overlay mounts. For v1 (single viewport), document: "singleton
assumption — safe as long as `CanvasArea` mounts at most one
`WeightPaintOverlay`."

---

### G-4: Blur brush `strength` hard-coded at `0.5` — no user knob

**File:** `src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx:225`

**Severity:** MED — blur always converges at a fixed rate; users cannot
make it converge slowly (for subtle smoothing) or quickly (for
aggressive averaging). Blender's `WPAINT_BRUSH_TYPE_BLUR` uses
`wpd->wpi.brush_alpha_pressure` (user-settable Strength × tablet
pressure) as the lerp factor per `paint_weight.cc:1579`.

**Fix (FIX):** Same vehicle as G-1. Adding `editorStore.brushStrength`
(default `0.5`) and wiring it to both draw (`STRENGTH` constant
replaced by `brushStrength`) and blur (`strength: brushStrength`)
simultaneously closes both gaps. The N-panel `WeightPaintSection`
shows a Strength slider when no brush-specific hiding is needed —
both Draw and Blur benefit from it.

---

## LOW

### G-5: `buildMirrorVertexMap` bucket tolerance mismatch may lose pairs for sub-pixel vertices

**File:** `src/v3/operators/weightPaint/mirror.js:125-127` (bucket key),
`161` (pair acceptance)

**Severity:** LOW — auto-rig integer-grid output is always safe;
affected only by user-placed or FFD-dragged fractional-pixel vertices.

**Root cause:** The bucket key quantizes the non-mirror axis coordinate
to a `1/eps = 1000 units/px` grid:

```js
const bucketKey = (v) => {
  const other = axis === 'x' ? v.y : v.x;
  return Math.round(other / eps).toString();  // eps = 1e-3
};
```

Two vertices at `y = 100.0` and `y = 100.0015` produce bucket keys
`100000` and `100002` respectively. The pair search looks only inside
the candidate's bucket — the mirror partner, in a different bucket, is
never considered. Yet the pair-acceptance criterion
`bestDA <= eps * 10 = 0.01 px` would accept a vertex at `y = 100.0` as
the mirror of one at `y = 100.0015` (separation = 0.0015 < 0.01). The
bucket grid is 10× finer than the acceptance threshold, causing misses
for sub-pixel positional jitter.

**Safe zone:** Auto-rig places vertices at integer canvas px. For any
two vertices at the same integer `y`, bucket keys are identical and
the pair is found. `add_vertex` placements and FFD-drag endpoints may
produce fractional `y`.

**Fix (DOCUMENT-AS-DEVIATION):** Document:
"`buildMirrorVertexMap` is calibrated for integer-grid mesh topology.
Sub-pixel vertex pairing is not guaranteed." If sub-pixel support is
needed, replace `eps` with `eps * 10` in the bucket key formula to
align bucket resolution with the pair-acceptance threshold.

---

### G-6: `weightPaint.sample` `available()` does not filter non-meshed parts

**File:** `src/v3/operators/registry.js:1557-1561`

**Severity:** LOW — `sampleWeightAt` guards internally and returns
`sampled: false` with no side effects; no crash, no data corruption.

**Root cause:**

```js
available: () => {
  const editor = useEditorStore.getState();
  return editor.editMode === 'weightPaint'
    && typeof editor.selection?.[0] === 'string';
},
```

This returns `true` even when the selected node has no mesh (a `group`
node entering weight paint mode). The operator fires, `sampleWeightAt`
returns early, `brushWeight` is unchanged. The command palette shows
"Sample Weight" as available when it would always no-op for the
current selection.

Compare: `eligibleForMirror` and `eligibleForNormalize` both call
`getMesh(node, project)` and return `false` when mesh is absent —
consistent with each other but inconsistent with `weightPaint.sample`.

**Fix (FIX):** Add mesh-presence check consistent with sibling
operators.

---

## Verified clean

| Question from scope | Verdict |
|---|---|
| Phase 7.A G-1: `beginBatch` receives `project` in both new operators | `mirrorWeights:263` passes `project`; `normalizeAllWeights:122` passes `project`. Both correct. |
| Undo correctness: X-mirror toggle on undo stack | `setWeightPaintXMirror` calls `pushSnapshot(state.project)` at line 620 before the immer mutation. Correct. |
| Undo correctness: `brushWeight` NOT on undo stack | `setBrushWeight` writes to `editorStore` only. No `pushSnapshot`. Correct — editor state, not project state. |
| Mid-stroke brush switch (Draw → Blur) | `flushPaint` is a render-cycle closure. Brush change triggers re-render → new closure; the in-flight rAF completes with the old closure for its final dab (imperceptible). Next scheduled paint uses new brush. Correct. |
| xMirror `withMirror` double-application | `seen` Set initialized from `updates.map(u => u.vertexIndex)`. Mirror entries added only if `!seen.has(m)`. Axis-center verts excluded by `m === u.vertexIndex` guard. No double-application. Correct. |
| `computeBlurUpdates` self vs. neighbors | Inner loop at `blur.js:81` has `if (nb === i) continue`. Mean is neighbors-only. (Distinct from Blender's face-loop sum — see Blender audit D-1.) |
| `setWeightGroup` vs. `syncBoneWeightsFromActive` — `jointBoneId` gap | Inline at `projectStore.js:681` copies `boneWeights` but omits `jointBoneId`. `jointBoneId` is set once at `ensureWeightGroups`/`setActiveWeightGroup` and is correct for the current active group name. Mirror/normalize never rename groups — pointer stays valid. Gap documented in `setWeightGroup` comment (line 678). Harmless in current call graph. |
| Mirror ε — safe for auto-rig integer-grid output | `eps = 1e-3` → bucket key resolution 1000/px. Integer `y` vertices share exact bucket keys. Pair search tolerance `eps*10 = 0.01 px` accepts exact integer matches. Auto-rig output safe. (Sub-pixel caveat: G-5.) |
| `vertices` shape into `buildMirrorVertexMap` | Overlay passes `Array<{x,y}>` (line 166). Function accepts `{x,y}` objects, `[x,y]` arrays, and flat interleaved arrays (lines 102-109). Correct. |
| byName mirror suffix order-sensitivity | `pairGroupNames` tries both `(a endsWith lSuf, b endsWith rSuf)` and swapped. `findGroupPairs` marks both names seen on first match. No false positives for mixed-suffix names (`arm_L`/`arm.L` — different `NAME_PAIRS` entries, both fail). Correct. |
| `data-overlay` selector — multiple SVG risk | `CanvasArea.jsx:118`: `{!isPreview && <WeightPaintOverlay />}`. Exactly one non-preview CanvasArea in current shell. Zero production instances of the selector problem today. MED gap documented as G-3. |
| `paintWeightStroke` async + batch race | `paintWeightStroke` is `async` but does not call `pushSnapshot` — it uses a raw `set(produce(...))` (line 731-744). After `loadRigPeers` resolves (module-cached, near-instant after first call), the immer commit lands without snapshotting. Even if it resolves after `endBatch`, the stroke data is written correctly under the batch's single `beginBatch` snapshot. Correct. |
| `setWeightGroup` snapshot count inside batch | `setWeightGroup:664`: `if (!isBatching()) pushSnapshot(...)`. Each of the N calls from mirror/normalize runs inside the `beginBatch`/`endBatch` window → `isBatching()` true → no extra snapshots. Single batch snapshot only. Correct. |

---

## Repair priority

1. **G-1 (HIGH) + G-4 (MED) [+ Blender D-6]** — fix together: add
   `editorStore.brushStrength`, replace `BrushSection` in weight-paint
   mode with a size-only section, add Strength slider to
   `WeightPaintSection`, wire `flushPaint` to `brushStrength` for both
   branches. One commit closes all three.
2. **G-2 (MED)** — gate at eligibility (Option B): add
   `activeWeightGroup` check to `eligibleForMirror`. Single-function
   fix.
3. **G-6 (LOW)** — add mesh-presence check to `weightPaint.sample`
   `available()`. Two-line addition.
4. **G-3 (MED)** — DOCUMENT-AS-DEVIATION for v1; must fix before any
   split-view work.
5. **G-5 (LOW)** — DOCUMENT-AS-DEVIATION; document integer-grid
   assumption in `buildMirrorVertexMap` JSDoc.
