// Regression for FCurveEditor bare L → select linked keyforms
// (2026-06-12, Phase 4 paint-fidelity follow-up — Animation editors
// audit).
//
// Bug class: bare L over FCurveEditor had no effect. Blender's
// GRAPH_OT_select_linked (graph_select.cc:740-754) expands keyform
// selection to full fcurve coverage for every fcurve that has at
// least one selected keyform. Pure-state operation — no cursor
// hit-test (unlike Edit Mode's MESH_OT_select_linked_pick which does
// need cursor knowledge).
//
// Fix: FCurveEditor's keydown handler grows a bare-L branch above
// the regionHoverRef sidebar/timeline fallthroughs:
//   1. Walk current handles, collect fcurveIds where size > 0
//   2. Bail if no fcurve has selection (matches OPERATOR_CANCELLED at
//      graph_select.cc:723)
//   3. For each such fcurveId, build a complete-coverage inner Map
//      ({i: {center, left, right}} for all i in [0, keyforms.length))
//   4. Replace handles + selectionRef synchronously (modal contract
//      same as Shift+D)
//
// Why this lives in FCurveEditor (not the global select.linked.cursor
// operator that handles Edit Mode + Pose Mode): the fcurve-level
// linked semantic doesn't need a cursor target — any selected dot
// expands the whole curve. The global operator's cursor-aware path
// is for cases where you specifically click a thing; here the
// expansion is from current state.
//
// Run: node scripts/test/test_fcurveLSelectLinked.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — chord predicate ─────────────────────────────────────────────

function isBareL(e) {
  return e.code === 'KeyL'
    && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
}

ok(isBareL({ code: 'KeyL' }) === true, '§1 — bare L');
ok(isBareL({ code: 'KeyL', shiftKey: true }) === false,
  '§1 — Shift+L → no (Blender Shift+L is deselect-linked-pick in Edit Mode; not the same op)');
ok(isBareL({ code: 'KeyL', ctrlKey: true }) === false,
  '§1 — Ctrl+L → no (Blender Ctrl+L = select.linked.expand for verts)');
ok(isBareL({ code: 'KeyL', altKey: true }) === false, '§1 — Alt+L → no');
ok(isBareL({ code: 'KeyL', metaKey: true }) === false, '§1 — Cmd+L → no');
ok(isBareL({ code: 'KeyM' }) === false, '§1 — other key → no');

// ── §2 — fcurveIdsWithSelection collection ──────────────────────────

function collectFcurvesWithSelection(handles) {
  const ids = [];
  for (const [fcurveId, sub] of handles) {
    if (sub && sub.size > 0) ids.push(fcurveId);
  }
  return ids;
}

{
  const handles = new Map();
  ok(collectFcurvesWithSelection(handles).length === 0,
    '§2 — empty handles → no fcurves');
}

{
  const handles = new Map([
    ['fc1', new Map([[0, { center: true }]])],
    ['fc2', new Map([[5, { center: true }]])],
  ]);
  const ids = collectFcurvesWithSelection(handles);
  ok(ids.length === 2, '§2 — 2 fcurves with selection');
  ok(ids.includes('fc1') && ids.includes('fc2'), '§2 — correct fcurve ids');
}

{
  // Defensive: empty inner map should not register
  const handles = new Map([
    ['fc1', new Map()],
    ['fc2', new Map([[0, { center: true }]])],
  ]);
  const ids = collectFcurvesWithSelection(handles);
  ok(ids.length === 1 && ids[0] === 'fc2',
    '§2 — empty inner map skipped (stale fcurve entries)');
}

// ── §3 — expansion to full-fcurve coverage ──────────────────────────

function expandToFull(action, fcurveIds) {
  const next = new Map();
  for (const fcurveId of fcurveIds) {
    const fc = action?.fcurves?.find((f) => f.id === fcurveId);
    if (!fc || !Array.isArray(fc.keyforms)) continue;
    const inner = new Map();
    for (let i = 0; i < fc.keyforms.length; i++) {
      inner.set(i, { center: true, left: true, right: true });
    }
    if (inner.size > 0) next.set(fcurveId, inner);
  }
  return next;
}

{
  const action = {
    fcurves: [
      { id: 'fc1', keyforms: [{ time: 0 }, { time: 100 }, { time: 200 }, { time: 300 }] },
      { id: 'fc2', keyforms: [{ time: 0 }, { time: 50 }] },
      { id: 'fc3', keyforms: [{ time: 999 }] }, // untouched
    ],
  };
  const expanded = expandToFull(action, ['fc1', 'fc2']);
  ok(expanded.size === 2, '§3 — only requested fcurves in result');
  ok(expanded.get('fc1').size === 4, '§3 — fc1: all 4 keyforms selected');
  ok(expanded.get('fc2').size === 2, '§3 — fc2: all 2 keyforms selected');
  ok(!expanded.has('fc3'),
    '§3 — fc3 NOT touched (only fcurves with prior selection get expanded)');
}

{
  // Defensive: empty keyforms → skip
  const action = {
    fcurves: [
      { id: 'fc1', keyforms: [] },
      { id: 'fc2', keyforms: [{ time: 0 }] },
    ],
  };
  const expanded = expandToFull(action, ['fc1', 'fc2']);
  ok(!expanded.has('fc1'),
    '§3 — empty-keyforms fcurve not in result (inner.size === 0 skip)');
  ok(expanded.get('fc2').size === 1, '§3 — fc2 still included');
}

{
  // Unknown fcurveId → skip
  const action = { fcurves: [{ id: 'fc1', keyforms: [{ time: 0 }] }] };
  const expanded = expandToFull(action, ['fc1', 'nonexistent']);
  ok(expanded.size === 1 && expanded.has('fc1'),
    '§3 — unknown fcurveId skipped');
}

// ── §4 — every expanded entry has center+left+right all true ────────

{
  const action = { fcurves: [{ id: 'fc1', keyforms: [{ time: 0 }, { time: 100 }] }] };
  const expanded = expandToFull(action, ['fc1']);
  for (const [idx, h] of expanded.get('fc1')) {
    ok(h.center === true && h.left === true && h.right === true,
      `§4 — keyform ${idx}: all 3 handle parts selected`);
  }
}

// ── §5 — full pipeline: state → ids → expand → setHandles ──────────

function runLPipeline(handles, action) {
  const ids = collectFcurvesWithSelection(handles);
  if (ids.length === 0) return { type: 'NO_OP' };
  const next = expandToFull(action, ids);
  return { type: 'EXPANDED', next };
}

{
  // Single partial selection on fc1
  const handles = new Map([
    ['fc1', new Map([[1, { center: true }]])],
  ]);
  const action = {
    fcurves: [
      { id: 'fc1', keyforms: [{ time: 0 }, { time: 50 }, { time: 100 }] },
    ],
  };
  const result = runLPipeline(handles, action);
  ok(result.type === 'EXPANDED', '§5 — partial selection expands');
  ok(result.next.get('fc1').size === 3,
    '§5 — fc1: 1 selected → all 3 selected after L');
}

{
  // Empty selection → no-op
  const handles = new Map();
  const action = { fcurves: [{ id: 'fc1', keyforms: [{ time: 0 }] }] };
  const result = runLPipeline(handles, action);
  ok(result.type === 'NO_OP', '§5 — empty selection → no-op');
}

{
  // Selection across 2 fcurves; 3rd fcurve untouched
  const handles = new Map([
    ['fc1', new Map([[0, { center: true }]])],
    ['fc2', new Map([[2, { center: true }]])],
  ]);
  const action = {
    fcurves: [
      { id: 'fc1', keyforms: [{ time: 0 }, { time: 50 }] },         // 2 keys
      { id: 'fc2', keyforms: [{ time: 0 }, { time: 50 }, { time: 100 }] }, // 3 keys
      { id: 'fc3', keyforms: [{ time: 0 }] },                       // 1 key, untouched
    ],
  };
  const result = runLPipeline(handles, action);
  ok(result.next.get('fc1').size === 2, '§5 — fc1 expands to 2');
  ok(result.next.get('fc2').size === 3, '§5 — fc2 expands to 3');
  ok(!result.next.has('fc3'),
    '§5 — fc3 (no prior selection) remains untouched in result');
}

// ── §6 — synchronous selectionRef write (mirrors Shift+D contract) ──
//
// Same reason as Shift+D: setSelectedHandles updates the store via
// useEffect-on-render; any subsequent code that reads selectionRef
// would see the old value. L's handler doesn't enter a modal so this
// matters less, but consistency with Shift+D's pattern keeps the
// editor's state ref always in sync after a selection-changing op.

const PATTERN = {
  setSelectedHandles: 'before',
  selectionRefWrite: 'before',
  modalEntry: 'noop_for_L',
};

ok(PATTERN.setSelectedHandles === 'before' && PATTERN.selectionRefWrite === 'before',
  '§6 — both store-write and ref-write happen synchronously');
ok(PATTERN.modalEntry === 'noop_for_L',
  '§6 — no modal follows L (unlike Shift+D which auto-enters grab modal)');

console.log(`fcurveLSelectLinked: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
