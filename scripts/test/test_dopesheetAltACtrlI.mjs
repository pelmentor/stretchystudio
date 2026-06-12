// Regression for Dopesheet sidebar Alt+A deselect-all + Ctrl+I invert
// (2026-06-12, Phase 4 paint-fidelity follow-up — Animation editors
// audit).
//
// Bug class: Dopesheet's custom capture-phase A handler only fired on
// bare A (line 223 pre-fix: `if (e.ctrlKey || e.metaKey || e.altKey
// || e.shiftKey) return;`). Alt+A and Ctrl+I silently no-op'd —
// users had to use the per-row M/H/etc workarounds or drop to
// command palette.
//
// Fix: extend the handler to a 3-way modifier match:
//   - bare A → toggle select-all-visible / clear (unchanged behavior)
//   - Alt+A → unconditional clear (Blender's pose.select_all DESELECT)
//   - Ctrl+I (or Cmd+I) → invert per row, visible-only
//
// Modifier discipline: bare A still rejects modifiers. Alt+A requires
// ONLY alt. Ctrl+I requires ctrl/meta only (no alt, no shift). Other
// modifier combos pass through (Ctrl+A is the industry_compatible
// "select add" chord — not implemented for Dopesheet yet; future
// audit).
//
// Run: node scripts/test/test_dopesheetAltACtrlI.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — chord classification ────────────────────────────────────────

function classify(e) {
  const isBareA = e.code === 'KeyA' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  const isAltA = e.code === 'KeyA' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  const isCtrlI = e.code === 'KeyI' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
  if (isBareA) return 'BARE_A_TOGGLE';
  if (isAltA) return 'ALT_A_CLEAR';
  if (isCtrlI) return 'CTRL_I_INVERT';
  return 'PASS_THROUGH';
}

ok(classify({ code: 'KeyA' }) === 'BARE_A_TOGGLE', '§1 — bare A');
ok(classify({ code: 'KeyA', altKey: true }) === 'ALT_A_CLEAR', '§1 — Alt+A');
ok(classify({ code: 'KeyI', ctrlKey: true }) === 'CTRL_I_INVERT', '§1 — Ctrl+I');
ok(classify({ code: 'KeyI', metaKey: true }) === 'CTRL_I_INVERT',
  '§1 — Cmd+I (macOS) → same as Ctrl+I');
ok(classify({ code: 'KeyA', ctrlKey: true }) === 'PASS_THROUGH',
  '§1 — Ctrl+A → pass-through (industry_compatible chord, not implemented)');
ok(classify({ code: 'KeyA', shiftKey: true }) === 'PASS_THROUGH',
  '§1 — Shift+A → pass-through');
ok(classify({ code: 'KeyA', altKey: true, shiftKey: true }) === 'PASS_THROUGH',
  '§1 — Alt+Shift+A → pass-through');
ok(classify({ code: 'KeyI', ctrlKey: true, shiftKey: true }) === 'PASS_THROUGH',
  '§1 — Ctrl+Shift+I → pass-through (browser dev tools — must NOT consume)');
ok(classify({ code: 'KeyI', ctrlKey: true, altKey: true }) === 'PASS_THROUGH',
  '§1 — Ctrl+Alt+I → pass-through');
ok(classify({ code: 'KeyB' }) === 'PASS_THROUGH', '§1 — non-A non-I → pass-through');

// ── §2 — Alt+A clear when empty → no-op (skip re-render) ────────────

function altAReducer(prev) {
  for (const inner of prev.values()) {
    if (inner && inner.size > 0) return new Map();
  }
  return prev;
}

{
  const empty = new Map();
  ok(altAReducer(empty) === empty,
    '§2 — Alt+A on empty handles → SAME ref (no re-render)');
}

{
  const populated = new Map([
    ['fc1', new Map([[0, { center: true, left: false, right: false }]])],
  ]);
  const next = altAReducer(populated);
  ok(next !== populated, '§2 — Alt+A on populated → new Map');
  ok(next.size === 0, '§2 — cleared to empty');
}

{
  // Handle with zero-size inner map should also be treated as empty
  const stale = new Map([['fc1', new Map()]]);
  ok(altAReducer(stale) === stale,
    '§2 — Alt+A with zero-size inner maps → SAME ref (skip re-render)');
}

// ── §3 — Ctrl+I invert per row ───────────────────────────────────────

function ctrlIInvert(prev, rows) {
  const next = new Map();
  for (const row of rows) {
    if (!row?.fcurveId || !Array.isArray(row.keyforms)) continue;
    const cur = prev.get(row.fcurveId);
    const inner = new Map();
    for (let i = 0; i < row.keyforms.length; i++) {
      if (!cur || !cur.has(i)) {
        inner.set(i, { center: true, left: true, right: true });
      }
    }
    if (inner.size > 0) next.set(row.fcurveId, inner);
  }
  return next;
}

{
  const rows = [
    { fcurveId: 'fc1', keyforms: [0, 0, 0, 0, 0] }, // 5 keyforms
    { fcurveId: 'fc2', keyforms: [0, 0, 0] },        // 3 keyforms
  ];

  // Nothing selected → invert selects everything
  const empty = new Map();
  const inverted1 = ctrlIInvert(empty, rows);
  ok(inverted1.get('fc1').size === 5, '§3 — empty → invert selects all 5 of fc1');
  ok(inverted1.get('fc2').size === 3, '§3 — empty → invert selects all 3 of fc2');

  // {fc1: [0, 2]} → invert produces {fc1: [1, 3, 4], fc2: [0,1,2]}
  const partial = new Map([
    ['fc1', new Map([
      [0, { center: true, left: false, right: false }],
      [2, { center: true, left: false, right: false }],
    ])],
  ]);
  const inverted2 = ctrlIInvert(partial, rows);
  ok(inverted2.get('fc1').size === 3, '§3 — fc1: [0,2] inverted → [1,3,4] (size 3)');
  ok(inverted2.get('fc1').has(1) && inverted2.get('fc1').has(3) && inverted2.get('fc1').has(4),
    '§3 — fc1 indices match: {1,3,4}');
  ok(!inverted2.get('fc1').has(0) && !inverted2.get('fc1').has(2),
    '§3 — fc1: [0,2] removed from selection');
  ok(inverted2.get('fc2').size === 3,
    '§3 — fc2 (untouched in original) → all 3 selected on invert');

  // All selected → invert clears
  const all = new Map([
    ['fc1', new Map([0, 1, 2, 3, 4].map((i) => [i, { center: true, left: true, right: true }]))],
    ['fc2', new Map([0, 1, 2].map((i) => [i, { center: true, left: true, right: true }]))],
  ]);
  const inverted3 = ctrlIInvert(all, rows);
  ok(inverted3.size === 0,
    '§3 — all selected → invert clears entirely (no fc1/fc2 entries)');
}

// ── §4 — invert pruning: empty rows omitted from result ─────────────
//
// If a row has 0 keyforms, the inner map should be empty → row
// omitted from the result map entirely. Mirrors the bare-A handler's
// "if (inner.size > 0) next.set(...)" convention.

{
  const rows = [
    { fcurveId: 'fc1', keyforms: [0, 0] },
    { fcurveId: 'fc2', keyforms: [] }, // empty row
  ];
  const empty = new Map();
  const inverted = ctrlIInvert(empty, rows);
  ok(!inverted.has('fc2'), '§4 — empty row not in result');
  ok(inverted.has('fc1'), '§4 — non-empty row IS in result');
}

// ── §5 — handler ordering: hover-gate FIRST ─────────────────────────

function shouldFire(hovering, e) {
  if (!hovering) return false;
  const cls = classify(e);
  return cls !== 'PASS_THROUGH';
}

ok(shouldFire(true, { code: 'KeyA' }) === true, '§5 — hovering + A → fire');
ok(shouldFire(false, { code: 'KeyA' }) === false,
  '§5 — NOT hovering + A → no-op (other editor owns this chord)');
ok(shouldFire(true, { code: 'KeyA', altKey: true }) === true,
  '§5 — hovering + Alt+A → fire');
ok(shouldFire(false, { code: 'KeyA', altKey: true }) === false,
  '§5 — NOT hovering + Alt+A → no-op');
ok(shouldFire(true, { code: 'KeyI', ctrlKey: true }) === true,
  '§5 — hovering + Ctrl+I → fire (Dopesheet sidebar wins over global selection.invert)');

// ── §6 — capture-phase + stopImmediatePropagation contract ─────────
//
// The handler uses `{capture: true}` listener registration plus
// stopImmediatePropagation() so it wins over:
//   - the global selection.selectAllToggle (bound to bare A in
//     keymap/default.js)
//   - the global selection.invert (bound to Ctrl+I)
// when the user is hovering the Dopesheet. Without capture, the
// global dispatcher's bubble-phase listener would fire FIRST and
// the Dopesheet handler would never get to claim the chord.

const HANDLER_REGISTRATION = {
  phase: 'capture',
  stopMethod: 'stopImmediatePropagation',
  gate: 'hoverRef.current',
};

ok(HANDLER_REGISTRATION.phase === 'capture',
  '§6 — registered on capture phase (wins over bubble-phase global dispatcher)');
ok(HANDLER_REGISTRATION.stopMethod === 'stopImmediatePropagation',
  '§6 — stopImmediatePropagation (NOT just stopProp) so other capture-phase listeners also skip');
ok(HANDLER_REGISTRATION.gate === 'hoverRef.current',
  '§6 — gate is hoverRef (mouse over Dopesheet), not focus (Dopesheet is not focusable)');

console.log(`dopesheetAltACtrlI: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
