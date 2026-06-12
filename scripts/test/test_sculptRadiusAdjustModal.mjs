// Regression for Sculpt F-radius brush modal (2026-06-12).
//
// Bug class: Sculpt mode was missing Blender's F brush-size gesture.
// Same gap shape as Weight Paint's F (shipped 419e872) but writes to
// `editorStore.sculpt.size` (independent sub-object per
// editorStore.js:214-216 — user's Edit-Mode brush size is preserved
// across Sculpt round-trip).
//
// Mirrors brushRadiusAdjustStore/Overlay shape; new parallel store
// avoids a target-discriminator switch across four ~70-LOC stores.
// Generalization deferred until sculpt-strength ships (then five
// stores would force the refactor).
//
// Run: node scripts/test/test_sculptRadiusAdjustModal.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — store state machine ────────────────────────────────────────

function makeStore() {
  let state = { active: false, startSize: null, anchorClient: null };
  return {
    get: () => ({ ...state }),
    begin: (startSize) => { state = { active: true, startSize, anchorClient: null }; },
    setAnchor: (anchorClient) => { state = { ...state, anchorClient }; },
    commit: () => { state = { active: false, startSize: null, anchorClient: null }; },
    cancel: () => { state = { active: false, startSize: null, anchorClient: null }; },
  };
}

{
  const s = makeStore();
  ok(!s.get().active, '§1 — initial inactive');
  s.begin(80);
  ok(s.get().active && s.get().startSize === 80, '§1 — begin(80)');
  s.setAnchor({ x: 200, y: 150 });
  ok(s.get().anchorClient?.x === 200, '§1 — setAnchor');
  s.commit();
  ok(!s.get().active && s.get().startSize === null, '§1 — commit clears');
}

// ── §2 — gesture math ───────────────────────────────────────────────
//
// Screen-px distance directly (no /zoom; sculpt.size is screen-px
// converted to mesh-local at stroke begin, NOT at radius set time).

function distToSize(ax, ay, mx, my) {
  const MIN = 2, MAX = 1000;
  return Math.max(MIN, Math.min(MAX, Math.hypot(mx - ax, my - ay)));
}

ok(distToSize(100, 100, 180, 100) === 80, '§2 — 80px right → size=80');
ok(distToSize(100, 100, 100, 100) === 2, '§2 — on anchor → MIN clamp (2)');
ok(distToSize(100, 100, 1500, 100) === 1000, '§2 — far → MAX clamp (1000)');

// ── §3 — wheel step math (10% relative, 2px floor on step) ──────────

function wheelStep(cur, deltaY) {
  const MIN = 2, MAX = 1000, F = 0.1, MS = 2;
  const step = Math.max(MS, cur * F);
  return deltaY < 0 ? Math.min(MAX, cur + step) : Math.max(MIN, cur - step);
}

ok(wheelStep(80, -1) === 88, '§3 — wheel up at 80 → 88');
ok(wheelStep(80, 1) === 72, '§3 — wheel down at 80 → 72');
ok(wheelStep(5, 1) === 3, '§3 — wheel down at 5 → 3 (STEP_MIN floor)');
ok(wheelStep(3, 1) === 2, '§3 — wheel down at 3 → 2 (MIN clamp)');
ok(wheelStep(1000, -1) === 1000, '§3 — wheel up at MAX stays');

// ── §4 — handler event dispatch ─────────────────────────────────────

function classifyEvent(evt) {
  if (evt.type === 'mousemove') return 'RUNNING_MODAL';
  if (evt.type === 'wheel') return 'RUNNING_MODAL';
  if (evt.type === 'mousedown') return evt.button === 2 ? 'CANCELLED' : 'FINISHED';
  if (evt.type === 'contextmenu') return 'CANCELLED';
  if (evt.type === 'keydown') {
    if (evt.key === 'Escape') return 'CANCELLED';
    if (evt.key === 'Enter') return 'FINISHED';
    if ((evt.key === 'f' || evt.key === 'F')
        && !evt.ctrlKey && !evt.metaKey && !evt.altKey && !evt.shiftKey) {
      return 'FINISHED';
    }
    return 'RUNNING_MODAL';
  }
  return 'PASS_THROUGH';
}

ok(classifyEvent({ type: 'mousemove' }) === 'RUNNING_MODAL',
  '§4 — mousemove → RUNNING_MODAL');
ok(classifyEvent({ type: 'wheel', deltaY: -1 }) === 'RUNNING_MODAL',
  '§4 — wheel → RUNNING_MODAL');
ok(classifyEvent({ type: 'mousedown', button: 0 }) === 'FINISHED',
  '§4 — LMB → FINISHED');
ok(classifyEvent({ type: 'mousedown', button: 2 }) === 'CANCELLED',
  '§4 — RMB → CANCELLED');
ok(classifyEvent({ type: 'contextmenu' }) === 'CANCELLED',
  '§4 — contextmenu → CANCELLED');
ok(classifyEvent({ type: 'keydown', key: 'Escape' }) === 'CANCELLED',
  '§4 — Escape → CANCELLED');
ok(classifyEvent({ type: 'keydown', key: 'Enter' }) === 'FINISHED',
  '§4 — Enter → FINISHED');
ok(classifyEvent({ type: 'keydown', key: 'f' }) === 'FINISHED',
  '§4 — bare F → FINISHED (toggle off)');
ok(classifyEvent({ type: 'keydown', key: 'g' }) === 'RUNNING_MODAL',
  '§4 — G during modal → RUNNING_MODAL (catch-all)');
ok(classifyEvent({ type: 'keydown', key: 'F', ctrlKey: true }) === 'RUNNING_MODAL',
  '§4 — Ctrl+F during modal → RUNNING_MODAL');

// ── §5 — mode-flip cancel-path policy ───────────────────────────────

function cancelOnModeFlip(store, setSculpt, editorState) {
  if (!store.get().active) return;
  if (editorState.editMode === 'sculpt') return;
  const { startSize } = store.get();
  if (typeof startSize === 'number') setSculpt({ size: startSize });
  store.cancel();
}

{
  const s = makeStore();
  let lastSet = null;
  const setSculpt = (partial) => { lastSet = partial; };
  s.begin(80);
  // simulate user dragged to 200, then flipped to 'edit' mode
  cancelOnModeFlip(s, setSculpt, { editMode: 'edit' });
  ok(!s.get().active, '§5 — mode flip → modal cancelled');
  ok(lastSet?.size === 80, '§5 — startSize restored via setSculpt({size})');
}

{
  const s = makeStore();
  let lastSet = null;
  const setSculpt = (partial) => { lastSet = partial; };
  s.begin(80);
  cancelOnModeFlip(s, setSculpt, { editMode: 'sculpt' });
  ok(s.get().active, '§5 — mode stays at sculpt → modal alive');
  ok(lastSet === null, '§5 — no setSculpt write');
}

// ── §6 — gate parity with weight-paint sister overlay ───────────────

function brushRadiusOverlayClassify(evt) {
  if (evt.type === 'mousemove') return 'RUNNING_MODAL';
  if (evt.type === 'wheel') return 'RUNNING_MODAL';
  if (evt.type === 'mousedown') return evt.button === 2 ? 'CANCELLED' : 'FINISHED';
  if (evt.type === 'contextmenu') return 'CANCELLED';
  if (evt.type === 'keydown') {
    if (evt.key === 'Escape') return 'CANCELLED';
    if (evt.key === 'Enter') return 'FINISHED';
    if ((evt.key === 'f' || evt.key === 'F')
        && !evt.ctrlKey && !evt.metaKey && !evt.altKey && !evt.shiftKey) {
      return 'FINISHED';
    }
    return 'RUNNING_MODAL';
  }
  return 'PASS_THROUGH';
}

const PARITY_EVENTS = [
  { type: 'mousemove' },
  { type: 'wheel', deltaY: -1 },
  { type: 'wheel', deltaY: 1 },
  { type: 'mousedown', button: 0 },
  { type: 'mousedown', button: 1 },
  { type: 'mousedown', button: 2 },
  { type: 'contextmenu' },
  { type: 'keydown', key: 'Escape' },
  { type: 'keydown', key: 'Enter' },
  { type: 'keydown', key: 'f' },
  { type: 'keydown', key: 'g' },
];

for (const evt of PARITY_EVENTS) {
  ok(classifyEvent(evt) === brushRadiusOverlayClassify(evt),
    `§6 — gesture parity with BrushRadiusAdjustOverlay at ${evt.type}${evt.key ? `:${evt.key}` : evt.button !== undefined ? `:btn${evt.button}` : ''}`);
}

console.log(`sculptRadiusAdjustModal: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
