# Plan: Per-Bone Rotation Arc Handles in SkeletonOverlay

## Context
Posing a rigged character currently requires: navigate to Groups tab → scroll to find a bone → click to select → drag the orange rotation handle from GizmoOverlay. This is too many steps. The fix is to add rotation arc handles directly to the SkeletonOverlay so users can drag any bone's arc to rotate it instantly, in both staging and animation modes.

---

## Approach

Extend `SkeletonOverlay.jsx` to render a circular arc handle around each animatable bone joint (all roles except `root` and `eyes`). Dragging the arc rotates that bone — in staging mode writes directly to `node.transform.rotation`; in animation mode writes to `animationStore.draftPose` (user presses K to keyframe). Clicking a joint circle selects the group node so GizmoOverlay also appears for fine-tuning.

The implementation mirrors GizmoOverlay exactly: `effectiveNodes` memo, `worldMap` for correct pivot screen positions after parent chain rotations, stable `useRef` refs to avoid stale closures, and `atan2` rotation delta computation.

---

## Changes

### `src/components/canvas/SkeletonOverlay.jsx` (primary)

**1. Add imports**
```js
import { useEditorStore } from '@/store/editorStore';
import { useAnimationStore } from '@/store/animationStore';
import { computeWorldMatrices, mat3Identity } from '@/renderer/transforms';
import { computePoseOverrides } from '@/renderer/animationEngine';
```

**2. New constants (after existing colour constants)**
```js
const ARC_BONE_ROLES = new Set(['torso','head','leftArm','rightArm','bothArms','leftLeg','rightLeg','bothLegs']);
const ARC_RADIUS    = 28;   // screen px
const ARC_SWEEP_DEG = 270;  // coverage
const ARC_COLOUR    = 'rgba(251,191,36,0.55)';
const ARC_ACTIVE    = 'rgba(251,191,36,0.95)';
const ARC_STROKE_W  = 5;
```

**3. `arcPath` helper (after `toImage`)**
```js
function arcPath(cx, cy, r, startDeg, sweepDeg) {
  const half = sweepDeg / 2;
  const a1 = (startDeg - half) * (Math.PI / 180);
  const a2 = (startDeg + half) * (Math.PI / 180);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}
```

**4. New store subscriptions (in component body, after existing `useProjectStore` calls)**
```js
const setSelection = useEditorStore(s => s.setSelection);
const animations   = useProjectStore(s => s.project.animations);
const animCurrentTime       = useAnimationStore(s => s.currentTime);
const animActiveAnimationId = useAnimationStore(s => s.activeAnimationId);
const animDraftPose         = useAnimationStore(s => s.draftPose);
const setDraftPose          = useAnimationStore(s => s.setDraftPose);
```

**5. Stable refs (mirrors GizmoOverlay pattern)**
```js
const viewRef         = useRef(view);
const editorModeRef   = useRef(editorMode);
const setDraftPoseRef = useRef(setDraftPose);
useEffect(() => { viewRef.current = view; },               [view]);
useEffect(() => { editorModeRef.current = editorMode; },   [editorMode]);
useEffect(() => { setDraftPoseRef.current = setDraftPose; },[setDraftPose]);
```

**6. `effectiveNodes` memo (exact copy of GizmoOverlay's, placed after `boneNodes` memo)**
```js
const ANIM_KEYS = ['x','y','rotation','scaleX','scaleY','hSkew'];
const effectiveNodes = useMemo(() => {
  if (editorMode !== 'animation') return nodes;
  const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
  const overrides  = computePoseOverrides(activeAnim, animCurrentTime);
  const hasDraft   = animDraftPose.size > 0;
  if (!overrides.size && !hasDraft) return nodes;
  return nodes.map(node => {
    const ov = overrides.get(node.id);
    const dr = animDraftPose.get(node.id);
    if (!ov && !dr) return node;
    const tr = { ...node.transform };
    if (ov) for (const k of ANIM_KEYS) { if (ov[k] !== undefined) tr[k] = ov[k]; }
    if (dr) for (const k of ANIM_KEYS) { if (dr[k] !== undefined) tr[k] = dr[k]; }
    return { ...node, transform: tr, opacity: dr?.opacity ?? ov?.opacity ?? node.opacity };
  });
}, [editorMode, nodes, animations, animActiveAnimationId, animCurrentTime, animDraftPose]);
```

Change the `boneNodes` memo to iterate `effectiveNodes` (not `nodes`) so positions reflect animation state.

**7. Rewrite `dragRef` shape with a `type` discriminant**
```js
// joint-position drag (skeletonEditMode):
{ type: 'joint', nodeId }

// rotation arc drag (always active outside skeletonEditMode):
{ type: 'rotate', nodeId, startAngle, startRotation, pivotScreenX, pivotScreenY, isAnimMode }
```

**8. Rewrite `onPointerDown(e, nodeId, dragType)`**
- `'joint'` drag: only active when `skeletonEditMode === true` (unchanged behavior)
- `'rotate'` drag: active when `skeletonEditMode === false`; uses `effectiveNodes` + `computeWorldMatrices` to get correct pivot screen coords; stores `startAngle = atan2(cursorY - pivotScreenY, cursorX - pivotScreenX)`; also calls `setSelection([nodeId])` so GizmoOverlay appears
- Clicking a joint circle in non-edit mode: calls `setSelection([nodeId])` without starting a drag

**9. Rewrite `onPointerMove` for both drag types**
- `'joint'`: existing logic (unchanged)
- `'rotate'`: `delta = (atan2(dy,dx) - startAngle) × 180/π`; Shift-key snaps to 15° increments; staging → `updateProject(node.transform.rotation = startRotation + delta)`; animation → `setDraftPoseRef.current(nodeId, { rotation: startRotation + delta })`
- Lock the `pivotScreenX/Y` from drag-start (do NOT recompute per frame — pivot drifts as the node rotates)

**10. Update early-exit guard**
```js
// Allow both staging and animation modes
if (!hasArmature || !showSkeleton) return null;
if (editorMode !== 'staging' && editorMode !== 'animation') return null;
```

**11. Compute `worldMap` and `pivotScreenPos()` in render path** (after the guard)
```js
const worldMap = computeWorldMatrices(effectiveNodes);
function pivotScreenPos(node) {
  const wm = worldMap.get(node.id) ?? mat3Identity();
  const wx = wm[0]*node.transform.pivotX + wm[3]*node.transform.pivotY + wm[6];
  const wy = wm[1]*node.transform.pivotX + wm[4]*node.transform.pivotY + wm[7];
  return [wx * zoom + panX, wy * zoom + panY];
}
```

Replace the `toScreen(node.transform.pivotX, ...)` calls in the lines/circles loops with `pivotScreenPos(node)`.

**12. Build `arcs` array** (rendered below lines and circles in z-order)
```jsx
const arcs = [];
for (const [role, node] of Object.entries(boneNodes)) {
  if (!ARC_BONE_ROLES.has(role) || skeletonEditMode) continue;
  const [cx, cy] = pivotScreenPos(node);
  const wm = worldMap.get(node.id) ?? mat3Identity();
  // Orient gap along local Y-axis (upward from pivot)
  const arcOrientDeg = Math.atan2(wm[4], wm[3]) * (180 / Math.PI) - 90;
  const isActive = dragRef.current?.type === 'rotate' && dragRef.current?.nodeId === node.id;
  arcs.push(
    <path key={`arc-${role}`}
      d={arcPath(cx, cy, ARC_RADIUS, arcOrientDeg, ARC_SWEEP_DEG)}
      fill="none" stroke={isActive ? ARC_ACTIVE : ARC_COLOUR}
      strokeWidth={ARC_STROKE_W} strokeLinecap="round"
      style={{ cursor: 'alias', pointerEvents: 'visibleStroke' }}
      onPointerDown={(e) => onPointerDown(e, node.id, 'rotate')}
    />
  );
}
```

**13. SVG container: set `pointerEvents: 'none'` on container**; put `pointerEvents: 'auto'` explicitly on each arc `<path>` and joint `<circle>`. Pointer capture (`setPointerCapture`) bypasses hit-testing so `onPointerMove`/`onPointerUp` on the SVG still fire during drag.

**14. SVG child order**: `{arcs}` first (behind), then `{lines}`, then `{circles}` (on top).

---

### `src/components/canvas/CanvasViewport.jsx` (minor)

**Skeleton toolbar condition**: Change `editorState.editorMode === 'staging'` → `editorState.editorMode !== 'animation' || editorState.editorMode === 'animation'` (i.e., always show when rig exists). Simpler: remove the mode check for "Show/Hide Skeleton" button, keep "Edit Joints" conditional on staging only:
```jsx
{project.nodes.some(n => n.type === 'group' && n.boneRole) && (
  <div ...>
    <button onClick={() => setShowSkeleton(...)}>...</button>
    {editorState.editorMode === 'staging' && (
      <button onClick={() => setSkeletonEditMode(...)}>...</button>
    )}
  </div>
)}
```

---

## Files modified
- `src/components/canvas/SkeletonOverlay.jsx` — primary changes
- `src/components/canvas/CanvasViewport.jsx` — toolbar condition only

## Files referenced (no changes)
- `src/renderer/transforms.js` — `computeWorldMatrices`, `mat3Identity`
- `src/renderer/animationEngine.js` — `computePoseOverrides`
- `src/store/animationStore.js` — `setDraftPose`
- `src/store/editorStore.js` — `setSelection`
- `src/components/canvas/GizmoOverlay.jsx` — pattern to mirror exactly

---

## Verification
1. Import a see-through PSD and auto-rig with DWPose
2. In **Staging mode**: drag an arc (e.g., `leftArm`) → arm rotates; Shift-drag → snaps to 15°; clicking joint circle → GizmoOverlay appears
3. In **Animation mode**: drag an arc → rotation shows but is NOT committed to project; press K → keyframe inserted; scrub timeline → bone animates
4. Skeleton edit mode: arcs hidden, joint dots draggable for pivot repositioning (unchanged behavior)
5. Parent chain: rotate `torso` → `head`/`leftArm` children follow correctly (world matrix handles hierarchy)
