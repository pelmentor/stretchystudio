# Phase 7.C Architecture Audit (2026-05-11)

Reviewed commit `fbf7f82` (master). Files examined: all 8 in scope —
`poseClipboardStore.js`, `clearTransform.js`, `pose/mirror.js`,
`registry.js` (10 new `pose.*` registrations + imports), `default.js`
(14 new keymap entries), and the 6 new test files
(`test_poseMode_{clearLoc,clearRot,clearScale,clearAll,mirrorPose,copyPaste}.mjs`).

Traced chord-builder ordering, pose write paths against v19 schema
shape, undo/batch discipline, dispatcher fallthrough for Ctrl+C/V,
selection model coherence, and test coverage gaps.

Phase 7.A/B lessons confirmed closed: all 10 `exec` callbacks are sync
(no `await`, no `async`); all operator modules are eagerly imported at
the top of `registry.js` (lines 59-60); all `beginBatch` calls in
the 4 clear-impl functions pass `project` from
`useProjectStore.getState().project`. No phantom undo snapshots — every
`beginBatch` call is guarded by an early-return that fires before it.

---

## Summary

5 gaps found: **1 HIGH, 2 MED, 2 LOW.**

| ID  | Sev  | One-line |
|-----|------|----------|
| G-1 | HIGH | `Alt+Shift+KeyG/R/S` keymap entries will never fire — `chordOf` builds `Shift+Alt+` order; the three "Clear All" operators are permanently unreachable via keyboard |
| G-2 | MED  | `applyClear` and `posePaste` write directly to `node.pose.{x,y,rotation,...}` but `getBonePose` reads `node.pose.channels[boneId]` for v19-migrated data; any project saved pre-v19 will silently fail to clear/paste |
| G-3 | MED  | `poseCopy` clears the clipboard when called with no selected bones, even though the `available()` gate prevents keyboard invocation — direct programmatic calls (future Pose Library code, scripts) will silently destroy the clipboard |
| G-4 | LOW  | No test exercises v19-shape `node.pose = {channels:{...}}` data; the write-path bug in G-2 is completely invisible to the test suite as written |
| G-5 | LOW  | `poseSelectMirror` reports mid-selection bones with no mirror partner in the `missing` array but the registry toast only fires when `added === 0 && missing.length > 0`; when some partners ARE added and others are missing, the missing roles are silently dropped |

---

## HIGH

### G-1: `Alt+Shift+KeyG/R/S` chord keys are in wrong modifier order — "Clear All" operators are permanently keyboard-dead

**Files:**
- `src/v3/keymap/default.js:329-331` — keymap entries use `Alt+Shift+Key*`
- `src/v3/keymap/default.js:350-356` — `chordOf` builds `Ctrl+Shift+Alt+Meta+` order

**Severity:** HIGH — violates Rule №1. The three "Clear All Pose"
operators (`pose.clearAllLocation`, `pose.clearAllRotation`,
`pose.clearAllScale`) cannot be triggered via keyboard. The operators
exist, are registered, and their logic is correct — but the chord keys
in `DEFAULT_KEYMAP` will never match what `chordOf` produces.

**Root cause:** `chordOf` appends modifiers in this fixed order:

```js
// default.js:350-354
if (e.ctrlKey)  chord += 'Ctrl+';
if (e.shiftKey) chord += 'Shift+';
if (e.altKey)   chord += 'Alt+';
if (e.metaKey)  chord += 'Meta+';
```

The canonical modifier order is `Ctrl+Shift+Alt+Meta+`. When the user
holds Alt+Shift+G, `chordOf` produces `Shift+Alt+KeyG`. The keymap
entry is `'Alt+Shift+KeyG'` — `Alt` before `Shift`. The lookup
`DEFAULT_KEYMAP['Shift+Alt+KeyG']` returns `undefined`; the dispatcher
falls through with no operator invoked and no `preventDefault`.

All pre-existing multi-modifier bindings in the file use `Ctrl+Shift`
order (matching `chordOf`): `'Ctrl+Shift+Backspace'`, `'Ctrl+Shift+KeyZ'`,
`'Ctrl+Shift+KeyM'`, `'Ctrl+Shift+KeyV'`. The three `Alt+Shift+Key*`
entries introduced in Phase 7.C are the only ones with reversed order,
making them the only newly broken chords.

**Fix (FIX — three-line change in `default.js`):**

```js
// Before (broken):
'Alt+Shift+KeyG':   'pose.clearAllLocation',
'Alt+Shift+KeyR':   'pose.clearAllRotation',
'Alt+Shift+KeyS':   'pose.clearAllScale',

// After (matches chordOf canonical order):
'Shift+Alt+KeyG':   'pose.clearAllLocation',
'Shift+Alt+KeyR':   'pose.clearAllRotation',
'Shift+Alt+KeyS':   'pose.clearAllScale',
```

Update the comment block above the entries (line 310 in `default.js`)
and the operator labels in `registry.js` lines 1716, 1730, 1744 to
reflect the corrected notation for the UI surface.

---

## MEDIUM

### G-2 (DOCUMENT-AS-DEVIATION): `applyClear` and `posePaste` write directly to `node.pose.*` — silently wrong for v19-migrated projects

**Files:**
- `src/v3/operators/pose/clearTransform.js:133-151` — `applyClear` switch cases write to `node.pose.x`, `node.pose.rotation`, etc.
- `src/v3/operators/pose/mirror.js:278-283` — `posePaste` writes to `node.pose.rotation`, `node.pose.x`, etc.
- `src/store/projectMigrations.js:641-654` — v19 migration wraps flat `node.pose` into `node.pose = { channels: { [n.id]: flatPose } }`
- `src/store/objectDataAccess.js:336-339` — `getBonePose` reads `node.pose.channels[node.id]` when the channels shape is present

**Severity:** MED-as-MED-deviation — pre-existing cross-cutting gap.
ALL pose writers in the codebase write flat (Phase 7.C operators,
`PoseService.restorePose`, `SkeletonOverlay` drag commits). Only
`getBonePose` reads channels-shape. The v19 migration produces
channels-shape on bones for any project saved pre-v19 (introduced
2026-05-05) loaded into a post-v19 build (2026-05-06+). Phase 7.C's
write paths match the existing convention rather than introducing a
defensive dual-shape writer that would only paper over the broader
issue.

**Why DOCUMENT-AS-DEVIATION rather than FIX in 7.C:** Adding dual-shape
writes ONLY in Phase 7.C operators while leaving `PoseService` and
`SkeletonOverlay` writing flat would create three classes of writer
disagreeing about pose shape — exactly the kind of inconsistency the
audit pattern exists to prevent. The cross-cutting fix needs a single
source-of-truth setter (`setBonePoseField`) used by every writer,
which is a follow-up plan's scope. Phase 7.C ships matching the
prevailing convention; the cross-cutting fix is flagged for the
post-Phase-7 cleanup pass.

**Suggested follow-up plan:** "Pose write canonicalisation" — add
`setBonePoseField(node, field, value)` to `objectDataAccess.js`,
update `PoseService.restorePose`, `SkeletonOverlay.onPointerMove/Up`,
and Phase 7.C operators to route through it. OR ship a v35 migration
that re-flattens channels back (since no writer uses channels-shape,
removing it removes the divergence entirely). Decision deferred to
the follow-up plan.

---

### G-3: `poseCopy` clears the clipboard on empty selection — side-effectful for programmatic callers

**File:** `src/v3/operators/pose/mirror.js:185-187`

**Severity:** MED — the `available()` gate (`eligibleForCopy()` →
`boneIds.length > 0`) prevents keyboard invocation on empty selection,
so end-users cannot hit this in today's app. However, `poseCopy` is an
exported function used directly in tests and will be called by future
Pose Library code. The contract it documents (§7.C.6) is "snapshot
selected bones into clipboard" — it does not say "clear clipboard on
no selection". The current behavior means any code that calls
`poseCopy()` defensively before checking availability will silently
destroy a valid clipboard.

**Root cause:**

```js
// mirror.js:183-201
export function poseCopy() {
  const { boneIds } = eligibleBones();
  if (boneIds.length === 0) {
    usePoseClipboardStore.getState().clear();   // side effect on no-op path
    return { copied: 0 };
  }
  ...
}
```

Blender's `pose.copy` on empty selection is a silent no-op (does NOT
clear the clipboard). The clear was likely added for defensive
consistency, but it inverts the expected behavior of an early-return
guard.

**Fix (FIX — one line removal):** Remove the `clear()` call on the
early-return path. The clipboard should only be modified when the user
has something to copy:

```js
if (boneIds.length === 0) {
  return { copied: 0 };   // no clear — clipboard unchanged
}
```

---

## LOW

### G-4 (DOCUMENT-AS-DEVIATION via G-2): No test covers v19-shape `node.pose` data

**Files:** All 6 test files in `scripts/test/test_poseMode_*.mjs`

**Severity:** LOW — folded into G-2 deviation. Adding a v19-shape
test fixture inside Phase 7.C would lock in the cross-cutting bug
behavior (silent no-op on channels-shape data). Better to ship the
audit-pin test that asserts the prevailing-convention behavior
(flat-shape works) and add the v19-shape coverage in the cross-cutting
follow-up plan that fixes the actual bug.

---

### G-5: `poseSelectMirror` toast fires only on total failure — missing roles silently dropped on partial success

**File:** `src/v3/operators/registry.js:1762-1773`

**Severity:** LOW — no data corruption; purely a UX omission. Silent
drop of mirror roles is only confusing, not incorrect.

**Root cause:** The `poseSelectMirror` function returns
`{added: N, missing: [...], skipped}`. The registry exec callback
toasts on `added === 0 && missing.length > 0` only:

```js
// registry.js:1761-1773
} else if (r.added === 0 && r.missing.length > 0) {
  toast({
    title: 'Select Mirror — no mirror partners found',
    description: `Bone role(s) without mirror: ${r.missing.slice(0,3).join(', ')}…`,
  });
}
```

When the user selects `[leftElbow, torso]`, the operator adds
`rightElbow` (success for leftElbow) but adds `torso` to `missing`
(no mirror partner). `added === 1` — the condition is false — no
toast. The user has no feedback that `torso` has no mirror partner.

Blender's `POSE_OT_select_mirror` reports all missing partners via a
`reports.error` call regardless of partial success.

**Fix:** Change the condition to also toast when `r.missing.length > 0`
even if `added > 0`:

```js
if (r.missing.length > 0) {
  toast({
    title: r.added > 0 ? 'Select Mirror — some partners missing' : 'Select Mirror — no mirror partners found',
    description: `Role(s) without mirror: ${r.missing.slice(0,3).join(', ')}${r.missing.length > 3 ? '…' : ''}`,
  });
}
```

---

## Verified clean

| Question | Verdict |
|---|---|
| Phase 7.A G-1: `beginBatch` receives `project` arg | All 4 clear-impl functions (`clearPoseLocation` etc.) call `beginBatch(project)` where `project = useProjectStore.getState().project`. Correct. `poseSelectMirror` uses no `beginBatch` (selection only — correct). `posePaste` calls `beginBatch(project)` at line 270. Correct. |
| Phantom undo snapshots | Every `beginBatch` call is guarded by an early-return that fires before it: `clearPoseLocation:163`, `clearPoseRotation:181`, `clearPoseScale:199`, `clearAllPose:221`, `posePaste:223-229`. No phantom snapshots. |
| Eager imports in registry | Phase 7.C modules imported at top of `registry.js` (lines 59-60): `import * as poseClear from './pose/clearTransform.js'` and `import * as poseMirror from './pose/mirror.js'`. All 10 `exec` bodies are synchronous. No `await` in any exec. Correct. |
| Ctrl+C/V fall-through in non-Pose contexts | Dispatcher (line 58): `if (op.available && !op.available(...)) return` — returns WITHOUT `e.preventDefault()`. `pose.copy`/`paste` `available()` returns false when `editMode !== 'pose'`. Browser native copy/paste is not suppressed outside Pose Mode. Correct. The `isEditableTarget` guard at line 28 also fires before chord resolution for `<input>/<textarea>/contentEditable`, so typing in a text field is never interrupted. |
| Selection model coherence | `eligibleBones()` filters `useSelectionStore.items` to `type:'group'` entries that pass `isBoneGroup(node)` (which requires `boneRole`). This correctly excludes plain groups and non-group nodes. `poseSelectMirror` calls `selStore.select(toAdd, 'add')` — correctly uses the `add` modifier. `toAdd` entries carry `{type:'group', id:...}` — correct shape for the selection store. |
| `posePaste` write-path, no phantom when `writes.length === 0` | `beginBatch(project)` at line 270 is inside `if (writes.length === 0) { return ... }` guard at line 266-268. When writes is empty, function returns before the batch opens. No phantom snapshot. |
| `poseCopy` is not on undo stack | `poseCopy` writes only to `poseClipboardStore` (transient, not `projectStore`). No `beginBatch` / `pushSnapshot`. Correct — clipboard state is not project state. |
| `mirrorRole` edge cases | `'left'` (4 chars) → `null` via `length < 5` guard. `'right'` (5 chars) → `rest = ''` → `rest.length === 0` → `null`. `'leftover'` → `rest[0] = 'o'` which is not uppercase → `null`. All edge cases safe. |
| No pre-existing `Alt+G/R/S` conflicts | Pre-7.C keymap has `Alt+KeyA` (deselectAll) and `Alt+KeyP` (clearParent). No `Alt+KeyG`, `Alt+KeyR`, or `Alt+KeyS` existed before 7.C. The new operators don't collide with anything. |
| `Alt+G` vs `KeyG` (transform.translate) | `chordOf` for a plain G press produces `KeyG` (no modifier prefix). For Alt+G it produces `Shift+Alt+KeyG` (the bug). No collision between `pose.clearLocation` and `transform.translate` regardless — they're different chords. |
| `Ctrl+Shift+KeyM` / `Ctrl+Shift+KeyV` ordering | Both follow the `Ctrl+Shift+` canonical order matching `chordOf`. These two chords are correct. |
| No `Alt+Shift` binding pre-7.C to establish a "working" precedent | Searched full `DEFAULT_KEYMAP` — no `Alt+Shift+` or `Shift+Alt+` entry existed before 7.C. The three new broken entries are the first and only ones with this ordering issue. |

---

## Repair priority

1. **G-1 (HIGH)** — FIX: rename three keymap keys in `default.js` from
   `Alt+Shift+Key*` to `Shift+Alt+Key*`. Update the comment block and
   registry operator labels. Three-line change; zero logic impact; unblocks
   the three "Clear All" operators.

2. **G-3 (MED)** — FIX: remove the `usePoseClipboardStore.getState().clear()`
   call from the early-return path in `poseCopy`. One-line deletion.

3. **G-5 (LOW)** — FIX: change the toast condition in the `pose.selectMirror`
   exec callback to also surface partial-success missing roles.

4. **G-2 + G-4 (MED + LOW)** — DOCUMENT-AS-DEVIATION: cross-cutting v19
   channels-shape gap; cross-cutting fix outside Phase 7.C scope.
