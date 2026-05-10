# Phase 6 Architecture Audit — 2026-05-10

Independent code review of commit `f44a1b0` (Toolset Phase 6 — Select
Linked + Duplicate + Apply menu + Circle Select).

Traced all five new files plus all extended surfaces. Compared the
modal lifecycle against Phase 5's extrude modal and the Phase 5
audit-fix patterns from
[AUDIT_2026_05_10_TOOLSET_PHASE5_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE5_ARCH.md).

## TL;DR

8 gaps — **1 HIGH** (silent unhandled rejection on async exec),
**4 MED** (data-corruption gate, per-tick matrix rebuild, chord bleed,
context-menu propagation), **3 LOW** (undo non-atomicity, missing undo
snapshot, `clientToCanvas` triplication).

| ID  | Sev  | One-line                                                                                            |
|-----|------|-----------------------------------------------------------------------------------------------------|
| G-1 | HIGH | `apply.armatureModifier` exec is `async`; dispatcher and ApplyMenu both fire it synchronously — errors after `await import()` are unhandled rejections |
| G-2 | MED  | `apply.poseAsRest` missing animation-mode guard the legacy button has — fires at wrong playback time, silently corrupts rest geometry |
| G-3 | MED  | `computeWorldMatrices` called on every mousemove paint tick in Object Mode (no cache across ticks) |
| G-4 | MED  | Circle Select `onKeyDown` does not swallow operator chords (G/E/R/S/B/M/…) — same G-4 pattern from Phase 5 |
| G-5 | MED  | `onContextMenu` in CircleSelectOverlay missing `stopPropagation()` — event bubbles past `cancel()` |
| G-6 | LOW  | `apply.poseAsRest` operator is not undo-able; `applyPoseAsRest()` bypasses `pushSnapshot`/`isBatching` |
| G-7 | LOW  | `apply.armatureModifier` bakes are non-atomic — each `applyArmatureModifier(id)` is a separate undo entry |
| G-8 | LOW  | `clientToCanvas` triplicated: BoxSelectOverlay, CircleSelectOverlay, registry inner fn — three identical copies |

---

## HIGH

### G-1 — `apply.armatureModifier` async exec silently drops errors (HIGH)

**Files:** `src/v3/operators/registry.js:1247`; `src/v3/shell/ApplyMenu.jsx:73`; `src/v3/operators/dispatcher.js:61`

`exec` is declared `async`. The dispatcher calls
`op.exec({ editorType: null })` with no `await` and no `.catch()`. The
returned Promise floats. Any throw after
`await import('../../services/ArmatureModifierService.js')` — dynamic
import failure, `applyArmatureModifier(id)` throwing — becomes an
unhandled rejection entirely invisible to the user. `ApplyMenu.run()`
has the same pattern: `try { op.exec(ctx); } catch (err) { ... }` —
the catch never fires for the async body.

**Fix (minimal):** At both call sites, attach a rejection handler:

```js
// dispatcher.js:61
const r = op.exec({ editorType: null });
if (r instanceof Promise) r.catch((err) => console.error(`[operator ${opId}]`, err));

// ApplyMenu.jsx run():
const r = op.exec(ctx);
if (r instanceof Promise) r.catch((err) => console.error('[ApplyMenu]', err));
```

**Fix (preferred):** Eager-import `ArmatureModifierService` at registry
load time so `exec` is synchronous. The lazy import is a bundle-weight
optimisation that isn't load-bearing for correctness.

---

## MED

### G-2 — `apply.poseAsRest` missing animation-mode guard (MED)

**Files:** `src/v3/operators/registry.js:1216–1231`; `src/components/canvas/CanvasViewport.jsx:3531–3534`

The legacy UI button guards
`if (editorMode === 'animation') return`. The operator's `available()`
only checks for a bone node — no mode check. `Ctrl+A` at a non-zero
scrubber position bakes the motion3.json-offset pose into rest,
corrupting rest positions permanently. Combined with G-6
(not undo-able), this is a data-loss path reachable from the default
keymap.

**Fix:** Add `useEditorStore.getState().editMode !== 'animation'` to
`available()`.

---

### G-3 — `computeWorldMatrices` rebuilt every mousemove paint tick (MED)

**File:** `src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx:236`

`runPaintTick` calls `computeWorldMatrices(project.nodes)`
unconditionally on every Object Mode mousemove while `painting` is true.
On a 200-node project at 60 Hz, that is 60 full tree-walks per second.
Matrices are constant within a paint stroke — the project is not
mutated between ticks. `partsInCircle` also rebuilds a `new Map()` from
`frames` on each call (`hitTest.js:678`).

**Fix:** Capture `worldMatrices` and the `frameMap` once at stroke-start
(`startPaint`) in a `useRef` and pass them through to `runPaintTick`.
Clear the refs on `endPaint`.

---

### G-4 — Circle Select `onKeyDown` does not swallow operator chords (MED)

**File:** `src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx:144–158`

The capture-phase `onKeyDown` handles only Escape, Enter, and bare C.
All other keys fall through to the dispatcher's bubble listener. While
circle-select is active, G opens `ModalTransformOverlay`, B mounts
`BoxSelectOverlay`, E fires extrude, M opens MergeMenu — nested
concurrently with circle-select. This is the same G-4 from Phase 5
(ModalVertexTransformOverlay) and the same fix applies.

**Fix:** At the bottom of the handler, before returning, add
`e.stopPropagation()` as a catch-all for any key not explicitly
handled.

---

### G-5 — `onContextMenu` missing `stopPropagation()` (MED)

**File:** `src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx:139–142`

```js
function onContextMenu(e) {
  e.preventDefault();
  cancel();
}
```

`preventDefault()` blocks the browser native menu. The event still
propagates — any future bubble-phase right-click handler fires after
`cancel()` has already closed the modal, seeing stale state. All
sibling handlers (`onMouseDown`, `onMouseUp`, `onWheel`) call
`stopPropagation()`; `onContextMenu` is the one exception.

**Fix:** Add `e.stopPropagation()` after `preventDefault()`.

---

## LOW

### G-6 — `apply.poseAsRest` is not undo-able (LOW)

**File:** `src/store/projectStore.js:743`; `src/v3/operators/registry.js:1224`

`applyPoseAsRest()` calls `set(produce(...))` directly, bypassing
`updateProject` and therefore `pushSnapshot`/`isBatching`. Ctrl+Z after
Apply Pose As Rest does nothing. Pre-existing on the legacy
CanvasViewport button, but Phase 6 makes it reachable via a keybinding
without any confirmation gate, amplifying accidental-trigger risk.
Combined with G-2 (no animation-mode guard), this is a silent
permanent-corruption path.

**Fix:** Either call `pushSnapshot(state.project)` at the top of
`applyPoseAsRest()` (checking `!isBatching()`), or wrap the operator
exec in `beginBatch` / `endBatch`.

---

### G-7 — `apply.armatureModifier` bakes are non-atomic (LOW)

**File:** `src/v3/operators/registry.js:1263–1266`

After the dynamic import resolves, the loop calls
`applyArmatureModifier(id)` per part. If each call internally calls
`updateProject`, it pushes a separate undo snapshot. Undoing a 3-part
bake takes 3× Ctrl+Z. Compare: Edit Mode duplicate wraps its topology
op in `beginBatch`/`endBatch` for atomic undo.

**Fix:** Wrap the post-import bake loop in `beginBatch` / `endBatch`
(and `discardBatch` on failure). Implement after G-1 is fixed so the
async await is in place.

---

### G-8 — `clientToCanvas` triplicated (LOW)

**Files:** `src/v3/editors/viewport/overlays/BoxSelectOverlay.jsx:56`; `src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx:57`; `src/v3/operators/registry.js:981`

All three are algebraically identical (verified). Phase 6 adds a third
copy as an inner function inside `registerBuiltins` rather than
importing from a shared location.

**Fix:** Export from a shared
`src/v3/editors/viewport/overlays/overlayUtils.js` (or
`viewportMath.js`) and import at all three sites.

---

## Sister patterns confirmed clean

- `select.linked.cursor` / `selectLinkedExpandSelection` — pure functions,
  no side effects, correct BFS via shared `buildVertexAdjacency`,
  correct handling of isolated verts and empty inputs.
- `duplicate.js` — correctly follows Phase 5 extrude pattern: `beginBatch`
  before `applyTopologyOp`, `discardBatch` on all failure paths,
  `selectionOverride` handed to modal G.
- `verticesInCircle` / `partsInCircle` in `hitTest.js` — correct
  AABB-circle intersection, `node.visible === false` filtered,
  empty-input guard `!(radius > 0)` at top.
- `circleSelectStore` — no race: `mode`/`editPartId` captured at `begin`
  time, not re-read mid-stroke; `radiusPx` preserved across activations.
- Object Mode duplicate root-filter (lines 1157–1162) — correctly skips
  children whose parent is also a new dup, preventing double-translate
  via grandchild inheritance.
- `ApplyMenu` Escape handler — `close()` is called, no stale modal state
  left open.
