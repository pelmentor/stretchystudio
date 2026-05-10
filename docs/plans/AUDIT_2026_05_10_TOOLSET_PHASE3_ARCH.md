# Phase 3 Architecture Audit — 2026-05-10

Independent code review of commit `fa17a46` (Toolset Phase 3 — Sculpt Mode + 3 brushes Grab/Smooth/Pinch). Verified plan claims against code, traced the editor-state surface for facade gaps, walked the per-tick brush dispatch through the actual data flow, looked for regressions in adjacent code paths.

## Summary

12 gaps total — **3 HIGH** (broken behavior reachable from the manual gate), **6 MED** (correctness gaps under specific conditions), **3 LOW** (polish + dead code).

The HIGH cluster is a single root cause with three downstream symptoms: `editorRef.current.sculpt` is `undefined` because the perf-commit `a21fc2e` (2026-05-09) field-subscription rewrite of `editorState` left a partial facade and Phase 3 added a NEW slot to that facade-blind zone. Net effect: the brush picker UI works (CanvasToolbar / ToolSettingsPanel subscribe via hooks), but the canvas's per-tick dispatch reads `editorRef.current.sculpt ?? {}` and silently falls back to defaults — so every Sculpt stroke is the **default Grab brush at size 80, strength 0.5, smooth falloff** regardless of what the user picks. The N-panel sliders and toolbar buttons are dead UI. This is the single most important finding.

| ID  | Sev  | One-line                                                                                              |
|-----|------|-------------------------------------------------------------------------------------------------------|
| G-1 | HIGH | Sculpt brush picker / size / strength / falloff / iterations / connectedOnly all dead — facade misses `sculpt` slot |
| G-2 | HIGH | Sculpting in Animation Mode bakes into rest mesh; no `draftPose` route → permanent rest corruption    |
| G-3 | HIGH | GPU upload reads stale `projectRef.current` → 1-frame visual lag every tick (vs Edit-Mode brush which uploads computed verts directly) |
| G-4 | MED  | No mode-change cleanup; Tab out of Sculpt mid-stroke leaves `dragRef` live + cursor at `crosshair` until next pointerup |
| G-5 | MED  | Sculpt brush distance test uses REST verts but cursor projected through DEFORMED iwm → frame mismatch on bone-skinned / pose-overridden parts |
| G-6 | MED  | `iwm` cached at stroke begin becomes stale if a driver / animation playback advances during the stroke (rare but reachable in playback-paused scrub mode) |
| G-7 | MED  | `pointerup` fires synthetic `KeyK` keydown if `autoKeyframe` is true in animation mode — wrong for sculpt (verts already baked into base mesh, not draftPose) |
| G-8 | MED  | No undo correctness test — plan §3.H lists `test_sculpt_undo.mjs` but the file was not shipped; the firstTick + skipHistory contract is non-trivial and has at least one edge case (Grab brush's empty-tick-1 means firstTick stays true through tick-N if every tick produces zero deltas) |
| G-9 | MED  | `originIdx` for connectedOnly mode has no max-distance cutoff — clicking 1000 px from any vertex still anchors to the closest one, silently widening the connected-only footprint |
| G-10| LOW  | Per-tick `new Float32Array(mAfter.uvs)` allocation in GPU upload (60 fps × N parts = GC pressure) |
| G-11| LOW  | Dead fields in sculpt `dragRef` — `imageWidth`, `imageHeight`, `startZoom` set but never read           |
| G-12| LOW  | Comment at `CanvasViewport.jsx:2877-2878` lies about reading "freshly-written project ref" — projectRef is stale until next render |

## Plan promise verification

| Sub-phase | Plan claim                                                                  | Status         | Notes |
|-----------|-----------------------------------------------------------------------------|----------------|-------|
| 3.A       | Mode entry from ModePill, T-panel + N-panel content                         | OK             | `modeCompatTest(dataKind, MODE_SCULPT)` gates the row; all three surfaces wired. |
| 3.B       | Brush registry (Grab/Smooth/Pinch + Pinch-not-Inflate audit swap)           | OK             | Registry shape matches; getBrushById falls back to Grab on unknown id. |
| 3.C       | Grab — drag verts within radius by `(cursor - prevCursor) * falloff`         | OK math        | Pure math correct; tests confirm. **Dispatch broken via G-1.** |
| 3.D       | Smooth — Laplacian over triangle adjacency, multi-iteration                  | OK math        | Iteration buffer mirrors verts and chains correctly; tests confirm. |
| 3.E       | Pinch — pull toward cursor; Ctrl flips to Magnify                            | OK math        | EPS skip + sign flip on ctrl correct; tests confirm. |
| 3.F       | N-panel SculptSection — brush picker + size + strength + falloff + iterations + connected-only | OK UI / DEAD VALUES | All sliders mount and write to store, but **canvas reads from facade not store** (G-1) — values never reach the brush. |
| 3.G       | Proportional-edit toggle hides in Sculpt Mode                                | OK             | `ModePill.jsx:188` — `showProportionalToggle = editMode === MODE_EDIT`. |
| 3.H       | Tests: sculpt_grab + sculpt_smooth + sculpt_inflate + sculpt_undo             | PARTIAL        | 3 of 4 shipped. `test_sculpt_inflate.mjs` correctly skipped (Inflate replaced by Pinch); `test_sculpt_pinch.mjs` substituted. **`test_sculpt_undo.mjs` missing** — this is the file that would have caught G-1 + G-3 + G-7. |
| 3.I       | Phase exit gate — all sculpt tests green                                     | OK             | 91/91 assertions pass. |

## HIGH-severity gaps

### G-1: Sculpt brush picker / size / strength / falloff / iterations / connectedOnly are all dead UI

Files: `src/components/canvas/CanvasViewport.jsx:2265, 2829`; root cause `:220-230` (the `editorState` facade)

Plan: implicit (3.B/3.C/3.D/3.E/3.F all assume canvas reads the user's brush + settings)

The `editorState` render-time facade built in `CanvasViewport.jsx:220-230` only carries:
```
viewByMode, selection, viewLayers, editMode, activeBlendShapeId, brushSize, meshSubMode, setSelection, setView
```

`editorRef.current = editorState` (L365) is the SOLE assignment to `editorRef.current` in the file (verified via grep). There is no Zustand `subscribe()` augmenting it, no Proxy, no spread of the full store.

Phase 3's two `editorRef.current.sculpt ?? {}` reads (L2265 in onPointerDown, L2829 in onPointerMove) therefore always return `{}`, and the per-tick brush call evaluates as:

```js
const sculptCfg = editorRef.current.sculpt ?? {};  // {}
const brush = getBrushById(sculptCfg.activeBrush ?? 'grab');  // ALWAYS Grab
brush.tick({
  size:          sculptCfg.size ?? 80,        // ALWAYS 80
  strength:      sculptCfg.strength ?? 0.5,   // ALWAYS 0.5
  falloff:       sculptCfg.falloff ?? 'smooth',// ALWAYS smooth
  iterations:    sculptCfg.iterations ?? 1,    // ALWAYS 1
  connectedOnly: !!sculptCfg.connectedOnly,    // ALWAYS false
  …
});
```

Manual gate symptoms:
- N-panel "Brush: Smooth" → still draws Grab strokes
- N-panel "Size: 200" → still 80 px footprint
- T-panel Pinch button (active state ring DOES update because CanvasToolbar reads via hook) → click-drag still does Grab
- "Connected only" checkbox → ignored

This is a **PRE-EXISTING facade gap that Phase 3 made user-visible**. The same facade also drops `toolMode`, `brushHardness`, `autoKeyframe` — meaning Phase 0's vertex-select / add_vertex / remove_vertex toolbar buttons in Edit Mode are ALSO non-functional (canvas always falls through to the brush `else` branch at `CanvasViewport.jsx:2485` because `toolMode === undefined !== 'select'/'add_vertex'/'remove_vertex'`). User has not reported this, suggesting Phase 0 was gated mostly on selection-by-default behavior. But Phase 3 has no fallback that hides the breakage.

Should be: extend the facade to include `sculpt`, `toolMode`, `brushHardness`, `autoKeyframe`. OR migrate `editorRef.current` to a Zustand `subscribe()`-driven update so the ref always carries the full store. The latter is less brittle (any future store field works automatically); the former is mechanical (~5 line edits at L210-214 + L220-230).

Repro: enter Sculpt Mode on Hiyori face, change N-panel brush to Pinch, click-drag — verts move radially outward from cursor as Grab would, not toward as Pinch would. Or: change brush size slider 80 → 200 and observe the brush footprint unchanged.

### G-2: Sculpting in Animation Mode bakes into rest mesh — no draftPose route

File: `src/components/canvas/CanvasViewport.jsx:2865-2875`

Plan: implicit (Sculpt is "operating on the same mesh data" the Edit-Mode brush touches; Edit-Mode brush has the `getEditorMode() === 'animation' && meshSubMode === 'deform'` gate at L2940 that diverts writes to `draftPose`)

The Edit-Mode brush handler has:
```js
// L2938-2943
if (getEditorMode() === 'animation' && meshSubMode === 'deform') {
  animRef.current.setDraftPose(partId, { mesh_verts: newVerts.map(v => ({ x: v.x, y: v.y })) });
  return;
}
```

Sculpt's `updateProject((proj2) => {…})` at L2865 has no equivalent gate. Workspace policy gating was deleted 2026-05-02 (`workspaceViewportPolicy` removed; `CanvasViewport.jsx:273-278` documents this), so Animation workspace + Sculpt Mode is reachable. Result: dragging a sculpt brush during animation playback (or while paused on a keyframe) PERMANENTLY mutates `m.vertices[i].x/.y` — the rest pose. Press Tab back to Object Mode and the character's rest is destroyed.

Should be: either gate sculpt brush writes through `setDraftPose` analogously to the Edit-Mode brush, OR explicitly block Sculpt Mode entry while `getEditorMode() === 'animation'` (cleaner; sculpt has no concept of "shape this keyframe" — its purpose is rest-mesh edits). The ModePill row could disable with hint "Exit animation mode to sculpt".

Repro: enter Animation workspace, scrub to mid-clip, ModePill → Sculpt Mode → Grab → drag → mesh permanently moved at rest. Reload project to see corruption persists.

### G-3: GPU upload reads stale projectRef → 1-frame visual lag every tick

File: `src/components/canvas/CanvasViewport.jsx:2877-2887`

Plan: §3 frame discipline notes promise "what we upload matches the store"

The Edit-Mode brush handler uploads from in-memory computed `newVerts`:
```js
// L2914 — zero lag
sceneRef.current?.parts.uploadPositions(partId, newVerts, allUvs);
```

Sculpt instead reads back from `projectRef.current` AFTER `updateProject`:
```js
// L2880-2886
const nAfter = projectRef.current.nodes.find(...);
const mAfter = getMesh(nAfter, projectRef.current);
if (mAfter) {
  scene.parts.uploadPositions(drag.partId, mAfter.vertices, new Float32Array(mAfter.uvs));
}
```

`projectRef.current = project;` is assigned only at render (L366). Within an event handler, `updateProject` triggers `set()` → store updated synchronously, but React doesn't re-render until the handler returns. So `projectRef.current` reflects the PRE-updateProject state until the next render. Each Sculpt tick uploads the previous tick's verts. Steady-state: GPU is exactly one frame (16ms) behind the store. Comment "Re-read from the freshly-written project ref so what we upload matches the store" (L2877) is incorrect.

Repro: in Chrome DevTools Performance, record a 30-frame Grab stroke → uploaded vertex positions trail cursor by ~16 ms. Visible as small input lag.

Should be: build `newVerts = mesh.vertices.map(v => ({...v}))`, apply `tickResult` to that copy in-memory, upload the copy, THEN `updateProject` (no readback). This is the Edit-Mode brush pattern and has zero lag.

## MED-severity gaps

### G-4: No mode-change / unmount cleanup for sculpt drag state

File: `src/components/canvas/CanvasViewport.jsx:2291-2316`

`onPointerDown` writes `dragRef.current = { mode: 'sculpt', …iwm…, …adjacency… }` and `canvas.style.cursor = 'crosshair'`. The only path that clears this is `onPointerUp` (L3069-3075), wired via `onPointerCancel={onPointerUp}` (L3206) for touch.

Failure modes:
1. User Tab-switches modes mid-drag → editMode flips to e.g. Pose Mode while pointer still down. Subsequent pointermove still hits the `dragRef.current.mode === 'sculpt'` branch (no editMode gate at L2827) and continues mutating verts. Cursor stays at `crosshair`.
2. User drags off canvas onto a Radix popover that captures pointer events → no pointercancel/pointerup ever fires on the canvas. dragRef leaks until next canvas pointerdown.
3. Workspace switch unmounts CanvasViewport → useRef state lost (no dispose hook); fine for refs but the cursor was set on `canvas.style.cursor` directly, which goes with the unmounted DOM (also fine).

Should be: add a `useEffect(() => () => { dragRef.current = null; ... }, [editMode])` that aborts the stroke on mode change, OR gate the L2827 brush dispatch on `editorRef.current.editMode === 'sculpt'` so a stale dragRef can't keep firing across modes.

### G-5: Frame mismatch on bone-skinned / pose-overridden parts

File: `src/components/canvas/CanvasViewport.jsx:2275-2283, 2832-2856`

The onPointerDown sculpt branch:
- Builds `worldMatrices` from `effectiveNodes` which include animation pose overrides (L2229)
- Inverts the part's world matrix → `iwm`
- Uses `iwm` to project cursor into mesh-local

The onPointerMove sculpt branch:
- Reads `mesh.vertices` from `projectRef.current` (REST verts)
- Computes brush distances against rest verts using a cursor projected through the deformed iwm

For unposed / non-bone-attached parts these frames coincide, so it works. For bone-skinned parts (LBS) or animation-overridden parts, the visible mesh is in "deformed" position but `mesh.vertices` is in "rest" position. The brush footprint hits where the REST verts are, NOT where the visible verts are. User clicks on a bent arm's elbow at posed position; sculpt acts on rest-position verts somewhere else.

The Edit-Mode brush handler avoids this by computing `effectiveVerts` (L2492-2517) which includes pose / kfOverride / blend-shape deltas, and the distance test uses `effectiveVerts[i].x - lx`. Sculpt brush has no such projection — it's rest-only.

Should be: either build `effectiveVerts` analogously and use it for distance-only (writing back via inverse delta to base mesh), OR document that Sculpt is "rest-mesh only" and disable Sculpt entry when the part is currently bone-driven. Latter is cleaner.

### G-6: `iwm` cached at stroke begin goes stale if anim playback / driver advances

File: `src/components/canvas/CanvasViewport.jsx:2300-2305`

The progress doc claims "the part's transform doesn't move while the user is dragging in it." This is true for static editing but FALSE if:
- Animation is playing (very rare during a sculpt drag)
- A live driver / physics tick advances `node.transform.*` between stroke begin and stroke end
- Idle eyeBlink / breath driver writes to ParamBreath / ParamEyeLOpen which propagates through chainEval to bone-attached parts

Per-tick recompute would be expensive (chains the whole tree) but the cached iwm becomes wrong. With G-5 already documenting the rest-vs-deformed frame mismatch, this compounds: not only is the iwm capturing the deformed frame, the deformed frame can drift mid-stroke.

Pragmatic fix: snapshot `iwm` per-tick from the just-computed `worldMatrices` cache (which the rAF tick already maintains in `lastEvalCacheRef`). Cheap if cache-hit.

### G-7: pointerup fires synthetic K keydown for sculpt strokes in animation mode

File: `src/components/canvas/CanvasViewport.jsx:3072-3074`

```js
if (dragRef.current) {
  dragRef.current = null;
  canvas.style.cursor = '';
  if (editorRef.current.autoKeyframe && getEditorMode() === 'animation') {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
  }
}
```

This was added for the Edit-Mode brush's draftPose flow (write to draftPose → user manually presses K, but autoKeyframe fires K for them). For sculpt, draftPose is NOT used (G-2); the verts are already baked into base mesh during the stroke. Firing K then tries to keyframe the (now-corrupted) base mesh again. Harmless if the K handler short-circuits on no-draftPose, but conceptually wrong.

(Also: `editorRef.current.autoKeyframe` is `undefined` because of the same facade gap as G-1, so this never actually fires today. But removing the facade gap to fix G-1 also surfaces this latent bug.)

Should be: gate the K dispatch on `dragRef.current.mode !== 'sculpt'` — sculpt strokes don't keyframe.

### G-8: No undo correctness test shipped — `test_sculpt_undo.mjs` missing

File: plan §3.H lists this test; only `test_sculpt_grab/smooth/pinch/store` were shipped.

The undo contract is non-trivial:
- First non-empty tick writes WITH history (`skipHistory: false`)
- Subsequent ticks write WITHOUT history (`skipHistory: true`)
- Result: one stroke = one undo entry restoring pre-stroke verts

Edge cases the missing test would catch:
1. Grab brush's tick-1 always returns empty (no prevCursor) → tick-2 is the first non-empty tick → snapshot pushed at tick-2 captures the post-tick-1 state, which is the SAME as pre-stroke since tick-1 didn't mutate. Correct, but only by accident.
2. If user clicks down + holds without moving → no displacement, no history entry → no undo to revert (correct: nothing changed).
3. If user clicks down with cursor in empty space (no verts in radius) every tick → `tickResult.size === 0` returns early on every tick → `firstTick` stays true forever. If user then drags into a populated region, the first non-empty tick correctly flips firstTick. But the LOG of "stroke began here" is lost.
4. If user starts a stroke, undoes mid-stroke (Ctrl+Z while pointer down) → store rewinds, but `dragRef.current.firstTick` is still false → next tick after undo doesn't push history → the redo half of the stroke isn't undoable separately. This is a real foot-gun.

Should be: ship `test_sculpt_undo.mjs` covering at minimum the firstTick-stays-true-with-empty-ticks case and the undo-mid-stroke case.

### G-9: connectedOnly origin has no max-distance cutoff

File: `src/components/canvas/CanvasViewport.jsx:2280-2289`

```js
let originIdx = -1;
let bestDist = Infinity;
for (let i = 0; i < selMesh.vertices.length; i++) {
  // ... finds the absolute closest vertex, no threshold
}
```

Even if the user clicks 1000 px from any vertex (e.g. waaay outside the mesh bounds), `originIdx` is set to whatever vertex happens to be closest. With `connectedOnly: true`, the brush footprint anchors to that distant component. Most strokes won't actually affect anything (radius too small to reach), but the BFS reachable set IS computed and held in dragRef for the whole stroke, wasting work.

Less critical because the brush has no visible effect when nothing's in range, but it's a free perf + correctness improvement to add `if (bestDist > maxClickDist) originIdx = -1` (Blender's sculpt brush picks no vertex when the cursor is outside the mesh's bounding region).

## LOW-severity (polish, deferrable)

### G-10: Per-tick `new Float32Array(mAfter.uvs)` allocation

File: `src/components/canvas/CanvasViewport.jsx:2884`

Allocates a fresh Float32Array on every pointermove (60 fps). At a long sculpt stroke that's 60 allocations per second per part. The Edit-Mode brush avoids this by snapshotting `allUvs` in dragRef at stroke begin (L2536: `allUvs: new Float32Array(selMesh.uvs)`).

UVs don't change during a sculpt stroke (sculpt is position-only), so a single snapshot would suffice. Move the `new Float32Array(...)` into the dragRef setup at L2291.

### G-11: Dead fields in sculpt dragRef

File: `src/components/canvas/CanvasViewport.jsx:2298-2310`

Stored but never read by the brush dispatch:
- `imageWidth: selNode.imageWidth`
- `imageHeight: selNode.imageHeight`
- `startZoom: view.zoom` (only `startSizeLocal` is read; `startZoom` is computed but never consumed)

Sculpt has no UV remap (no `meshSubMode === 'adjust'` analog) so imageWidth/imageHeight are unused. `startZoom` is dead. Remove or wire to a future UV-mode if planned.

### G-12: Misleading comment about "freshly-written project ref"

File: `src/components/canvas/CanvasViewport.jsx:2877-2878`

```js
// GPU upload — immediate visible feedback. Re-read from the
// freshly-written project ref so what we upload matches the store.
```

projectRef is stale until React re-renders (G-3). Comment should match reality: "GPU upload reads `projectRef.current` which is one render behind the store; this introduces a 1-frame visual lag" — OR fix G-3 and the comment becomes accurate.

## Test coverage gaps

Obvious-but-missing assertions, sorted by which finding they would have caught:

1. **Brush picker round-trip from N-panel through CanvasViewport to brush.tick** (G-1) — A test that `useEditorStore.getState().setSculpt({ activeBrush: 'pinch' })` results in the next sculpt-tick dispatch calling `pinchTick`. Without `editorRef.current.sculpt` being read correctly, this would fail. The closest test (`test_sculpt_store.mjs` Test #2) verifies that setSculpt updates the store, but no test bridges store → editorRef → brush dispatch.
2. **Sculpt during Animation Mode routes to draftPose, NOT base mesh** (G-2) — No test asserts that a brush stroke in animation mode keeps `node.mesh.vertices` unchanged.
3. **GPU upload uploads the just-written verts, not the previous state** (G-3) — Hard to test in isolation without a mock GL context; could test by spying `uploadPositions` and asserting the vertex array passed equals the one Tap-2 wrote.
4. **Stroke = one undo entry** (G-8) — `test_sculpt_undo.mjs` listed in plan, not shipped.
5. **Sculpt brush hits visible vertex positions on bone-skinned parts** (G-5) — Currently hits rest positions. A test that builds a fake LBS-skinned part + verifies brush distance test uses effective verts would have caught this.
6. **Mode-change mid-stroke aborts the drag** (G-4) — A test that flips editMode mid-stroke and asserts `dragRef.current === null` after.

## Test run results

Did not run; this is a code-only audit. Per progress doc, all 4 sculpt suites + adjacent suites pass (91 sculpt assertions + ~700 adjacent).

## Recommendations

**Block Phase 3.J manual gate until G-1 fixed**, because the gate explicitly tests "select Pinch / Smooth from picker → see different brush behaviour" which cannot work today.

Fix-before-gate (HIGH):
- G-1 — Either extend the `editorState` facade in `CanvasViewport.jsx:220-230` to include `sculpt` (and while we're there: `toolMode`, `brushHardness`, `autoKeyframe`), OR migrate `editorRef.current` to a `useEditorStore.subscribe()`-driven update so any future store field is automatic. Latter recommended (sister to the existing `animRef.current` pattern at L257). 5-10 line change. **Side effect**: also fixes Phase 0's silent toolbar breakage (toolMode reads), Phase 0/1's brushHardness reads, and the auto-keyframe path.
- G-2 — Either gate Sculpt Mode entry to suppress Animation workspace, OR add an `if (getEditorMode() === 'animation') { animRef.current.setDraftPose(...); return; }` in the sculpt dispatch (L2865). The first option is cleaner — sculpt is a rest-mesh edit operation, animation is a pose-mesh layer; mixing the two has no Blender precedent.
- G-3 — Refactor sculpt onPointerMove to compute `newVerts = mesh.vertices.map(v => ({...v}))` in-memory, apply tickResult to it, upload `newVerts` to GPU, THEN updateProject. This is the Edit-Mode brush pattern (L2914). ~10 line edit.

Defer-OK (MED, fix in Phase 3 polish pass):
- G-4 — Add a `useEffect(() => () => { if (dragRef.current?.mode === 'sculpt') dragRef.current = null; }, [editMode])`.
- G-5 — Document the rest-only limitation in plan §3 + progress doc; OR build `effectiveVerts` for distance test like Edit-Mode brush does.
- G-6 — Cheap: re-read iwm from `lastEvalCacheRef.current.frames` per tick if available; fall back to cached iwm if cache-miss.
- G-7 — Add `if (dragRef.current.mode !== 'sculpt')` guard around the K dispatch at L3072.
- G-8 — Ship `test_sculpt_undo.mjs` covering the firstTick + undo-mid-stroke cases.
- G-9 — Add `if (bestDist > MAX_CLICK_DIST_SQ) originIdx = -1` (Blender's threshold ≈ brush size or part bbox-padded).

LOW (defer to Phase 4+):
- G-10, G-11, G-12 — Mechanical cleanups.

## Notes for the parallel Blender-fidelity audit

The Blender-fidelity agent should verify:
- Pinch's `PINCH_RATE = 0.5` matches Blender's `BRUSH_PINCH` magnitude under default brush settings (`source/blender/blenkernel/intern/brush.cc` `BKE_brush_default_set`).
- Smooth's "iterate-and-commit-after-each-iter" matches Blender's `SCULPT_brush_strokes` symmetric Smooth (audit-doc claim L19-22 of `smooth.js`).
- "Use Connected Only" anchors to the START patch even if cursor drags off — Blender's sculpt anchors at stroke begin and the brush footprint follows (verify in `source/blender/editors/sculpt_paint/sculpt.cc` `do_brush_action`).
- Pinch + Magnify modal toggle is Ctrl-hold (verify `BRUSH_DIR_FLAG` semantics in `BKE_brush_alpha_get` / `paint_stroke_modal`).

## Cross-reference — pre-existing facade defect

The root cause of G-1 (`editorRef.current.sculpt` undefined) is the same root cause that breaks `editorRef.current.toolMode`, `editorRef.current.brushHardness`, and `editorRef.current.autoKeyframe` reads. This means today, in `master`:
- Phase 0's vertex-select / add_vertex / remove_vertex toolbar buttons in Edit Mode are non-functional (canvas always falls through to brush — `toolMode === undefined !== 'select'`).
- Edit-Mode brush hardness slider is dead (`brushHardness === undefined` → `brushWeight(dist, radius, undefined)` returns NaN).
- Animation autoKeyframe never fires (`autoKeyframe === undefined` → falsy).

These are NOT Phase 3 regressions — the perf commit `a21fc2e` (2026-05-09) introduced them by moving from `useEditorStore()` (whole store) to selective field subscriptions without keeping the facade complete. Phase 3 simply inherited the same blind zone for its new `sculpt` slot. Fixing G-1 (extend the facade or switch to subscribe-driven ref) closes all four pre-existing gaps in one motion.
