# Bone-Mode Refactor Plan

User report (third time, 2026-05-06):
> POSE MODE IS BEHAVING AS ARMATURE EDIT MODE — why have a separate Armature Edit Mode? It's supposed to be like Blender Edit Mode universal.
>
> Why is the user still able to pose bones in Object Mode? Not Blender-like.
>
> Reset Pose button overlays the Layers pill button — third report.

This plan addresses all three. **No code changes here — plan only.** Once approved I'll implement.

---

## Status legend
- ⏳ planned, awaiting greenlight
- 🚧 in progress
- ✅ shipped

---

## 1. Bone-mode consolidation ⏳

### Current state (the mess)

Three editor modes touch bones:

| Mode | `editMode` value | Joint drag target | Rotation arc | Comment |
|---|---|---|---|---|
| Object Mode | `null` | (bails) | **fires!** writes `pose.rotation` or driver param | The legacy "click an arc to rotate without entering edit mode" affordance — never gated, contradicts Blender semantics. |
| Pose Mode | `'skeleton'` | `pose.x/y` (delta) | hidden | BVR-004 introduced this. |
| Armature Edit | `'armatureEdit'` | `transform.pivotX/Y` (rest) + descendants follow | hidden | Also from BVR-004. |

The user perceives **Pose Mode and Armature Edit as the same thing** because:
- Both render the same yellow joint dots in the same positions.
- Both accept drag.
- The visible result of dragging a joint is similar (the bone visually moves; pre-rig the mesh doesn't follow either way).
- The actual write target (`pose.x/y` vs `transform.pivotX/Y`) is invisible in the UI.

**Tab cycles between them** with no obvious cue about which is which. This is a UI cliff.

### Why the dichotomy was introduced (BVR-004 context)

BVR-004 split the single skeleton mode into two so the user could:
- Pose Mode → animate (overlays on rest, non-destructive).
- Armature Edit → fix the rest layout (e.g. shift a pivot that auto-rig got wrong).

The intent was sound, but the **execution shipped two near-identical UIs** that differ only in their write target. Blender's analogous split (Edit Mode vs Pose Mode for armatures) works because Edit Mode shows bone shape/length differently and Pose Mode shows IK / constraints — visually distinct. Ours don't.

### Proposed fix: collapse to ONE bone edit mode

Replace `editMode in {'skeleton', 'armatureEdit'}` with a single `'skeleton'` mode that means **Pose Mode** (animate / pose). Rest editing happens through explicit user action, not a separate mode.

#### Decision matrix

| Affordance | Where it lives now | Where it lives after refactor |
|---|---|---|
| Drag joint to pose | Pose Mode | Pose Mode (unchanged) |
| Rotate bone via arc | Object Mode (!) + Pose Mode hidden | Pose Mode only |
| Modal G/R/S translate/rotate/scale (pose) | Pose Mode | Pose Mode |
| Shift bone pivot (rest edit) | Armature Edit drag joint | **Apply Pose As Rest** — drag in Pose Mode, then bake. Single coherent flow. |
| Modal G/R/S on rest values (`transform.x/y/rotation/scale`) | Armature Edit | Removed. If user needs to fudge rest manually, do it via the Properties → Transform panel (typed numeric). |
| `node.pose.rotation` writes when no driver param exists | Pose Mode | Pose Mode |

#### Why this is OK

- The auto-rig already produces a sensible rest layout. Manual rest editing is the rare case.
- "Pose, then Apply Pose As Rest" is **one** discoverable flow that produces the same outcome as Armature Edit's direct pivot shift.
- Users who do need fine-grained rest tweaks (typed numeric input) get it via the Properties panel — that path already exists.
- One mode → no Tab cycling, no "which write target am I in?" ambiguity, no duplicate UIs.

#### What changes

**Code:**
- `src/store/editorStore.js` — remove `'armatureEdit'` from the `editMode` union. Keep `'skeleton'`.
- `src/components/canvas/SkeletonOverlay.jsx` — remove the `if (editMode === 'armatureEdit') { shiftBonePivot }` branch in joint drag. Keep the `'skeleton'` branch (`pose.x/y` write).
- `src/v3/shell/ModePill.jsx` — remove the "Armature Edit" radio row. Keep "Pose Mode".
- `src/v3/operators/registry.js` — `mode.editToggle` (Tab) cycles Object ↔ Pose Mode for bone-role groups. No three-way cycle.
- `src/store/modalTransformStore.js` — remove the `restFrame` flag + `writeRestValues` dispatch in `ModalTransformOverlay.jsx`. Modal G/R/S in bone selection writes pose only.
- `src/v3/shell/ToolSettingsPanel.jsx` — drop the Armature Edit `ModeHint`. Keep the Pose Mode hint.
- `src/store/projectStore.js` — `shiftBonePivot` action no longer needed at the user-gesture level (Apply Pose As Rest handles it). Keep the function in case other paths need it, but unbind from the Tab/drag UX.

**Deleted concepts:**
- The dual joint-drag write target (rest vs pose) collapses to single-target (pose).
- `editorStore.editMode === 'armatureEdit'` — gone.
- `modalTransformStore.restFrame` — gone.
- `readRestValue` / `writeRestValues` modal dispatch — gone (those helpers can stay in `animationEngine.js` for use by Apply Pose As Rest internals; just not modal-bound).

**Migration:**
- No data shape change — `node.transform.*` and `node.pose.*` slots stay. We just stop letting the user edit `node.transform.*` directly through skeleton-mode UI.

**Risk:** Low–medium. The BVR-004 work that introduced the dichotomy added comprehensive tests for both code paths; pulling Armature Edit out is a careful subtraction, not a rewrite.

**Estimated effort:** 1–2 hours focused work + test sweep.

---

## 2. Object Mode allows bone-pose interaction ⏳

### Current state (the bug)

[`src/components/canvas/SkeletonOverlay.jsx:866`](src/components/canvas/SkeletonOverlay.jsx#L866):
```js
if (!ARC_BONE_ROLES.has(role) || skeletonEditMode) continue;
```
Renders rotation arcs **only when NOT in skeleton edit mode** — i.e. Object Mode is the only mode where arcs appear.

[`src/components/canvas/SkeletonOverlay.jsx:309`](src/components/canvas/SkeletonOverlay.jsx#L309):
```js
if (skeletonEditMode) return;
```
The arc drag handler bails when in skeleton edit mode → only fires in Object Mode.

This is a pre-BVR pattern that survived the refactor: arcs were intended as a "rotate without entering edit mode" shortcut. After BVR established the Pose-Mode-is-the-right-place-to-rotate convention, this affordance contradicts Blender semantics directly.

### Proposed fix

Flip both gates:

```js
// SkeletonOverlay.jsx:866 — render arcs only in Pose Mode
if (!ARC_BONE_ROLES.has(role) || !skeletonEditMode) continue;

// SkeletonOverlay.jsx:309 — accept arc drag only in Pose Mode
if (!skeletonEditMode) return;
```

After mode consolidation (#1), `skeletonEditMode` is exactly Pose Mode (the only bone-aware editor mode left). So:
- **Object Mode**: no arcs rendered, no arc drag accepted. Joint dots still render for selection (click to select bone) but don't accept drag — same as today.
- **Pose Mode**: arcs render, drag rotates the bone (writes pose.rotation or driver param value).

**Files.** `src/components/canvas/SkeletonOverlay.jsx` only — two gate flips.
**Risk.** Zero. Surgical inversion of two booleans.
**Estimated effort.** 5 minutes (after #1 lands).

---

## 3. Reset Pose button overlays Layers pill ⏳ (3rd report)

### Current state — **needs investigation before fix**

The user reported this three times. My previous "fixes" addressed the N-panel toggle position but did NOT address the actual cluster-internal overlap.

The button cluster lives at [`src/components/canvas/CanvasViewport.jsx:2602`](src/components/canvas/CanvasViewport.jsx#L2602):
```jsx
<div className="absolute top-2 right-2 z-10 flex items-stretch gap-px">
  ...Layers... (from <ViewLayersPopover />, mounted in CanvasArea.jsx)
  ...Reset Pose...
  ...chevron (Apply Pose As Rest popover)...
</div>
```

But wait — `<ViewLayersPopover />` is mounted in [`CanvasArea.jsx:120`](src/v3/shell/CanvasArea.jsx#L120) as a **separate sibling** of `<CanvasViewport />`, not inside the Reset Pose flex group. So they're TWO separate absolutely-positioned blocks both at `top-2 right-2`. They overlap because they share the same anchor.

This is the actual bug: two siblings claim the same screen real estate. The user's "third report" makes sense — past patches tweaked offsets but never unified the positioning.

### Investigation needed before plan finalises

- Where exactly does `ViewLayersPopover` anchor? Is it `top-2 right-2` of the same parent as Reset Pose? If so, they stack on top of each other unless deliberately positioned to neighbour.
- Why was `ViewLayersPopover` mounted as a sibling instead of inside Reset Pose's flex group? Was there a constraint?

### Proposed fix (subject to investigation)

**Option A (preferred): merge into one cluster.** Move `<ViewLayersPopover />` from `CanvasArea.jsx` into the Reset Pose flex group in `CanvasViewport.jsx`. They become flex children of the same anchor and sit side-by-side with `gap-px`. Single absolute-positioned block, no overlap possible.

**Option B (fallback): explicit offset.** If Option A breaks something (e.g. wizard mounts ViewLayersPopover differently), keep them separate but give ViewLayersPopover a clear offset (`top-2 right-32` to sit left of Reset Pose).

Option A is cleaner. Investigation will confirm whether it's safe.

**Files (Option A).**
- `src/v3/shell/CanvasArea.jsx` — remove the `<ViewLayersPopover />` mount.
- `src/components/canvas/CanvasViewport.jsx` — add `<ViewLayersPopover />` as the first child of the top-right flex cluster.

**Risk.** Low. Both files already coordinate on this surface.

**Estimated effort.** 30 minutes including verification.

---

## Suggested ship order

1. **Investigation pass** (~15 min) — confirm Layers + Reset Pose mount paths, verify no hidden coupling for `armatureEdit` paths.
2. **#1 mode consolidation** (~1-2 hours) — biggest, touches the most files. Lands first so #2 can use the simplified `skeletonEditMode` semantics.
3. **#2 Object Mode rotation block** (~5 min) — trivial after #1.
4. **#3 button cluster merge** (~30 min) — independent of #1/#2; can land in same commit or separately.

All three in one commit makes sense — they're all "the modes/UI didn't actually become Blender-shaped yet" cleanup, and the user's frustration is unified.

---

## Out of scope (intentionally)

- Animation mode interaction with Pose Mode — current behaviour is preserved (animation is a separate `editorMode`, not a bone-edit mode).
- Apply Pose As Rest pre-rig limitation (separate item in `POST_EXPORT_POLISH_PLAN.md` §4) — orthogonal to the mode consolidation.
- Modal G/R/S keymap changes — keymap stays the same, only the write target consolidates.

---

## Open questions for the user

1. **Should Tab cycle Object ↔ Pose, or do you want Tab to enter Pose only when a bone is selected?** Blender's Tab is context-sensitive (Object ↔ Edit when a meshed object is active, Object ↔ Pose for armatures). I'd default to that pattern unless you want different.
2. **Apply Pose As Rest button location** — earlier you wanted it near the ModePill. Confirming that's still the target after this refactor (it becomes more important since it's the only path to rest-pivot edits).
3. **Any rest-edit affordance that MUST stay (beyond Properties typed input + Apply Pose As Rest)?** If yes, surface it now — easier to keep than to reinstate later.