# Undo/Redo System Implementation

## Overview

The Undo/Redo system enables users to revert and restore changes to the animation project through snapshot-based history management. Every undoable mutation flows through a single injection point (`updateProject` in projectStore.js), where snapshots are automatically captured. Continuous operations (drag, slider scrub) are batched to suppress intermediate snapshots, ensuring Ctrl+Z jumps to meaningful states.

**Status**: Complete (M7 feature)  
**Implementation Date**: 2026-04-17  
**Files Modified**: 7 | **Files Created**: 1

---

## Architecture

### Core Insight

Every mutation in the app flows through `updateProject(recipe, opts)` in `projectStore.js`. Rather than tracking 30+ individual call sites, we auto-snapshot inside `updateProject` before each mutation. Add a `beginBatch` / `endBatch` mechanism for continuous drag/slider operations so only one snapshot is captured per gesture, not one per frame.

### History Mechanism

```
[User Action]
  ├─ (if not batching) → pushSnapshot(project)  [capture pre-mutation state]
  ├─ updateProject(recipe)                       [apply mutation]
  └─ (if batching) → skip snapshot

[User Undo: Ctrl+Z]
  ├─ undo(currentProject, applyFn)
  ├─ Pop snapshot from _snapshots
  ├─ Push currentProject to _redoStack
  └─ applyFn(snapshot)                           [restore project state]

[User Redo: Ctrl+Y or Shift+Ctrl+Z]
  ├─ redo(currentProject, applyFn)
  ├─ Pop snapshot from _redoStack
  ├─ Push currentProject to _snapshots
  └─ applyFn(snapshot)                           [restore project state]
```

### Batching for Continuous Operations

```
[User starts slider drag]
  └─ onPointerDown → beginBatch(project)         [_batchDepth++, snapshot if first]

[User moves slider continuously]
  └─ onChange calls updateProject → isBatching() returns true → skip snapshot

[User releases slider]
  └─ onPointerUp → endBatch()                    [_batchDepth--]

Result: One snapshot for entire drag gesture, Ctrl+Z jumps to pre-drag state.
```

### No Circular Dependencies

- `src/store/undoHistory.js` is pure JS with zero imports from the store or React
- `src/store/projectStore.js` imports `pushSnapshot`, `isBatching`, `clearHistory` from undoHistory
- `src/hooks/useUndoRedo.js` imports `undo`, `redo` from undoHistory
- `src/components/*` import `beginBatch`, `endBatch` from undoHistory as needed

---

## Implementation Details

### 1. Core Module: `src/store/undoHistory.js`

**Purpose**: Pure JS module managing undo/redo history stacks and batch operations.

**State**:
```javascript
let _snapshots = [];   // Past project snapshots (max 50)
let _redoStack  = [];  // Redo stack
let _batchDepth = 0;   // >0 means inside a continuous gesture
```

**Key Functions**:

#### `pushSnapshot(project)`
- Deep clones the project using `structuredClone()` (preserves Float32Array, Set, Map)
- Pushes to `_snapshots` array (kept to MAX_HISTORY=50)
- Clears `_redoStack` (any new mutation after undo invalidates redo history)

**Critical detail**: Uses `structuredClone()` not `JSON.parse(JSON.stringify())` because:
- Float32Array (used for mesh UVs) becomes `{}` when JSON serialized — undo would lose all texture coordinates
- structuredClone correctly preserves all typed array data

#### `beginBatch(project)`
- If `_batchDepth === 0`, capture one snapshot
- Increment `_batchDepth` to mark we're inside a continuous gesture
- Subsequent `updateProject` calls see `isBatching() === true` and skip snapshots

#### `endBatch()`
- Decrement `_batchDepth` safely (never goes negative)
- Once 0, next `updateProject` will snapshot again

#### `isBatching()`
- Returns `true` if `_batchDepth > 0` (used by projectStore to skip snapshots)

#### `undo(currentProject, applyFn)`
- Pop from `_snapshots` array (if available)
- Push `currentProject` to `_redoStack` for redo capability
- Call `applyFn(snapshot)` to restore project state

#### `redo(currentProject, applyFn)`
- Pop from `_redoStack` (if available)
- Push `currentProject` to `_snapshots` (it becomes the new "past" state)
- Call `applyFn(snapshot)` to restore project state

#### `clearHistory()`
- Wipe all history on project load/reset so stale history doesn't leak
- Called in `loadProject()` and `resetProject()` to prevent undo beyond the new project boundary

---

### 2. Injection Point: `src/store/projectStore.js`

**Import**:
```javascript
import { pushSnapshot, isBatching, clearHistory } from '@/store/undoHistory';
```

**Modified updateProject signature**:
```javascript
updateProject: (recipe, { skipHistory = false } = {}) => {
  set((state) => {
    if (!skipHistory && !isBatching()) {
      pushSnapshot(state.project);
    }
    return produce((draft) => {
      recipe(draft.project, draft.versionControl);
    })(state);
  });
}
```

**Logic**:
- Before applying the recipe, check if we should snapshot
- Skip if `skipHistory: true` (used when applying undo/redo — prevents double-snapshot)
- Skip if `isBatching()` is true (continuous gesture in progress)
- Only auto-snapshot for discrete mutations

**Called in**:
- `resetProject()`: Calls `clearHistory()` first
- `loadProject()`: Calls `clearHistory()` first

**Callers remain unchanged**: All existing `updateProject(recipe)` calls work as before (no second argument, defaults to `{ skipHistory: false })`

---

### 3. Keyboard Handler: `src/hooks/useUndoRedo.js`

**REWRITTEN** to use undoHistory module instead of inline snapshot arrays.

**Key pattern**:
```javascript
import { undo, redo } from '@/store/undoHistory';

export function useUndoRedo() {
  const updateProject = useProjectStore(s => s.updateProject);
  const projectRef = useRef(null);

  // Subscribe to project changes to keep projectRef updated
  useEffect(() => {
    return useProjectStore.subscribe((state) => {
      projectRef.current = state.project;
    });
  }, []);

  // Keyboard handler
  useEffect(() => {
    const handler = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';

      if (isZ && !e.shiftKey) {
        // Ctrl+Z → Undo
        e.preventDefault();
        undo(projectRef.current, (snapshot) => {
          updateProject((proj) => {
            Object.assign(proj, snapshot);
          }, { skipHistory: true });
        });
      } else if (isY || (isZ && e.shiftKey)) {
        // Ctrl+Y or Ctrl+Shift+Z → Redo
        e.preventDefault();
        redo(projectRef.current, (snapshot) => {
          updateProject((proj) => {
            Object.assign(proj, snapshot);
          }, { skipHistory: true });
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [updateProject]);
}
```

**Important detail**: `skipHistory: true` prevents the undo/redo application itself from pushing another snapshot. Without this, applying a snapshot would trigger `pushSnapshot()` and create a new history entry, breaking the undo chain.

---

### 4. Batching Slider Changes: `src/components/inspector/Inspector.jsx`

**Import**:
```javascript
import { beginBatch, endBatch } from '@/store/undoHistory';
```

**Modified SliderRow**:
```javascript
function SliderRow({ label, value, min, max, step = 1, onChange, help }) {
  return (
    <div
      className="space-y-1 py-0.5"
      onPointerDown={() => beginBatch(useProjectStore.getState().project)}
      onPointerUp={endBatch}
    >
      {/* Shadcn Slider component inside */}
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}
```

**Effect**:
- User touches slider thumb → `onPointerDown` captures one snapshot
- User drags slider → rapid onChange calls → `updateProject` sees `isBatching() === true` → skip snapshots
- User releases slider → `onPointerUp` ends batch
- Result: Ctrl+Z jumps to the opacity before the drag started

**Applies to**:
- Opacity slider
- Blend shape influence sliders
- Mesh offset sliders (deformer settings)

---

### 5. Batching Gizmo Drags: `src/components/canvas/GizmoOverlay.jsx`

**Import**:
```javascript
import { beginBatch, endBatch } from '@/store/undoHistory';
```

**Pattern in drag handlers** (startMoveDrag, startRotateDrag, startPivotDrag):
```javascript
const startMoveDrag = useCallback((e, nodeId) => {
  if (editorModeRef.current === 'staging') {
    beginBatch(useProjectStore.getState().project);
  }
  dragRef.current = { nodeId, startX: e.clientX, ... };
  
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
}, []);

const onDragMove = useCallback((e) => {
  // ... compute delta ...
  updateProject((proj) => {
    proj.nodes[nodeId].x += deltaX;
  }, { skipHistory: true });  // ← skipHistory: true
}, []);

const onDragEnd = useCallback(() => {
  endBatch();
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
}, []);
```

**Effect**:
- User grabs gizmo handle → `beginBatch()` captures snapshot (only in staging mode)
- Gizmo drag fires 60+ pointermove events → all `updateProject` calls use `skipHistory: true` and see `isBatching() === true` → skip snapshots
- User releases → `endBatch()`
- Result: Ctrl+Z jumps to pre-drag position, not intermediate positions

---

### 6. Batching Skeleton Drags: `src/components/canvas/SkeletonOverlay.jsx`

**Import**:
```javascript
import { beginBatch, endBatch } from '@/store/undoHistory';
```

**Puppet pin drag pattern**:
```javascript
const onPointerDown = useCallback((e, nodeId, pinIndex) => {
  if (editorModeRef.current === 'staging') {
    beginBatch(useProjectStore.getState().project);
  }
  dragRef.current = { nodeId, pinIndex, startX: e.clientX, ... };
  
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}, []);

const onPointerMove = useCallback((e) => {
  const delta = e.clientX - dragRef.current.startX;
  updateProject((proj) => {
    proj.nodes[nodeId].puppetPins[pinIndex].x += delta;
  }, { skipHistory: true });  // ← skipHistory: true
}, []);

const onPointerUp = useCallback(() => {
  endBatch();
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}, []);
```

**Applies to**:
- Puppet pin repositioning
- Bone rotation drags (trackpad rotate, arc handle rotation)
- Bone position drags (skeletal rig)

---

### 7. Batching Timeline Drags: `src/components/timeline/TimelinePanel.jsx`

**Import**:
```javascript
import { beginBatch, endBatch } from '@/store/undoHistory';
```

**Keyframe drag pattern** (~line 790):
```javascript
const onKeyframePointerDown = useCallback((e, nodeId, keyframeTime) => {
  beginBatch(useProjectStore.getState().project);
  dragRef.current = { nodeId, keyframeTime, startX: e.clientX };
  
  const handleMove = (moveEvent) => {
    const delta = moveEvent.clientX - dragRef.current.startX;
    updateProject((proj) => {
      // Move keyframe to new time
    }, { skipHistory: true });  // ← skipHistory: true
  };
  
  const handleUp = () => {
    endBatch();
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
  };
  
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
}, []);
```

**Audio track drag pattern**:
```javascript
const handleBarDrag = (e) => {
  beginBatch(useProjectStore.getState().project);
  
  const handleMove = (moveEvent) => {
    const newStart = computeAudioStart(moveEvent);
    updateProject((proj) => {
      proj.audioTracks[trackId].startTime = newStart;
    }, { skipHistory: true });  // ← skipHistory: true
  };
  
  const handleUp = () => {
    endBatch();
    // cleanup
  };
  
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
};
```

---

## Problems Encountered and Fixed

### Problem 1: Puppet Pin Undo Glitch (GPU Buffer Lag)

**Symptom**: After undoing a puppet pin drag, the app flickered between the undoed state (pin back to original position, no mesh deformation) and the deformed state (pin dragged, mesh warped) when the user selected or deselected the layer.

**Root Cause**: One-frame lag in GPU buffer synchronization.

The flow was:
1. User undoes puppet pin drag → project state reverted (pin position and mesh UVs back to original)
2. `sceneRef.current.draw()` called with reverted project
3. Draw command uses the **previous frame's GPU mesh vertices** (still deformed)
4. **After** draw completes, `sceneRef.current.parts.uploadPositions()` is called
5. GPU buffer now has correct (un-deformed) vertices, but they weren't used in this frame's render
6. Next frame rendered with correct vertices
7. User clicks to select/deselect layer → triggers dirty flag → scene re-renders
8. Now render uses correct GPU buffer → layer looks normal

The flicker was frame: render with old GPU buffer (deformed) then render with new buffer (un-deformed).

**Solution**: Reorder GPU mesh upload to occur **BEFORE** the draw call in `src/components/canvas/CanvasViewport.jsx` (around line 341).

**Before**:
```javascript
// Line 341 (rAF tick)
sceneRef.current.draw(...);
sceneRef.current.parts.uploadPositions();  // ← happens after draw
```

**After**:
```javascript
// Line 341 (rAF tick)
sceneRef.current.parts.uploadPositions();  // ← happens before draw
sceneRef.current.draw(...);
```

**Effect**: GPU buffer is synchronized within the same frame as the draw call. No one-frame lag, no flickering on undo.

**Comment added at the fix location**:
```javascript
// Upload deformed mesh positions BEFORE draw, not after.
// Otherwise there's a one-frame lag: draw uses old GPU buffer, then new positions upload.
// This caused puppet pin undo to flicker (showing deformed mesh for one frame).
sceneRef.current.parts.uploadPositions();
sceneRef.current.draw(...);
```

---

### Problem 2: Texture Invisibility After Puppet Pin Undo

**Symptom**: When undoing a puppet pin movement, the entire layer became invisible (no texture visible, only vertices and skeleton visible). When saving and reloading the project, no textures loaded at all — all layers were invisible except the skeleton overlay.

**Root Cause**: Typed array corruption during snapshot serialization.

The original undoHistory.js used `JSON.parse(JSON.stringify(project))` for snapshots:
```javascript
// BUGGY CODE:
export function pushSnapshot(project) {
  _snapshots.push(JSON.parse(JSON.stringify(project)));  // ← JSON doesn't preserve Float32Array
  // ...
}
```

When a Float32Array (used for mesh UVs) is JSON serialized:
```javascript
const uvs = new Float32Array([0.0, 0.0, 1.0, 1.0]);
JSON.stringify({ uvs });  // → {"uvs":{}}  (empty object!)
JSON.parse('{"uvs":{}}');  // → { uvs: {} }
```

After undo, `node.mesh.uvs` was an empty object `{}` instead of Float32Array. Texture sampling code expected:
```javascript
// In shader/sampling code:
const u = uvs[index * 2];      // ← trying to index an object!
const v = uvs[index * 2 + 1];  // ← results in undefined
```

Texture coordinates became undefined, texture sampling failed, layer became invisible.

When saving to file, the empty object was written to disk. On reload, no UV data was available, textures couldn't load.

**Solution**: Replace all three `JSON.parse(JSON.stringify(...))` calls in `src/store/undoHistory.js` with `structuredClone(...)`:

```javascript
// Line 19 - pushSnapshot()
export function pushSnapshot(project) {
  _snapshots.push(structuredClone(project));  // ← preserves Float32Array
  if (_snapshots.length > MAX_HISTORY) _snapshots.shift();
  _redoStack = [];
}

// Line 58 - undo()
export function undo(currentProject, applyFn) {
  if (_snapshots.length === 0) return;
  const prev = _snapshots.pop();
  _redoStack.push(structuredClone(currentProject));  // ← preserves Float32Array
  applyFn(prev);
}

// Line 70 - redo()
export function redo(currentProject, applyFn) {
  if (_redoStack.length === 0) return;
  const next = _redoStack.pop();
  _snapshots.push(structuredClone(currentProject));  // ← preserves Float32Array
  applyFn(next);
}
```

**Why structuredClone works**:
- Correctly handles Float32Array, Uint8Array, Set, Map, Date, and other typed data
- Deep clones nested objects and arrays
- Preserves object identity for circular references
- No JSON serialization — no enumerable-property limitation

**Effect**: Undo/redo now correctly preserves all mesh data, texture coordinates remain valid, layers stay visible after undo.

---

## What Is and Isn't Undoable

| Operation | Undoable | Mechanism |
|-----------|----------|-----------|
| Transform (x, y, rotation, scale, pivot) — NumericInput | Yes | Auto-snapshot per commit (on blur/Enter) |
| Opacity, blend shape influence sliders | Yes | Batched per gesture |
| Add/delete blend shape | Yes | Auto-snapshot |
| Add/remove puppet pin | Yes | Auto-snapshot |
| Gizmo drag (position, rotation, scale) | Yes | Batched per gesture |
| Skeleton bone drag | Yes | Batched per gesture |
| Keyframe add/delete | Yes | Auto-snapshot |
| Keyframe drag | Yes | Batched per gesture |
| Audio track add/trim/move | Yes | Batched per gesture |
| Mesh generate / remesh | Yes | Auto-snapshot |
| Group create / reparent | Yes | Auto-snapshot |
| Load project / reset | No — clears history | `clearHistory()` on load |
| Draft pose changes (animation mode) | No — draftPose not in project | animationStore only |
| Undo/redo application itself | No | `skipHistory: true` |
| Selection, zoom, pan (editorStore) | No | editorStore not touched |

---

## Usage Patterns for Developers

### Adding a New Undoable Operation

If you add a new mutation to the app:

1. **Ensure it goes through `updateProject()`**: Most mutations already do. If not, refactor to use updateProject.

   ```javascript
   // Good: auto-snapshots before mutation
   updateProject((proj) => {
     proj.nodes[nodeId].newProperty = value;
   });
   ```

2. **For discrete mutations (NumericInput commit, button click)**: No extra code needed. updateProject auto-snapshots.

3. **For continuous operations (drag, slider)**: Wrap with beginBatch/endBatch.

   ```javascript
   onPointerDown: () => beginBatch(useProjectStore.getState().project),
   onPointerMove: () => updateProject(recipe, { skipHistory: true }),
   onPointerUp: () => endBatch(),
   ```

### Adding Undo UI Indicators

To show whether undo/redo are available:

```javascript
// In a component:
const undoCount = useUndoHistoryStore?.((state) => state.undoCount);
const redoCount = useUndoHistoryStore?.((state) => state.redoCount);

// Currently: no UI store exposes undo/redo counts
// To add: export undoCount() and redoCount() from undoHistory.js
// Create a hook to expose these to React components
```

**Note**: The current implementation doesn't expose an undoHistory store to React. If you need UI buttons showing "Undo disabled" / "Redo enabled", either:
- Create a custom hook that subscribes to the history module
- Or refactor undoHistory.js into a Zustand store for consistency with the rest of the app

---

## Verification Checklist

- [x] Basic undo: Change a transform field (blur to commit) → Ctrl+Z → value reverts
- [x] Redo: After undo → Ctrl+Y → value restores
- [x] Slider batching: Drag opacity slider — Ctrl+Z jumps to opacity before drag started
- [x] Gizmo drag batching: Drag node in viewport — Ctrl+Z jumps to pre-drag position
- [x] Keyframe batching: Drag keyframe in timeline — Ctrl+Z restores to pre-drag frame
- [x] Stack limit: Make 55 changes — verify only 50 in history (oldest dropped)
- [x] Load clears history: Load project → Ctrl+Z does nothing (history cleared)
- [x] Puppet pin undo: Drag puppet pin, undo → pin position and mesh deformation both revert (no flickering)
- [x] Texture preservation: After puppet pin undo, textures remain visible and correct

---

## Testing

### Unit Testing Opportunities

If you add tests, consider:

1. **pushSnapshot/undo/redo cycle**:
   ```javascript
   // Snapshot a project, mutate it, undo, verify state reverts
   const orig = { nodes: { n1: { x: 0 } } };
   pushSnapshot(orig);
   const mutated = { nodes: { n1: { x: 100 } } };
   undo(mutated, (snap) => {
     assert(snap.nodes.n1.x === 0);
   });
   ```

2. **Batch isolation**:
   ```javascript
   // Three updates in batch should produce only one snapshot
   beginBatch(project);
   updateProject(recipe1);
   updateProject(recipe2);
   updateProject(recipe3);
   endBatch();
   assert(undoCount() === 1);  // One snapshot, not three
   ```

3. **Float32Array preservation**:
   ```javascript
   // Snapshot with Float32Array, undo, verify array type preserved
   const proj = { mesh: { uvs: new Float32Array([0, 1, 2, 3]) } };
   pushSnapshot(proj);
   undo(mutated, (snap) => {
     assert(snap.mesh.uvs instanceof Float32Array);
     assert(snap.mesh.uvs[0] === 0);
   });
   ```

### Manual Testing Scenarios

1. **Transform undo**: NumericInput for X/Y/rotation → press Tab/Enter → Ctrl+Z → value reverts
2. **Multi-step undo**: Make 5 changes (each discrete) → Ctrl+Z 5 times → back to start
3. **Slider undo**: Grab opacity slider, drag across range → release → Ctrl+Z → opacity before drag
4. **Complex drag**: In viewport, drag node + rotate + scale via gizmo → release → Ctrl+Z → all reverts
5. **Redo after undo**: Change value → undo → redo → value back
6. **Redo invalidation**: Change → undo → make new change → Ctrl+Y does nothing (redo stack cleared)
7. **Animation mode isolation**: In animation mode, drag to adjust draftPose → Ctrl+Z does nothing (draftPose not in project)

---

## Known Limitations and Future Work

### Current Limitations

1. **No UI for undo/redo counts**: The keyboard handler works (Ctrl+Z/Y), but no UI button shows "Undo disabled" state.
   - **Future**: Export undoCount/redoCount from undoHistory.js, create a hook, add toolbar button.

2. **No "undo" indicator on stale snapshots**: After loading a project, history is cleared. No visual feedback.
   - **Future**: Toast notification "History cleared" on project load.

3. **History not persisted across sessions**: Undo history is in memory only, lost on page reload.
   - **Current by design**: Snapshots are full project clones (50 * ~1MB = 50MB footprint). Not practical to persist.
   - **Future**: Optional IndexedDB persistence with configurable max size.

4. **No grouped undo**: Multiple related changes (e.g., "add blend shape + set influence") create separate history entries.
   - **Future**: Add `groupUndoStart()` / `groupUndoEnd()` API to batch logically related updates.

### Future Enhancements

- [ ] Undo/Redo UI buttons with enabled/disabled states
- [ ] Toast notification on history limit reached
- [ ] Undo history sidebar (show previous states)
- [ ] Optional IndexedDB persistence for history
- [ ] Grouped undo (batch multiple updates into one history entry)
- [ ] Undo diff visualization (show what changed)

---

## Technical Notes

### Why structuredClone Instead of JSON?

```javascript
// JSON doesn't preserve typed arrays:
const uvs = new Float32Array([0, 1, 2, 3]);
const json = JSON.stringify({ uvs });           // → '{"uvs":{}}'
const restored = JSON.parse(json);
restored.uvs instanceof Float32Array;           // → false
restored.uvs[0];                                // → undefined

// structuredClone preserves them:
const clone = structuredClone({ uvs });
clone.uvs instanceof Float32Array;              // → true
clone.uvs[0];                                   // → 0
```

**Cost**: structuredClone is slightly slower than JSON for serializable data, but correctly handles all JS types. Given snapshots are captured on discrete mutations (not per-frame), the performance impact is negligible.

### Why isBatching Check in updateProject?

Without the batching check, every pointer move during a drag would push a snapshot:
```javascript
// Slider drag (60 FPS):
onPointerDown → snapshot #1
onChange → snapshot #2
onChange → snapshot #3
onChange → snapshot #4
... (58 more snapshots)
onPointerUp → done
// History now has 60 entries for a single slider gesture!
```

With batching:
```javascript
onPointerDown → snapshot #1, _batchDepth = 1
onChange → isBatching() = true → skip snapshot
onChange → isBatching() = true → skip snapshot
... (58 more skipped)
onPointerUp → _batchDepth = 0
// History has 1 entry for the entire gesture
```

### Why Separate skipHistory Parameter?

When applying undo/redo, we call `updateProject(recipe, { skipHistory: true })`. This prevents the undo application itself from pushing another snapshot.

Without it:
```javascript
// User presses Ctrl+Z
undo(currentProject, (snapshot) => {
  updateProject((proj) => {
    Object.assign(proj, snapshot);  // ← missing { skipHistory: true }
  });
});

// Flow:
// 1. updateProject sees mutation
// 2. Checks: not batching, skipHistory = false
// 3. Pushes current state to _snapshots (the state we're trying to undo!)
// 4. Applies recipe
// 5. Result: We pushed the "after" state, then jumped back to "before"
//    Pressing undo again would just redo it — infinite loop
```

With `skipHistory: true`, the undo application itself doesn't snapshot, preserving the history chain.

---

## Files Summary

| File | Type | Changes | Lines |
|------|------|---------|-------|
| undoHistory.js | New | History stacks, batch logic, snapshot/undo/redo functions | 81 |
| projectStore.js | Modified | Import from undoHistory, add skipHistory param to updateProject, clearHistory calls | ~20 |
| useUndoRedo.js | Rewritten | Use undoHistory module, keyboard handler for Ctrl+Z/Y | ~50 |
| Inspector.jsx | Modified | Import beginBatch/endBatch, wrap SliderRow with batching | ~5 |
| GizmoOverlay.jsx | Modified | Import beginBatch/endBatch, batch drag operations | ~10 |
| SkeletonOverlay.jsx | Modified | Import beginBatch/endBatch, batch puppet pin drags | ~10 |
| TimelinePanel.jsx | Modified | Import beginBatch/endBatch, batch keyframe and audio drags | ~15 |
| CanvasViewport.jsx | Modified | Reorder GPU mesh upload before draw (fix GPU buffer lag) | 1 |

**Total additions**: ~170 lines  
**Total modifications**: ~60 lines  
**Total bugs fixed**: 2 (GPU buffer lag, typed array serialization)

---

## References

- [MDN: structuredClone()](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone)
- [MDN: Float32Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float32Array)
- [Immer Draft Objects](https://immerjs.github.io/immer/)
- [Zustand State Management](https://github.com/pmndrs/zustand)
- [Stretchy Studio Architecture](../README.md)
