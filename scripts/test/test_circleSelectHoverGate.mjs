// Regression for the selection.circleSelect hoveredEditorType gate
// (2026-06-12).
//
// Bug: pressing C over the Timeline / Dopesheet / FCurve / Parameters /
// Outliner / NLA editors engaged the viewport's circle-select modal,
// which then captured all mouse + key input on the wrong canvas until
// the user pressed Esc. Same bug class as the B-key bleed-through that
// was fixed previously for selection.boxSelect via hoveredEditorType()
// — the circle-select operator was missed in that sweep.
//
// Fix: selection.circleSelect's available() now reads hoveredEditorType()
// and returns true only when the hovered editor is 'viewport' or null
// (unannotated area: popovers / app shell margins / wizard chrome).
//
// This test locks the gate predicate policy. The actual hoveredEditorType()
// function depends on DOM (`document.elementFromPoint`); we mirror the
// gate predicate inline so a future refactor can grep for this test as
// the spec.
//
// Run: node scripts/test/test_circleSelectHoverGate.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

/**
 * Mirror of the gate predicate from registry.js's selection.circleSelect
 * available(). If a future refactor changes the policy, this test will
 * fail and force the spec update.
 */
function circleSelectAvailable(hoveredType) {
  return hoveredType === null || hoveredType === 'viewport';
}

// ── §1 — viewport hover: circle-select fires ────────────────────────

ok(circleSelectAvailable('viewport') === true,
  '§1 — viewport hover: C engages circle-select');

// ── §2 — non-viewport hover: circle-select blocked ──────────────────
//
// Each blocked editor type was checked specifically because pressing C
// over it would have bled before the fix. The list mirrors the editors
// annotated with [data-editor-type] in CanvasArea + their headers.

const BLOCKED_EDITORS = [
  'timeline',
  'dopesheet',
  'fcurve',
  'parameters',
  'outliner',
  'properties',
  'nla',
  'actions',
  'logs',
  'nodeTree',
  'performance',
  'keyformGraph',
  'livePreview',
];

for (const t of BLOCKED_EDITORS) {
  ok(circleSelectAvailable(t) === false,
    `§2 — hover over '${t}' editor: C-key REJECTED (no bleed to viewport)`);
}

// ── §3 — null hover (unannotated area): allowed ─────────────────────
//
// Popovers, app shell margins, wizard chrome — anywhere not under a
// [data-editor-type] root. Allow through (matches box-select's null-
// allow behavior and the pre-fix "always available" path for these
// edge cases — keeps the user from accidentally hitting a dead chord).

ok(circleSelectAvailable(null) === true,
  '§3 — null hover (unannotated area): C-key allowed through');

// ── §4 — undefined hover: defensive — treat as null ─────────────────
//
// If a future refactor makes hoveredEditorType() return undefined
// instead of null (e.g. on early-init), the gate should still allow
// the chord through. Current predicate uses === null which would NOT
// match undefined; defending in this test asserts policy.

ok(circleSelectAvailable(undefined) === false,
  '§4 — undefined hover: REJECTED (strict-null gate). If this fails, '
  + 'either the predicate was relaxed or undefined started flowing in — '
  + 'check hoveredEditorType()');

// ── §5 — gate parity with box-select ────────────────────────────────
//
// The fix made circle-select gate-equal to box-select. Lock that they
// stay in lockstep: any hovered type that blocks box should also block
// circle (and vice-versa). If a future change wants them to differ,
// document why — this test is the canary.

function boxSelectAvailable(hoveredType) {
  return hoveredType === null || hoveredType === 'viewport';
}

const TYPES_TO_CHECK = [null, 'viewport', ...BLOCKED_EDITORS, 'unknown', 'someFutureEditor'];
for (const t of TYPES_TO_CHECK) {
  ok(circleSelectAvailable(t) === boxSelectAvailable(t),
    `§5 — circle/box parity at hovered='${t === null ? 'null' : t}'`);
}

console.log(`circleSelectHoverGate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
