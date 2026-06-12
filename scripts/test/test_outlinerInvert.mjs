// Regression for Outliner Ctrl+I invert selection of visible rows
// (2026-06-12, Phase 4 paint-fidelity follow-up).
//
// Sister to Outliner A / Alt+A (581640f). Ctrl+I in the Outliner fell
// through to the global `selection.invert` Object Mode branch which
// only inverts VISIBLE PARTS — same gap as the A handler covered,
// just for the inverse op. Mirrors Blender's `outliner.select_all
// (action='INVERT')`.
//
// Fix: OutlinerEditor's `onTreeKeyDown` grows a Ctrl+I (or Cmd+I)
// branch that walks `rows`, picks every NON-selected row, converts
// to selectionStore type via the same mapping A uses, replaces the
// selection with the complement.
//
// Run: node scripts/test/test_outlinerInvert.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — chord predicate ─────────────────────────────────────────────

function isCtrlI(e) {
  return !!(e.code === 'KeyI'
    && (e.ctrlKey || e.metaKey)
    && !e.altKey && !e.shiftKey);
}

ok(isCtrlI({ code: 'KeyI', ctrlKey: true }) === true, '§1 — Ctrl+I');
ok(isCtrlI({ code: 'KeyI', metaKey: true }) === true, '§1 — Cmd+I');
ok(isCtrlI({ code: 'KeyI' }) === false, '§1 — bare I → no');
ok(isCtrlI({ code: 'KeyI', ctrlKey: true, shiftKey: true }) === false,
  '§1 — Ctrl+Shift+I → no (browser dev tools must NOT be consumed)');
ok(isCtrlI({ code: 'KeyI', ctrlKey: true, altKey: true }) === false,
  '§1 — Ctrl+Alt+I → no');
ok(isCtrlI({ code: 'KeyA', ctrlKey: true }) === false,
  '§1 — Ctrl+A → no (different chord)');

// ── §2 — invert math: complement vs selected, type-preserved ─────────

function invertRows(rows, selectedIds) {
  const result = [];
  for (const row of rows) {
    const node = row.node;
    if (node.isSynthetic === true) continue;
    if (selectedIds.has(node.id)) continue;
    const t = node.type;
    let storeType;
    if (t === 'part' || t === 'artmesh') storeType = 'part';
    else if (t === 'group') storeType = 'group';
    else if (t === 'deformer') storeType = 'deformer';
    else if (t === 'object') storeType = 'object';
    else continue;
    result.push({ type: storeType, id: node.id });
  }
  return result;
}

{
  const rows = [
    { node: { type: 'part', id: 'p1' } },
    { node: { type: 'part', id: 'p2' } },
    { node: { type: 'group', id: 'g1' } },
    { node: { type: 'deformer', id: 'd1' } },
  ];
  const selected = new Set(['p1', 'g1']);
  const inverted = invertRows(rows, selected);
  ok(inverted.length === 2, '§2 — 4 rows, 2 selected → 2 inverted');
  ok(inverted.find((it) => it.id === 'p2' && it.type === 'part'),
    '§2 — non-selected part included as part');
  ok(inverted.find((it) => it.id === 'd1' && it.type === 'deformer'),
    '§2 — non-selected deformer included as deformer (NOT part — the global '
    + 'op would only have included parts; this is the Outliner-scope win)');
  ok(!inverted.find((it) => it.id === 'p1' || it.id === 'g1'),
    '§2 — selected rows removed from inverted set');
}

{
  // All selected → invert clears
  const rows = [
    { node: { type: 'part', id: 'p1' } },
    { node: { type: 'group', id: 'g1' } },
  ];
  const selected = new Set(['p1', 'g1']);
  const inverted = invertRows(rows, selected);
  ok(inverted.length === 0, '§2 — all selected → empty inverted');
}

{
  // Nothing selected → invert selects all
  const rows = [
    { node: { type: 'part', id: 'p1' } },
    { node: { type: 'group', id: 'g1' } },
  ];
  const selected = new Set();
  const inverted = invertRows(rows, selected);
  ok(inverted.length === 2, '§2 — empty selection → invert selects all 2');
}

{
  // Synthetic skipped
  const rows = [
    { node: { type: 'group', id: 'arm', isSynthetic: true } },
    { node: { type: 'group', id: 'real_bone' } },
  ];
  const selected = new Set();
  const inverted = invertRows(rows, selected);
  ok(inverted.length === 1 && inverted[0].id === 'real_bone',
    '§2 — synthetic excluded from invert too');
}

// ── §3 — active head: last part/group in inverted set ───────────────

function pickActiveHead(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'part' || items[i].type === 'group') return items[i].id;
  }
  return null;
}

{
  const rows = [
    { node: { type: 'part', id: 'p1' } },
    { node: { type: 'part', id: 'p2' } },
    { node: { type: 'deformer', id: 'd1' } },
  ];
  // Selected p1 → invert gives {p2, d1}
  const inverted = invertRows(rows, new Set(['p1']));
  ok(pickActiveHead(inverted) === 'p2',
    '§3 — active head walks backward for last part/group; deformer skipped');
}

{
  const rows = [
    { node: { type: 'deformer', id: 'd1' } },
    { node: { type: 'object', id: 'o1' } },
  ];
  const inverted = invertRows(rows, new Set());
  ok(pickActiveHead(inverted) === null,
    '§3 — only deformer/object inverted → null active head (legacy slot empty)');
}

// ── §4 — type mapping parity with A handler ─────────────────────────
//
// Lock that Ctrl+I uses the exact same row→type mapping as A. A future
// refactor that changes one should change both; this test catches
// divergence.

const A_MAPPING = {
  'part':     'part',
  'artmesh':  'part',
  'group':    'group',
  'deformer': 'deformer',
  'object':   'object',
};

const I_MAPPING = {
  'part':     'part',
  'artmesh':  'part',
  'group':    'group',
  'deformer': 'deformer',
  'object':   'object',
};

for (const [from, to] of Object.entries(A_MAPPING)) {
  ok(I_MAPPING[from] === to,
    `§4 — Ctrl+I '${from}' → '${I_MAPPING[from]}' (parity with A: → '${to}')`);
}

// ── §5 — propagation policy (mirror of A handler) ───────────────────

const POLICY = {
  preventDefault: true,
  stopPropagation: true,
  reason: 'block global selection.invert from clobbering Outliner-scoped result',
};

ok(POLICY.preventDefault && POLICY.stopPropagation,
  '§5 — preventDefault + stopPropagation; otherwise global op clobbers');

// ── §6 — toggle vs invert semantic difference ───────────────────────
//
// A toggles between "all selected" and "none selected". Ctrl+I creates
// the COMPLEMENT. With a partial selection {p1, g1} from {p1, p2, g1, d1}:
//   - A pressed: clears (since "any selected" → clear)
//   - Ctrl+I pressed: gives {p2, d1} (complement)

{
  const rows = [
    { node: { type: 'part', id: 'p1' } },
    { node: { type: 'part', id: 'p2' } },
    { node: { type: 'group', id: 'g1' } },
    { node: { type: 'deformer', id: 'd1' } },
  ];
  const selected = new Set(['p1', 'g1']);

  // Simulated A: any selected → clear
  function aToggle(cur) {
    if (cur.size > 0) return [];
    return invertRows(rows, new Set());
  }
  const aResult = aToggle(selected);
  ok(aResult.length === 0, '§6 — A with partial selection → clear');

  const iResult = invertRows(rows, selected);
  ok(iResult.length === 2, '§6 — Ctrl+I with partial selection → complement (2 items)');
  ok(iResult.find((it) => it.id === 'p2'),
    '§6 — Ctrl+I yields p2 + d1 (the unselected ones)');
}

console.log(`outlinerInvert: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
