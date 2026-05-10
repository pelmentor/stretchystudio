// Toolset Phase 1 — modifier composition for box / lasso commit
// (replace / add / subtract). Tests the set algebra the
// BoxSelectOverlay applies on commit, against both the universal
// selectionStore (Object Mode) and the per-part vertex Map (Edit Mode).
//
// Run: node scripts/test/test_lassoSelect_modifiers.mjs

import { useSelectionStore } from '../../src/store/selectionStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { useBoxSelectStore } from '../../src/store/boxSelectStore.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function reset() {
  useSelectionStore.getState().clear();
  useEditorStore.getState().setSelection([]);
  useEditorStore.getState().clearAllVertexSelections();
  useBoxSelectStore.getState().cancel();
}

// ── Object-mode replace ─────────────────────────────────────────────

{
  reset();
  // Pre-existing selection: A, B.
  useSelectionStore.getState().select([
    { type: 'part', id: 'A' },
    { type: 'part', id: 'B' },
  ], 'replace');
  // Box picks C — replace drops A,B and selects only C.
  useSelectionStore.getState().select([{ type: 'part', id: 'C' }], 'replace');
  const items = useSelectionStore.getState().items;
  assert(items.length === 1 && items[0].id === 'C', 'replace drops prior, picks new');
}

// ── Object-mode add (union) ────────────────────────────────────────

{
  reset();
  useSelectionStore.getState().select([{ type: 'part', id: 'A' }], 'replace');
  useSelectionStore.getState().select(
    [{ type: 'part', id: 'B' }, { type: 'part', id: 'C' }],
    'add',
  );
  const items = useSelectionStore.getState().items;
  const ids = items.map((it) => it.id).sort();
  assert(ids.join(',') === 'A,B,C', 'add union: A + {B,C} = A,B,C');
}

// ── Object-mode subtract (set difference, manual via store API) ────

{
  reset();
  // Subtract is composed in the overlay (selectionStore has no
  // dedicated subtract op). Mirror the overlay's pattern.
  useSelectionStore.getState().select([
    { type: 'part', id: 'A' },
    { type: 'part', id: 'B' },
    { type: 'part', id: 'C' },
  ], 'replace');
  const pickedSet = new Set(['B']);
  const remaining = useSelectionStore.getState().items
    .filter((it) => !(it.type === 'part' && pickedSet.has(it.id)));
  useSelectionStore.getState().select(remaining, 'replace');
  const ids = useSelectionStore.getState().items.map((it) => it.id).sort();
  assert(ids.join(',') === 'A,C', 'subtract removes only matching');
}

// ── Edit-mode replace ──────────────────────────────────────────────

{
  reset();
  const ed = useEditorStore.getState();
  ed.setSelection(['part1']);
  ed.setVertexSelectionForPart('part1', new Set([0, 1, 2]));
  // Replace with a different set.
  ed.setVertexSelectionForPart('part1', new Set([5, 6]));
  const cur = useEditorStore.getState().selectedVertexIndices.get('part1');
  assert(cur && cur.size === 2 && cur.has(5) && cur.has(6), 'edit replace: {0,1,2}→{5,6}');
}

// ── Edit-mode add (manual via overlay's pattern) ───────────────────

{
  reset();
  const ed = useEditorStore.getState();
  ed.setSelection(['part1']);
  ed.setVertexSelectionForPart('part1', new Set([0, 1]));
  // Pretend lasso picked {2, 3}; merge with existing.
  const cur = useEditorStore.getState().selectedVertexIndices.get('part1') ?? new Set();
  const next = new Set(cur);
  for (const i of [2, 3]) next.add(i);
  ed.setVertexSelectionForPart('part1', next);
  const after = useEditorStore.getState().selectedVertexIndices.get('part1');
  assert(after && after.size === 4 && after.has(0) && after.has(1) && after.has(2) && after.has(3),
    'edit add: {0,1} ∪ {2,3} = {0,1,2,3}');
}

// ── Edit-mode subtract ─────────────────────────────────────────────

{
  reset();
  const ed = useEditorStore.getState();
  ed.setSelection(['part1']);
  ed.setVertexSelectionForPart('part1', new Set([0, 1, 2, 3]));
  // Pretend lasso picked {1, 2}; subtract from existing.
  const cur = useEditorStore.getState().selectedVertexIndices.get('part1') ?? new Set();
  const next = new Set(cur);
  for (const i of [1, 2]) next.delete(i);
  ed.setVertexSelectionForPart('part1', next);
  const after = useEditorStore.getState().selectedVertexIndices.get('part1');
  assert(after && after.size === 2 && after.has(0) && after.has(3) && !after.has(1) && !after.has(2),
    'edit subtract: {0,1,2,3} − {1,2} = {0,3}');
}

// ── Edit-mode subtract empties → key removed (per setVertexSelectionForPart contract) ──

{
  reset();
  const ed = useEditorStore.getState();
  ed.setSelection(['part1']);
  ed.setVertexSelectionForPart('part1', new Set([0, 1]));
  ed.setVertexSelectionForPart('part1', new Set());
  const after = useEditorStore.getState().selectedVertexIndices.get('part1');
  assert(!after, 'edit subtract to empty: key removed');
}

// ── BoxSelectStore: begin / update / commit lifecycle ──────────────

{
  reset();
  const s = useBoxSelectStore.getState();
  s.begin({
    kind: 'box',
    mode: 'object',
    editPartId: null,
    startClient: { x: 100, y: 100 },
  });
  let st = useBoxSelectStore.getState();
  assert(st.kind === 'box',                    'begin sets kind');
  assert(st.mode === 'object',                 'begin sets mode');
  assert(st.startClient.x === 100,             'begin sets start.x');
  assert(st.currentClient.x === 100,           'begin seeds current = start');
  assert(st.pathClient.length === 0,           'begin: box → path empty');

  s.update({ x: 200, y: 200 });
  st = useBoxSelectStore.getState();
  assert(st.currentClient.x === 200,           'update advances current');

  s.commit();
  st = useBoxSelectStore.getState();
  assert(st.kind === null,                     'commit clears kind');
  assert(st.startClient === null,              'commit clears startClient');
}

// ── BoxSelectStore: lasso path appends on update ───────────────────

{
  reset();
  const s = useBoxSelectStore.getState();
  s.begin({
    kind: 'lasso',
    mode: 'object',
    editPartId: null,
    startClient: { x: 100, y: 100 },
  });
  let st = useBoxSelectStore.getState();
  assert(st.pathClient.length === 1,           'lasso begin: path seeded with start');

  s.update({ x: 110, y: 110 });
  s.update({ x: 120, y: 120 });
  s.update({ x: 130, y: 130 });
  st = useBoxSelectStore.getState();
  assert(st.pathClient.length === 4,           'lasso path appends on each move');

  // Sub-1px move → no append.
  s.update({ x: 130.5, y: 130.5 });
  st = useBoxSelectStore.getState();
  assert(st.pathClient.length === 4,           'lasso sub-1px move skips append');
}

// ── BoxSelectStore: cancel matches commit's reset shape ─────────────

{
  reset();
  const s = useBoxSelectStore.getState();
  s.begin({
    kind: 'box',
    mode: 'edit',
    editPartId: 'p1',
    startClient: { x: 0, y: 0 },
  });
  s.cancel();
  const st = useBoxSelectStore.getState();
  assert(st.kind === null && st.editPartId === null && st.startClient === null,
    'cancel clears all slots');
}

console.log(`lassoSelect_modifiers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
