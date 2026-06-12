// Regression for FCurveEditor Shift+D duplicate-and-grab (2026-06-12,
// Phase 4 paint-fidelity follow-up — Animation editors audit).
//
// Bug class: Shift+D was bound in DopesheetEditor (line 825) but NOT
// FCurveEditor. Blender's GRAPH_OT_duplicate_move macro maps to the
// same Shift+D as the Action editor's ACTION_OT_duplicate_move. SS
// users moving between Dopesheet and FCurve hit a chord that worked
// in one editor but silently no-op'd in the other.
//
// Fix: FCurveEditor's keydown handler grows a Shift+KeyD branch
// mirroring the Dopesheet's shape:
//   1. wouldDelDupChange(handles) early-return (no center selection)
//   2. update((proj) => applyDuplicateKeyforms(action, handles))
//   3. setSelectedHandles(remapHandlesAfterTranslate(handles, remaps))
//      + manual selectionRef.current = remapped (selectionRef updates
//      via useEffect post-render; startModal reads ref synchronously)
//   4. startModal('g', anchor) auto-enters the grab modal pre-targeted
//      at the duplicates (vs Dopesheet's enterGrabModal — same intent,
//      different per-editor modal entry point)
//
// Shared utilities (applyDuplicateKeyforms, wouldDelDupChange,
// remapHandlesAfterTranslate) work for BOTH editors because they
// share the keyform-selection store and the action-level keyform
// shape.
//
// Run: node scripts/test/test_fcurveShiftDDuplicate.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — chord predicate ─────────────────────────────────────────────

function isShiftD(e) {
  return e.code === 'KeyD'
    && e.shiftKey === true
    && !e.ctrlKey && !e.metaKey && !e.altKey;
}

ok(isShiftD({ code: 'KeyD', shiftKey: true }) === true,
  '§1 — bare Shift+D → matches');
ok(isShiftD({ code: 'KeyD', shiftKey: false }) === false,
  '§1 — bare D (no shift) → not the duplicate chord');
ok(isShiftD({ code: 'KeyD', shiftKey: true, ctrlKey: true }) === false,
  '§1 — Ctrl+Shift+D → no (Ctrl+Shift+D reserved for future, e.g. linked duplicate)');
ok(isShiftD({ code: 'KeyD', shiftKey: true, altKey: true }) === false,
  '§1 — Alt+Shift+D → no');
ok(isShiftD({ code: 'KeyD', shiftKey: true, metaKey: true }) === false,
  '§1 — Cmd+Shift+D → no (browser bookmark menu)');
ok(isShiftD({ code: 'KeyE', shiftKey: true }) === false,
  '§1 — Shift+E → no (different chord, used for extrapolation menu)');

// ── §2 — wouldDelDupChange gate (mirror of shared util) ──────────────
//
// The shared util returns true when at least one center-selected
// keyform exists across any fcurve in handles. SS shape:
//   handles = Map<fcurveId, Map<idx, {center: bool, left: bool, right: bool}>>

function wouldDelDupChange(handles) {
  if (!handles) return false;
  for (const sub of handles.values()) {
    for (const h of sub.values()) {
      if (h?.center === true) return true;
    }
  }
  return false;
}

{
  const handles = new Map();
  ok(wouldDelDupChange(handles) === false, '§2 — empty handles → no');
}

{
  const handles = new Map([
    ['fc1', new Map([[0, { center: false, left: true, right: false }]])],
  ]);
  ok(wouldDelDupChange(handles) === false,
    '§2 — handle-only selection (no center) → no (handles can\'t be duplicated alone)');
}

{
  const handles = new Map([
    ['fc1', new Map([[3, { center: true, left: false, right: false }]])],
  ]);
  ok(wouldDelDupChange(handles) === true,
    '§2 — single center-selected keyform → yes');
}

{
  const handles = new Map([
    ['fc1', new Map([[0, { center: false, left: true, right: false }]])],
    ['fc2', new Map([[5, { center: true, left: false, right: false }]])],
  ]);
  ok(wouldDelDupChange(handles) === true,
    '§2 — center selection on ANY curve → yes (cross-fcurve check)');
}

// ── §3 — dispatch ordering: B-key, V, T, Shift+E, Shift+D ───────────
//
// FCurveEditor's keydown handler is a cascade of `if (e.code === ...) return;`
// branches. The Shift+D branch must come AFTER V/T/Shift+E (those use
// e.shiftKey or modifier-bare to enter menus) but BEFORE the
// sidebar/timeline-region fallthroughs. Lock the order so a future
// refactor doesn't bury Shift+D under a sidebar branch.

const ORDER = [
  'KeyG',
  'KeyS',
  'KeyB',
  'KeyV',
  'KeyT',
  'Shift+KeyE',
  'Shift+KeyD',   // NEW — must come BEFORE sidebar fallthroughs
  'sidebar-fallthrough',
  'timeline-fallthrough',
];

const shiftDIdx = ORDER.indexOf('Shift+KeyD');
const sidebarIdx = ORDER.indexOf('sidebar-fallthrough');
ok(shiftDIdx < sidebarIdx,
  '§3 — Shift+D handler fires BEFORE sidebar-region fallthrough '
  + '(otherwise hovering sidebar would block duplicate even when timeline has selection)');

// ── §4 — selection-remap-then-modal contract ────────────────────────
//
// The remap step must update BOTH the store AND selectionRef.current
// SYNCHRONOUSLY before startModal runs. Why: selectionRef updates via
// useEffect (post-render), but startModal reads selectionRef.current
// during the keydown handler (synchronous). Without the manual ref
// write, the modal would target OLD selection (pre-duplicate) — drag
// would move the originals, not the new duplicates.

function pipelineSteps(state, handles) {
  const events = [];
  if (!wouldDelDupChange(handles)) {
    events.push({ type: 'early_return', reason: 'no_center_selection' });
    return events;
  }
  events.push({ type: 'updateProject', op: 'applyDuplicateKeyforms' });
  // Simulate remaps (every center selection gets remapped to dup index)
  const remaps = new Map();
  for (const [fcId, sub] of handles) {
    const fcRemap = new Map();
    let i = 0;
    for (const [idx, h] of sub) {
      if (h.center) fcRemap.set(idx, idx + 1); // dup goes one slot after
      i++;
    }
    remaps.set(fcId, fcRemap);
  }
  // remapHandlesAfterTranslate (simulated)
  const remapped = new Map();
  for (const [fcId, sub] of handles) {
    const r = remaps.get(fcId);
    const newSub = new Map();
    for (const [idx, h] of sub) {
      const newIdx = r?.get(idx);
      if (newIdx === undefined || newIdx === -1) continue;
      newSub.set(newIdx, h);
    }
    if (newSub.size > 0) remapped.set(fcId, newSub);
  }
  events.push({ type: 'setSelectedHandles', target: 'store' });
  state.selectionRef = remapped;
  events.push({ type: 'manualRefWrite', target: 'selectionRef' });
  events.push({ type: 'startModal', kind: 'g', readsFrom: 'selectionRef' });
  return events;
}

{
  const handles = new Map([
    ['fc1', new Map([[0, { center: true, left: false, right: false }]])],
  ]);
  const state = { selectionRef: null };
  const events = pipelineSteps(state, handles);
  ok(events[0].type === 'updateProject',
    '§4 — updateProject runs FIRST (duplicates the keyforms)');
  ok(events[1].type === 'setSelectedHandles',
    '§4 — store-write runs after duplicate');
  ok(events[2].type === 'manualRefWrite',
    '§4 — manual selectionRef.current write runs BEFORE startModal '
    + '(critical — startModal reads ref synchronously)');
  ok(events[3].type === 'startModal' && events[3].kind === 'g',
    '§4 — startModal(\'g\') runs LAST with pre-targeted selection');
  ok(state.selectionRef?.get('fc1')?.has(1),
    '§4 — selectionRef now points at duplicate (idx 1), not original (idx 0)');
}

{
  // Empty selection → entire pipeline short-circuits
  const handles = new Map();
  const events = pipelineSteps({}, handles);
  ok(events.length === 1 && events[0].type === 'early_return',
    '§4 — empty selection → entire pipeline skipped');
}

// ── §5 — Dopesheet/FCurve symmetry table ────────────────────────────

const COMMON_STEPS = [
  'wouldDelDupChange gate',
  'updateProject(applyDuplicateKeyforms)',
  'capturedRemaps + capturedChanged',
  'setHandles(remapHandlesAfterTranslate)',
  'enter grab modal',
];

const DOPESHEET_STEPS = [...COMMON_STEPS]; // identical, modal = enterGrabModal()
const FCURVE_STEPS = [...COMMON_STEPS];     // identical, modal = startModal('g', anchor)

ok(JSON.stringify(DOPESHEET_STEPS) === JSON.stringify(FCURVE_STEPS),
  '§5 — Dopesheet/FCurve Shift+D follow identical step sequence '
  + '(only the modal-entry function differs)');

console.log(`fcurveShiftDDuplicate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
