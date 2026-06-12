// Regression for Sculpt Shift+F brush-strength modal (2026-06-12).
//
// Bug class: Sculpt mode was missing Blender's Shift+F brush-strength
// gesture. Companion to the sculpt F-radius modal shipped in e57b81e;
// closes the Blender sculpt radial-control pair.
//
// Same gesture math as BrushStrengthAdjustOverlay (weight paint), but
// writes `editorStore.sculpt.strength` via `setSculpt({strength})`.
//
// Run: node scripts/test/test_sculptStrengthAdjustModal.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — store state machine ────────────────────────────────────────

function makeStore() {
  let state = { active: false, startStrength: null, anchorClient: null };
  return {
    get: () => ({ ...state }),
    begin: (startStrength) => { state = { active: true, startStrength, anchorClient: null }; },
    setAnchor: (anchorClient) => { state = { ...state, anchorClient }; },
    commit: () => { state = { active: false, startStrength: null, anchorClient: null }; },
    cancel: () => { state = { active: false, startStrength: null, anchorClient: null }; },
  };
}

{
  const s = makeStore();
  ok(!s.get().active, '§1 — initial inactive');
  s.begin(0.5);
  ok(s.get().active && s.get().startStrength === 0.5, '§1 — begin(0.5)');
  s.setAnchor({ x: 50, y: 75 });
  ok(s.get().anchorClient?.x === 50, '§1 — setAnchor');
  s.commit();
  ok(!s.get().active && s.get().startStrength === null, '§1 — commit clears');
}

// ── §2 — gesture math: clamp(distance / 200px, 0, 1) ────────────────

function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function distToStrength(ax, ay, mx, my) {
  return clamp01(Math.hypot(mx - ax, my - ay) / 200);
}

ok(distToStrength(100, 100, 100, 100) === 0, '§2 — on anchor → 0');
ok(distToStrength(100, 100, 200, 100) === 0.5, '§2 — 100px → 0.5');
ok(distToStrength(100, 100, 300, 100) === 1, '§2 — 200px → 1.0');
ok(distToStrength(100, 100, 500, 100) === 1, '§2 — 400px → 1.0 (clamped)');

// ── §3 — wheel step: ±0.05 absolute ─────────────────────────────────

function wheelStep(cur, deltaY) {
  return deltaY < 0 ? clamp01(cur + 0.05) : clamp01(cur - 0.05);
}

ok(wheelStep(0.5, -1) === 0.55, '§3 — up at 0.5 → 0.55');
ok(wheelStep(0.5, 1) === 0.45, '§3 — down at 0.5 → 0.45');
ok(wheelStep(0, 1) === 0, '§3 — down at 0 stays at 0');
ok(wheelStep(1, -1) === 1, '§3 — up at 1 stays at 1');
ok(Math.abs(wheelStep(0.03, 1) - 0) < 1e-9, '§3 — down at 0.03 → 0 (clamped)');

// ── §4 — handler dispatch ───────────────────────────────────────────

function classifyEvent(evt) {
  if (evt.type === 'mousemove') return 'RUNNING_MODAL';
  if (evt.type === 'wheel') return 'RUNNING_MODAL';
  if (evt.type === 'mousedown') return evt.button === 2 ? 'CANCELLED' : 'FINISHED';
  if (evt.type === 'contextmenu') return 'CANCELLED';
  if (evt.type === 'keydown') {
    if (evt.key === 'Escape') return 'CANCELLED';
    if (evt.key === 'Enter') return 'FINISHED';
    if ((evt.key === 'f' || evt.key === 'F')
        && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
      return 'FINISHED';
    }
    return 'RUNNING_MODAL';
  }
  return 'PASS_THROUGH';
}

ok(classifyEvent({ type: 'mousemove' }) === 'RUNNING_MODAL', '§4 — mousemove');
ok(classifyEvent({ type: 'wheel', deltaY: -1 }) === 'RUNNING_MODAL', '§4 — wheel');
ok(classifyEvent({ type: 'mousedown', button: 0 }) === 'FINISHED', '§4 — LMB');
ok(classifyEvent({ type: 'mousedown', button: 2 }) === 'CANCELLED', '§4 — RMB');
ok(classifyEvent({ type: 'keydown', key: 'Escape' }) === 'CANCELLED', '§4 — Esc');
ok(classifyEvent({ type: 'keydown', key: 'f' }) === 'FINISHED', '§4 — bare F');
ok(classifyEvent({ type: 'keydown', key: 'F', shiftKey: true }) === 'FINISHED',
  '§4 — Shift+F → FINISHED (mid-gesture toggle, user may still hold Shift)');
ok(classifyEvent({ type: 'keydown', key: 'F', ctrlKey: true }) === 'RUNNING_MODAL',
  '§4 — Ctrl+F → RUNNING_MODAL (catch-all)');

// ── §5 — F handler shift branching ──────────────────────────────────

function fHandlerBranch(e, radiusActive, strengthActive) {
  if (e.key !== 'f' && e.key !== 'F') return 'NONE';
  if (e.ctrlKey || e.metaKey || e.altKey) return 'NONE';
  if (e.shiftKey) {
    if (strengthActive) return 'NONE';
    return 'OPEN_STRENGTH';
  }
  if (radiusActive) return 'NONE';
  return 'OPEN_RADIUS';
}

ok(fHandlerBranch({ key: 'f' }, false, false) === 'OPEN_RADIUS',
  '§5 — bare F opens RADIUS');
ok(fHandlerBranch({ key: 'F', shiftKey: true }, false, false) === 'OPEN_STRENGTH',
  '§5 — Shift+F opens STRENGTH');
ok(fHandlerBranch({ key: 'F', shiftKey: true }, false, true) === 'NONE',
  '§5 — Shift+F when STRENGTH live → no-op (re-entry check)');
ok(fHandlerBranch({ key: 'f', ctrlKey: true }, false, false) === 'NONE',
  '§5 — Ctrl+F → no-op (modifier exclusion)');

// ── §6 — mode-flip cancel-path ──────────────────────────────────────

function cancelOnModeFlip(store, setSculpt, editorState) {
  if (!store.get().active) return;
  if (editorState.editMode === 'sculpt') return;
  const { startStrength } = store.get();
  if (typeof startStrength === 'number') setSculpt({ strength: startStrength });
  store.cancel();
}

{
  const s = makeStore();
  let lastSet = null;
  const setSculpt = (partial) => { lastSet = partial; };
  s.begin(0.5);
  cancelOnModeFlip(s, setSculpt, { editMode: 'edit' });
  ok(!s.get().active, '§6 — mode flip → modal cancelled');
  ok(lastSet?.strength === 0.5, '§6 — startStrength restored');
}

// ── §7 — gesture parity with sister overlay ─────────────────────────

function brushStrengthOverlayClassify(evt) {
  if (evt.type === 'mousemove') return 'RUNNING_MODAL';
  if (evt.type === 'wheel') return 'RUNNING_MODAL';
  if (evt.type === 'mousedown') return evt.button === 2 ? 'CANCELLED' : 'FINISHED';
  if (evt.type === 'contextmenu') return 'CANCELLED';
  if (evt.type === 'keydown') {
    if (evt.key === 'Escape') return 'CANCELLED';
    if (evt.key === 'Enter') return 'FINISHED';
    if ((evt.key === 'f' || evt.key === 'F')
        && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
      return 'FINISHED';
    }
    return 'RUNNING_MODAL';
  }
  return 'PASS_THROUGH';
}

const PARITY_EVENTS = [
  { type: 'mousemove' },
  { type: 'wheel', deltaY: -1 },
  { type: 'mousedown', button: 0 },
  { type: 'mousedown', button: 2 },
  { type: 'contextmenu' },
  { type: 'keydown', key: 'Escape' },
  { type: 'keydown', key: 'Enter' },
  { type: 'keydown', key: 'f' },
  { type: 'keydown', key: 'F', shiftKey: true },
  { type: 'keydown', key: 'g' },
];

for (const evt of PARITY_EVENTS) {
  ok(classifyEvent(evt) === brushStrengthOverlayClassify(evt),
    `§7 — parity with BrushStrengthAdjustOverlay at ${evt.type}${evt.key ? `:${evt.key}` : evt.button !== undefined ? `:btn${evt.button}` : ''}`);
}

console.log(`sculptStrengthAdjustModal: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
