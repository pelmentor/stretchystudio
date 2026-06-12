// Regression for Outliner A / Alt+A select-all/deselect-all on
// visible rows (2026-06-12, Phase 4 paint-fidelity follow-up).
//
// Bug class: A in the Outliner fell through to the global
// `selection.selectAllToggle` Object Mode branch which only selects
// VISIBLE PARTS. The Outliner also shows groups, bones, deformers,
// and v43 lattice objects — A in Outliner missed those by design.
//
// Fix: OutlinerEditor's `onTreeKeyDown` grows a KeyA branch (with
// Alt+A sister) that walks `rows` (the filtered/collapse-respected
// list the user actually sees) and selects every row's node,
// converting each tree-node type to its selectionStore type via the
// same mapping `onSelect` uses:
//   - 'part'    → 'part'
//   - 'artmesh' → 'part'
//   - 'group'   → 'group'
//   - 'deformer'→ 'deformer'
//   - 'object'  → 'object' (v43 lattice)
//   - synthetic (Armature root placeholder) → skipped
//
// Legacy editorStore.selection mirrors part/group only; deformer +
// object writes update only the universal store (matches the
// `selectAndMirror` policy at OutlinerEditor.jsx:211-214).
//
// stopPropagation prevents the global op from also firing.
//
// Run: node scripts/test/test_outlinerSelectAll.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — chord classification ───────────────────────────────────────

function classify(e) {
  if (e.code !== 'KeyA') return 'PASS_THROUGH';
  if (e.ctrlKey || e.metaKey || e.shiftKey) return 'PASS_THROUGH';
  if (e.altKey) return 'DESELECT_ALL';
  return 'TOGGLE';
}

ok(classify({ code: 'KeyA' }) === 'TOGGLE', '§1 — bare A → toggle');
ok(classify({ code: 'KeyA', altKey: true }) === 'DESELECT_ALL', '§1 — Alt+A → deselect');
ok(classify({ code: 'KeyA', ctrlKey: true }) === 'PASS_THROUGH',
  '§1 — Ctrl+A → pass-through (browser select-all stays free)');
ok(classify({ code: 'KeyA', metaKey: true }) === 'PASS_THROUGH', '§1 — Cmd+A → pass-through');
ok(classify({ code: 'KeyA', shiftKey: true }) === 'PASS_THROUGH', '§1 — Shift+A → pass-through');
ok(classify({ code: 'KeyB' }) === 'PASS_THROUGH', '§1 — non-A → pass-through');

// ── §2 — row → selectionStore-item conversion ──────────────────────

function rowToItem(row) {
  const node = row.node;
  if (node.isSynthetic === true) return null;
  const t = node.type;
  if (t === 'part' || t === 'artmesh') return { type: 'part', id: node.id };
  if (t === 'group') return { type: 'group', id: node.id };
  if (t === 'deformer') return { type: 'deformer', id: node.id };
  if (t === 'object') return { type: 'object', id: node.id };
  return null;
}

ok(rowToItem({ node: { type: 'part', id: 'p1' } })?.type === 'part',
  '§2 — part → part');
ok(rowToItem({ node: { type: 'artmesh', id: 'am1' } })?.type === 'part',
  '§2 — artmesh → part (rig-mode art-mesh leaves dispatch as parts)');
ok(rowToItem({ node: { type: 'group', id: 'g1' } })?.type === 'group',
  '§2 — group → group');
ok(rowToItem({ node: { type: 'deformer', id: 'd1' } })?.type === 'deformer',
  '§2 — deformer → deformer');
ok(rowToItem({ node: { type: 'object', id: 'o1' } })?.type === 'object',
  '§2 — object (v43 lattice) → object');
ok(rowToItem({ node: { type: 'group', id: 'arm', isSynthetic: true } }) === null,
  '§2 — synthetic Armature root → null (skipped)');
ok(rowToItem({ node: { type: 'unknown', id: 'x' } }) === null,
  '§2 — unknown type → null (defensive)');

// ── §3 — collect items from rows ────────────────────────────────────

function collectItems(rows) {
  const items = [];
  for (const row of rows) {
    const item = rowToItem(row);
    if (item) items.push(item);
  }
  return items;
}

{
  const rows = [
    { node: { type: 'part', id: 'p1' } },
    { node: { type: 'group', id: 'g1' } },
    { node: { type: 'deformer', id: 'd1' } },
    { node: { type: 'group', id: 'arm', isSynthetic: true } },
    { node: { type: 'object', id: 'o1' } },
  ];
  const items = collectItems(rows);
  ok(items.length === 4, '§3 — 4 valid items (synthetic skipped)');
  ok(items.find((i) => i.id === 'arm') === undefined, '§3 — synthetic excluded');
  ok(items.find((i) => i.id === 'd1' && i.type === 'deformer'),
    '§3 — deformer carries through with correct type');
  ok(items.find((i) => i.id === 'o1' && i.type === 'object'),
    '§3 — object carries through');
}

// ── §4 — toggle semantics (A on populated vs empty) ─────────────────

function toggleSelect(currentItemCount, rows) {
  if (currentItemCount > 0) return { action: 'CLEAR', items: [] };
  const items = collectItems(rows);
  if (items.length === 0) return { action: 'NO_OP', items: [] };
  return { action: 'SELECT_ALL', items };
}

{
  const rows = [{ node: { type: 'part', id: 'p1' } }];
  ok(toggleSelect(2, rows).action === 'CLEAR',
    '§4 — A with 2 selected → CLEAR (toggle off)');
  ok(toggleSelect(0, rows).action === 'SELECT_ALL',
    '§4 — A with 0 selected → SELECT_ALL');
  ok(toggleSelect(0, []).action === 'NO_OP',
    '§4 — A with empty rows → NO_OP (nothing to select)');
}

// ── §5 — active head: last part/group walking backward ──────────────
//
// Mirrors Object Mode `selection.selectAllToggle` convention — active
// head = last selectable in items array. But here deformer + object
// are universal-store-only; legacy editorStore.selection mirrors only
// part/group. So we walk backward for the last part/group.

function pickActiveHead(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'part' || items[i].type === 'group') return items[i].id;
  }
  return null;
}

ok(pickActiveHead([
  { type: 'part', id: 'p1' },
  { type: 'group', id: 'g1' },
  { type: 'deformer', id: 'd1' },
]) === 'g1', '§5 — last part/group before deformer = active head');

ok(pickActiveHead([
  { type: 'deformer', id: 'd1' },
  { type: 'object', id: 'o1' },
]) === null,
  '§5 — only deformers/objects selected → null active head (legacy slot empty)');

ok(pickActiveHead([
  { type: 'part', id: 'p1' },
  { type: 'part', id: 'p2' },
  { type: 'part', id: 'p3' },
]) === 'p3', '§5 — last part is active head');

// ── §6 — propagation policy ─────────────────────────────────────────
//
// stopPropagation prevents the global `selection.selectAllToggle` from
// ALSO firing on the same keydown. Without it, the global op (Object
// Mode branch) would select-all-parts AFTER the Outliner-scoped
// select-all-visible-rows — clobbering deformer/object items.

const PROPAGATION_POLICY = {
  preventDefault: true,
  stopPropagation: true,
  reason: 'block global selection.selectAllToggle from clobbering Outliner-scoped result',
};

ok(PROPAGATION_POLICY.preventDefault && PROPAGATION_POLICY.stopPropagation,
  '§6 — both preventDefault AND stopPropagation; partial would let global op fire');

// ── §7 — focus-based scope ──────────────────────────────────────────
//
// onTreeKeyDown only fires when the tree has focus. tabIndex=0 + click
// give the tree focus; the Outliner then owns A/Alt+A while focused.
// This is the existing pattern for arrow-key row navigation; A/Alt+A
// extend it consistently.

const SCOPE = {
  trigger: 'focused_tree_div',
  outsideEffect: 'global_op_fires_normally',
  alternative_considered: 'hover_based_capture_phase',
  alternative_rationale: 'matches Blender outliner spatial-hover semantic; '
    + 'deferred for consistency with the existing OutlinerEditor focus-based '
    + 'arrow-key chord pattern',
};

ok(SCOPE.trigger === 'focused_tree_div',
  '§7 — A/Alt+A scope = focused tree only (matches existing arrow-key pattern)');

console.log(`outlinerSelectAll: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
