# Phase 2 Architecture Audit — 2026-05-10

Independent code review of commit `5b81205` (Toolset Phase 2 — snap to grid / vertex / increment in Modal G/R/S). Verified each plan claim against code, ran all suites, looked for regressions, edge cases, doc drift.

## Summary

11 gaps total — **2 HIGH** (broken behavior; both are reachable in normal use), **6 MED** (sharp edges / UX gaps / missing invalidations), **3 LOW** (polish).

Two HIGH bugs both block the manual gate (Phase 2.G):
- G-1 — Modal crashes on first mousemove (TypeError: cannot read 'zoom' of undefined). Pre-existing from BVR-005 but Phase 2 expanded the surface (also reads `view.panX/Y`). Plain `useEditorStore.getState().view` is `undefined` after the `viewByMode` rework (commit `86b2e43`).
- G-2 — Snap-to-vertex finds the dragged part's own verts → modal "sticks" to the start position in Object Mode.

## Plan promise verification

| Sub-phase | Plan claim | Status | Notes |
|-----------|-----------|--------|-------|
| 2.A | snap slot `{enabled, modes:{grid,vertex,increment}, target}`, persistence | OK | Schema matches plan; loadJson/saveJson keyed `v3.prefs.snap`; `mergeSnap` validator preserves nested keys on schema bumps. |
| 2.B | Modal G replaces `Math.round(delta/10)*10` with snap-to-grid | OK math, BROKEN runtime | Math correct (`snapDeltaToGrid` works); shipping path crashes via G-1 before reaching it. |
| 2.C | Spatial hash, invalidate on topology change at 3 callsites, magenta dot | PARTIAL | 3 mesh-worker / add_vertex / remove_vertex sites hooked. **Missing**: Apply Pose As Rest (`projectStore.js:794`) and Reset to Rest Pose (`PoseService.js:185`) both mutate `v.x`/`v.y` without invalidating. Dot crashes via G-1. |
| 2.D | Modal R/S consult `snap.modes.increment.value`, fall back to legacy 15°/0.1× | OK math, BROKEN runtime | Math correct; same G-1 crash. |
| 2.E | N-panel section in all modes, master + per-mode + target dropdown | PARTIAL | Mounted ABOVE mode content so visible everywhere; **target dropdown is dead UI** (modal never reads `snap.target`). Number inputs have `disabled={!enabled}` per-row but master-off only dims via opacity (cosmetic). |
| 2.F | 4 test files | OK | All 4 pass: 16+20+29+15 = 80 assertions. |

## HIGH-severity gaps

### G-1: Modal crashes on first mousemove (TypeError: zoom of undefined)
File: `src/v3/shell/ModalTransformOverlay.jsx:103, 401`
Plan: implicit (all snap math depends on a working modal)
Found:
```js
const ed = useEditorStore.getState();
const zoom = ed.view.zoom || 1;   // ← ed.view is undefined
const view = ed.view;             // ← undefined
…
view.panX                         // ← TypeError
```
The editor store has no `.view` field — that was renamed to `viewByMode.viewport` / `viewByMode.livePreview` in commit `86b2e43` (over a year ago). Verified at runtime:
```
view: undefined
viewByMode: { viewport: { zoom: 1, panX: 0, panY: 0 }, livePreview: {…} }
```
This is a PRE-EXISTING bug in BVR-005's modal; Phase 2 inherited and expanded the surface (originally only `view.zoom`, now also `view.panX/Y` for the new canvas-rect math + snap dot positioning). Every other consumer in the codebase reads `viewByMode.viewport` correctly (GizmoOverlay, BoxSelectOverlay, all viewport overlays).

Should be: `const view = useEditorStore.getState().viewByMode.viewport;` in both `applyDelta` (L102) and `SnapTargetDot` (L401). Pose Mode and Edit Mode are unambiguously the viewport tab; the modal isn't reachable from Live Preview anyway.

Repro: launch app, select any node, press G, move mouse → console TypeError + nothing happens. Test `test_modalTransformTyped.mjs` doesn't exercise `applyDelta`, only the typed-buffer store, which is why it didn't catch this.

### G-2: Snap-to-vertex doesn't exclude the dragged part's own verts
File: `src/v3/shell/ModalTransformOverlay.jsx:163-165`
Plan: implicit (Object Mode + Edit Mode both implied)
Found:
```js
const hit = findNearestVertex(
  project, cursorCanvasX, cursorCanvasY, snap.modes.vertex.threshold,
);
```
No `excludePartId` passed. In Object Mode, when dragging Part A, the cursor starts INSIDE Part A. The nearest vertex is one of Part A's own. Snap math then sets `dxCanvas = vertA.x - startCursor.x` — a tiny delta that holds the part to ~its starting position. As the user drags, the dot magnetizes onto the dragged part's verts. The "snap one object onto another" use case is broken.

Should be: pass `{ excludePartId: <selection[0]> }` when the modal is in Object Mode; pass nothing in Edit Mode (snap-to-other-vertex within the active part is a feature). Or always exclude when there's exactly one node in the selection.

Repro: load Hiyori, click face part, press G, drag → magenta dot pins to face's own vertex; part barely moves no matter where the cursor goes.

## MED-severity gaps

- **G-3** Apply Pose As Rest mutates `v.x/y` without invalidating snap hash. File: `src/store/projectStore.js:794-797`. After Apply, the hash returns stale "rest" positions. Add `invalidateSnapHash()` after the bake loop.
- **G-4** Reset to Rest Pose mutates `v.x/y` (snaps back to restX/restY) without invalidating. File: `src/services/PoseService.js:185-186`. Same fix — call `invalidateSnapHash()` after the reset.
- **G-5** Doc drift: plan §2.C and snapHash.js header both say "snap to REST verts", but `getMeshVertices` returns `node.mesh.vertices` which holds `v.x/v.y` — these are mutated to LIVE deformed values by SkeletonOverlay's onPointerUp skinning bake (per comment in `PoseService.js:174-177`). In Pose Mode, the hash holds DEFORMED coords. Either rename the doc claim to "live verts (post-skin-bake)" or have the hash read `v.restX ?? v.x`.
- **G-6** Cleanup doesn't clear snap target. File: `src/v3/shell/ModalTransformOverlay.jsx:354-359`. `clearSnapTarget()` is called on commit/cancel/escape/contextmenu but NOT in the useEffect cleanup. If the parent unmounts mid-drag (e.g. workspace switch, page navigation, AppShell remount), the magenta dot persists until the next modal G. Add `useSnapStore.getState().clearSnapTarget();` to the cleanup return.
- **G-7** `snap.target` dropdown is dead UI. File: `src/v3/shell/ModalTransformOverlay.jsx` (no read of `snap.target` anywhere). Progress doc admits this in §"Deliberately NOT shipped" but the dropdown is shown in N-panel without any "(coming soon)" indication. Either gray it out / hide it, OR wire `closest`/`active` immediately (active = activeVertex from editorStore for Edit Mode; cursor for Object Mode).
- **G-8** Increment row's `°` unit label hides Scale binding. File: `src/v3/shell/ToolSettingsPanel.jsx:172`. Same `value` field drives Modal R (degrees) AND Modal S (`value/100` scale step). User editing "Increment 15°" doesn't know they're also setting scale step to 0.15×. Either split into two rows or label as `° / × ÷100`.

## LOW-severity (polish, deferrable)

- **G-9** `excludeVertSet` semantics inverted from name. File: `src/lib/snap/snapHash.js:117, 126-128`. The name suggests "set of verts to exclude" but the logic is "skip ONLY verts in this set within the excluded part" — inverse of what callers would expect. Untested in test_snap_vertex_threshold.mjs (Test 5 only covers `excludePartId` alone). Either rename to `keepVertSet` or fix the logic.
- **G-10** Master-off doesn't disable per-row checkboxes. File: `src/v3/shell/ToolSettingsPanel.jsx:141`. `opacity-60` is cosmetic; clicks still go through. Add `pointer-events-none` to the wrapper or `disabled` on each checkbox when `!masterOn`.
- **G-11** `clearSnapTarget()` fires every tick when master is off / shift held / non-G modal. File: `src/v3/shell/ModalTransformOverlay.jsx:177`. Harmless because Zustand subscribers compare via Object.is on selector return (both null → no React re-render), but adds a per-mousemove allocation. Guard with `if (useSnapStore.getState().target !== null)`.

## Test coverage gaps

Obvious-but-missing assertions:
1. **`excludePartId` passed by modal in Object Mode** — no integration test asserts that the modal-G in Object Mode wouldn't snap to the dragged part's own verts. (Same gap as G-2 root cause.)
2. **`snap.target` is read by some path** — test would have caught the dead-UI gap (G-7).
3. **Apply Pose As Rest invalidates hash** — no test pins the contract that mesh.vertices mutations outside CanvasViewport's 3 callsites trigger invalidation. (G-3, G-4 root cause.)
4. **`excludeVertSet` actual semantics** — no test exercises the second opts arg of `findNearest`. The named param is undocumented behavior.
5. **Modal end-to-end happy path** — no test mounts `ModalTransformOverlay`, simulates a mousemove, asserts that the project's transform.x changes. Such a test would have caught G-1 immediately. (Hard to write without jsdom canvas + querySelector mock, but a thin smoke-test of `applyDelta(currentX, currentY, false)` after seeding `useEditorStore.setView('viewport', {…})` would suffice.)

## Test run results

- typecheck: **PASS** (`tsc --noEmit` clean, 0 errors)
- snap suites: **PASS** — snapGridTranslate (16/0), snapVertexThreshold (20/0), snapRotationIncrement (29/0), snapTargetModes (15/0)
- adjacent suites all PASS:
  - editorStore (87/0), preferencesStore (49/0), hitTest (35/0), modalTransformTyped (11/0)
  - proportionalEdit (52/0), auditFixes20260510 (23/0), vertexSelectionBasic (28/0), boxSelectObjectMode (13/0)
  - boxSelectEditMode (13/0), lassoSelectWinding (20/0), lassoSelectModifiers (19/0), spatialHash (15/0)
- pre-existing unrelated failure: `test:armatureOrganizer` — `ReferenceError: matchTag is not defined` at `src/io/armatureOrganizer.js:640`. Last touched in commit `7e264a9`; not introduced by Phase 2.

## Recommendations

**Block manual gate (Phase 2.G) until G-1 + G-2 fixed.** Without G-1 the feature literally crashes; without G-2 it appears broken.

Fix-before-gate (HIGH):
- G-1 — Replace 3× `useEditorStore.getState().view` with `useEditorStore.getState().viewByMode.viewport` in `ModalTransformOverlay.jsx` (L102, L104, L401). 5-min mechanical change. Smoke-test by pressing G in any mode and watching for crash.
- G-2 — Pass `excludePartId: original.size === 1 ? [...original.keys()][0] : null` (or use editorMode === Object Mode gate) to `findNearestVertex` in `ModalTransformOverlay.jsx:163`. 10-min change.

Defer-OK (MED, fix in Phase 2 polish pass before Phase 3):
- G-3 + G-4 — Add `invalidateSnapHash()` after vertex mutations in `projectStore.applyPoseAsRest` and `PoseService.resetToRestPose`. 2-line changes each; sister to existing logging.
- G-5 — Update `snapHash.js:23-24` doc comment to match reality, OR change `add(v.x, v.y, …)` to `add(v.restX ?? v.x, v.restY ?? v.y, …)` in `buildSnapHash`. Latter is the correct fix for "snap to rest" semantics; affects ~1 line.
- G-6 — Add `useSnapStore.getState().clearSnapTarget();` to the useEffect cleanup return at L354.
- G-7 — Either gate the target dropdown behind a "feature flag" comment + visible `(WIP)` label, OR ship `closest`/`active` right now (10 min). Plan says target modes are unit-tested via `computeSelectionAnchor`; wiring is straightforward.
- G-8 — Add second row "Scale Step ×" using `(value/100).toFixed(2)` derived from same `increment.value`, or add a separate `scale.step` slot.

LOW (polish, defer to Phase 3+):
- G-9, G-10, G-11 — Mechanical fixes; no rush.
