// Regression for the toggleVertexSelection Blender-fidelity fix
// (2026-06-12).
//
// Bug: Shift+LMB on the active vertex (to deselect it) cleared
// `editorStore.activeVertex` to null, breaking:
//   - edit.merge.atLast (reads activeVertex; throws when null)
//   - Numpad . / Frame Selected (centres camera on activeVertex)
//   - the white-bordered active-element visual marker
//
// Blender's `EDBM_select_pick` calls `BM_select_history_store(bm, ele)`
// unconditionally — every Shift+LMB click sets the clicked element as
// the new head of selection history (the "active element"), regardless
// of whether the toggle ended up selecting or deselecting.
//
// SS pre-fix matched Blender only on the ADD path. Fix: also set the
// clicked vert as active on the REMOVE path.
//
// Run: node scripts/test/test_toggleVertexActiveFollowsClick.mjs

import { useEditorStore } from '../../src/store/editorStore.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

function reset() {
  useEditorStore.setState({
    selectedVertexIndices: new Map(),
    activeVertex: null,
  });
}

// ── §1 — Shift+LMB on unselected vert ADDS + sets active ───────────

{
  reset();
  useEditorStore.getState().toggleVertexSelection('part-1', 5);
  const s = useEditorStore.getState();
  ok(s.selectedVertexIndices.get('part-1')?.has(5),
    '§1 — toggle adds vert 5 to selection');
  ok(s.activeVertex?.partId === 'part-1' && s.activeVertex?.vertIndex === 5,
    '§1 — toggle sets vert 5 as active');
}

// ── §2 — Shift+LMB on selected vert REMOVES + active still follows ─
//
// This is the Blender-fidelity fix. Pre-fix this case cleared
// activeVertex to null. Now active follows the click — exactly like
// Blender's BM_select_history_store(ele) which fires regardless of
// whether the toggle added or removed.

{
  reset();
  // Set up: vert 5 already selected and active.
  useEditorStore.setState({
    selectedVertexIndices: new Map([['part-1', new Set([5])]]),
    activeVertex: { partId: 'part-1', vertIndex: 5 },
  });
  useEditorStore.getState().toggleVertexSelection('part-1', 5);
  const s = useEditorStore.getState();
  ok(!s.selectedVertexIndices.has('part-1'),
    '§2 — toggle removes vert 5 (selection set now empty → key cleared)');
  ok(s.activeVertex?.partId === 'part-1' && s.activeVertex?.vertIndex === 5,
    '§2 — POST-FIX: activeVertex still points at the clicked vert (was null pre-fix)');
}

// ── §3 — Shift+LMB on a DIFFERENT selected vert removes + reroutes active ─
//
// Active was at vert 3; user Shift+LMB on selected vert 7 to remove
// it. Active should move to 7 (the just-clicked element).

{
  reset();
  useEditorStore.setState({
    selectedVertexIndices: new Map([['part-1', new Set([3, 7, 9])]]),
    activeVertex: { partId: 'part-1', vertIndex: 3 },
  });
  useEditorStore.getState().toggleVertexSelection('part-1', 7);
  const s = useEditorStore.getState();
  const sel = s.selectedVertexIndices.get('part-1');
  ok(sel?.has(3) && !sel?.has(7) && sel?.has(9),
    '§3 — vert 7 removed, 3 and 9 stay');
  ok(s.activeVertex?.partId === 'part-1' && s.activeVertex?.vertIndex === 7,
    '§3 — active moved to vert 7 (the clicked one), NOT staying at 3');
}

// ── §4 — Shift+LMB add: active follows the new vert ─────────────────

{
  reset();
  useEditorStore.setState({
    selectedVertexIndices: new Map([['part-1', new Set([3])]]),
    activeVertex: { partId: 'part-1', vertIndex: 3 },
  });
  useEditorStore.getState().toggleVertexSelection('part-1', 8);
  const s = useEditorStore.getState();
  const sel = s.selectedVertexIndices.get('part-1');
  ok(sel?.has(3) && sel?.has(8),
    '§4 — both verts selected after add');
  ok(s.activeVertex?.partId === 'part-1' && s.activeVertex?.vertIndex === 8,
    '§4 — active moved to vert 8 (newly added)');
}

// ── §5 — deselectVertex (NOT click path) still clears active ───────
//
// Box-select subtract, undo, programmatic clear → no click happened,
// so the active should NOT follow. deselectVertex is the correct
// non-click code path. Locks that we didn't over-apply the fix.

{
  reset();
  useEditorStore.setState({
    selectedVertexIndices: new Map([['part-1', new Set([5])]]),
    activeVertex: { partId: 'part-1', vertIndex: 5 },
  });
  useEditorStore.getState().deselectVertex('part-1', 5);
  const s = useEditorStore.getState();
  ok(!s.selectedVertexIndices.has('part-1'),
    '§5 — vert removed from selection');
  ok(s.activeVertex === null,
    '§5 — deselectVertex (non-click path) DOES clear active (no click to take over)');
}

// ── §6 — toggleVertexSelection rejects bad inputs ──────────────────

{
  reset();
  useEditorStore.getState().toggleVertexSelection('', 5);
  ok(useEditorStore.getState().activeVertex === null,
    '§6 — empty partId: no-op');
  useEditorStore.getState().toggleVertexSelection('part-1', -1);
  ok(useEditorStore.getState().activeVertex === null,
    '§6 — negative vertIndex: no-op');
  useEditorStore.getState().toggleVertexSelection('part-1', 3.5);
  ok(useEditorStore.getState().activeVertex === null,
    '§6 — non-integer vertIndex: no-op');
}

// ── §7 — cross-part toggle: active correctly reroutes to new part ─

{
  reset();
  useEditorStore.setState({
    selectedVertexIndices: new Map([['part-A', new Set([1, 2])]]),
    activeVertex: { partId: 'part-A', vertIndex: 1 },
  });
  // Shift+LMB on part-B vert 5 (unselected) → add to part-B, active → part-B/5
  useEditorStore.getState().toggleVertexSelection('part-B', 5);
  const s = useEditorStore.getState();
  ok(s.selectedVertexIndices.get('part-A')?.has(1),
    '§7 — part-A selection preserved');
  ok(s.selectedVertexIndices.get('part-B')?.has(5),
    '§7 — part-B vert 5 added');
  ok(s.activeVertex?.partId === 'part-B' && s.activeVertex?.vertIndex === 5,
    '§7 — active jumped to part-B vert 5');
}

console.log(`toggleVertexActiveFollowsClick: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
