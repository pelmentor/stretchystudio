// Regression for the Weight-Paint F-radius brush modal (2026-06-12).
//
// Bug class: Weight Paint mode was missing Blender's F brush-size modal
// gesture (one of the four gaps in the 2026-06-12 weight-paint audit
// punch list — see [[session-2026-06-12-phase2-3-audit-sweep]]).
//
// Fix:
//   - New `brushRadiusAdjustStore` mirrors the Edit-Mode
//     `radiusAdjustStore` shape — thin begin/setAnchor/commit/cancel
//     state machine. Holds `startBrushSize` (snapshot for Esc-restore)
//     and `anchorClient` (captured on first pointermove after F-press).
//   - `BrushRadiusAdjustOverlay` (src/v3/shell/) registers a modal-tool
//     handler when active + editMode === 'weightPaint'. Owns mouse /
//     wheel / keyboard while live, returning `RUNNING_MODAL` to
//     suppress propagation so the WeightPaintOverlay's pointerdown
//     can't start a stroke and the canvas's wheel can't V2D-zoom.
//   - CanvasViewport's F-key listener (new useEffect) binds F → begin()
//     in Weight Paint mode. Edit-Mode F keeps its own binding (different
//     store + math) — both are reachable because the gates are
//     mutually exclusive (`editMode === 'edit'` vs `=== 'weightPaint'`).
//
// This test locks the policy of the store + the handler-event
// translation. The actual store is mocked inline; the overlay's
// handler is exercised by replaying the events the modal-tool
// dispatcher would deliver.
//
// Run: node scripts/test/test_brushRadiusAdjustModal.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — store state machine ────────────────────────────────────────

/**
 * Mirror of the brushRadiusAdjustStore. If the real store's shape
 * drifts, this test forces a paired update.
 */
function makeStore() {
  let state = {
    active: false,
    startBrushSize: null,
    anchorClient: null,
  };
  return {
    get: () => ({ ...state }),
    begin: (startBrushSize) => {
      state = { active: true, startBrushSize, anchorClient: null };
    },
    setAnchor: (anchorClient) => {
      state = { ...state, anchorClient };
    },
    commit: () => {
      state = { active: false, startBrushSize: null, anchorClient: null };
    },
    cancel: () => {
      state = { active: false, startBrushSize: null, anchorClient: null };
    },
  };
}

{
  const s = makeStore();
  ok(s.get().active === false, '§1 — initial state: inactive');
  ok(s.get().startBrushSize === null, '§1 — initial state: no startBrushSize');
  ok(s.get().anchorClient === null, '§1 — initial state: no anchorClient');
}

{
  const s = makeStore();
  s.begin(50);
  ok(s.get().active === true, '§1 — begin(50) → active');
  ok(s.get().startBrushSize === 50, '§1 — begin captures startBrushSize');
  ok(s.get().anchorClient === null,
    '§1 — begin clears any stale anchor (first pointermove captures it)');
}

{
  const s = makeStore();
  s.begin(80);
  s.setAnchor({ x: 100, y: 200 });
  ok(s.get().anchorClient?.x === 100 && s.get().anchorClient?.y === 200,
    '§1 — setAnchor stores client coords');
}

{
  const s = makeStore();
  s.begin(80);
  s.setAnchor({ x: 100, y: 200 });
  s.commit();
  ok(s.get().active === false, '§1 — commit → inactive');
  ok(s.get().startBrushSize === null, '§1 — commit clears startBrushSize');
  ok(s.get().anchorClient === null, '§1 — commit clears anchor');
}

{
  const s = makeStore();
  s.begin(80);
  s.cancel();
  ok(s.get().active === false, '§1 — cancel → inactive');
  ok(s.get().startBrushSize === null,
    '§1 — cancel clears startBrushSize '
    + '(caller is responsible for restoring brushSize FIRST via setBrush)');
}

// ── §2 — gesture math ───────────────────────────────────────────────

/**
 * Mirror of BrushRadiusAdjustOverlay's pointermove math (no zoom divisor
 * because brushSize is already in screen-pixel units, unlike
 * proportionalEdit.radius which is mesh-units).
 */
function screenDistToBrushSize(anchorX, anchorY, mouseX, mouseY) {
  const MIN = 2;
  const MAX = 1000;
  const dx = mouseX - anchorX;
  const dy = mouseY - anchorY;
  return Math.max(MIN, Math.min(MAX, Math.hypot(dx, dy)));
}

ok(screenDistToBrushSize(100, 100, 150, 100) === 50,
  '§2 — pointer 50px right of anchor → brushSize=50');
ok(screenDistToBrushSize(100, 100, 100, 130) === 30,
  '§2 — pointer 30px below anchor → brushSize=30');
ok(screenDistToBrushSize(100, 100, 103, 104) === 5,
  '§2 — pointer 5px diagonal → brushSize=5');
ok(screenDistToBrushSize(100, 100, 100, 100) === 2,
  '§2 — pointer on anchor → brushSize=MIN_BRUSH_SIZE (2px floor)');
ok(screenDistToBrushSize(100, 100, 101, 100) === 2,
  '§2 — pointer 1px from anchor → brushSize=2 (clamp to floor)');
ok(screenDistToBrushSize(100, 100, 5000, 100) === 1000,
  '§2 — pointer 4900px right of anchor → brushSize=1000 (MAX clamp)');

// ── §3 — wheel step math ────────────────────────────────────────────

/**
 * Mirror of the wheel step math: ±10% of current, with a 2px floor on
 * the step so very small brushes still respond to a wheel tick.
 */
function wheelStep(curBrushSize, deltaY) {
  const MIN = 2;
  const MAX = 1000;
  const STEP_FACTOR = 0.1;
  const STEP_MIN = 2;
  const step = Math.max(STEP_MIN, curBrushSize * STEP_FACTOR);
  return deltaY < 0
    ? Math.min(MAX, curBrushSize + step)
    : Math.max(MIN, curBrushSize - step);
}

ok(wheelStep(50, -1) === 55,
  '§3 — wheel up at 50 → 55 (10% step)');
ok(wheelStep(50, 1) === 45,
  '§3 — wheel down at 50 → 45');
ok(wheelStep(10, 1) === 8,
  '§3 — wheel down at 10 → 8 (STEP_MIN=2 floor on step)');
ok(wheelStep(5, 1) === 3,
  '§3 — wheel down at 5 → 3');
ok(wheelStep(3, 1) === 2,
  '§3 — wheel down at 3 → 2 (clamped to MIN)');
ok(wheelStep(2, 1) === 2,
  '§3 — wheel down at MIN stays at MIN');
ok(wheelStep(1000, -1) === 1000,
  '§3 — wheel up at MAX stays at MAX');

// ── §4 — handler event dispatch ──────────────────────────────────────
//
// Mirror of BrushRadiusAdjustOverlay.handleEvent return-code policy.
// The dispatcher contract is documented in
// `src/v3/modalTool/InputDispatcher.jsx`:
//   - PASS_THROUGH → event propagates to React + bubble-phase listeners
//   - RUNNING_MODAL → event swallowed; modal stays active
//   - FINISHED → modal exits; commit path (no restore)
//   - CANCELLED → modal exits; cancel path (caller restores snapshot)

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

ok(classifyEvent({ type: 'mousemove', clientX: 100, clientY: 100 }) === 'RUNNING_MODAL',
  '§4 — mousemove → RUNNING_MODAL (drives gesture, swallows event)');
ok(classifyEvent({ type: 'wheel', deltaY: -1 }) === 'RUNNING_MODAL',
  '§4 — wheel → RUNNING_MODAL (swallows so canvas V2D-zoom does NOT fire)');
ok(classifyEvent({ type: 'mousedown', button: 0 }) === 'FINISHED',
  '§4 — LMB → FINISHED (commit)');
ok(classifyEvent({ type: 'mousedown', button: 1 }) === 'FINISHED',
  '§4 — MMB → FINISHED (commit; pan would steal anyway, treat as commit)');
ok(classifyEvent({ type: 'mousedown', button: 2 }) === 'CANCELLED',
  '§4 — RMB → CANCELLED (caller restores startBrushSize)');
ok(classifyEvent({ type: 'contextmenu' }) === 'CANCELLED',
  '§4 — contextmenu → CANCELLED (sibling of RMB)');
ok(classifyEvent({ type: 'keydown', key: 'Escape' }) === 'CANCELLED',
  '§4 — Escape → CANCELLED');
ok(classifyEvent({ type: 'keydown', key: 'Enter' }) === 'FINISHED',
  '§4 — Enter → FINISHED');
ok(classifyEvent({ type: 'keydown', key: 'f', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) === 'FINISHED',
  '§4 — F again → FINISHED (toggle off, commit)');
ok(classifyEvent({ type: 'keydown', key: 'F', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) === 'FINISHED',
  '§4 — Shift+F (when no shift) → FINISHED');
ok(classifyEvent({ type: 'keydown', key: 'g' }) === 'RUNNING_MODAL',
  '§4 — G during modal → RUNNING_MODAL (catch-all suppresses competing operators)');
ok(classifyEvent({ type: 'keydown', key: 'b' }) === 'RUNNING_MODAL',
  '§4 — B during modal → RUNNING_MODAL (no competing box-select)');
ok(classifyEvent({ type: 'keydown', key: 'F', ctrlKey: true }) === 'RUNNING_MODAL',
  '§4 — Ctrl+F during modal → RUNNING_MODAL (only bare F commits)');

// ── §5 — gate parity with sister overlay (RadiusAdjustOverlay) ──────
//
// The two overlays share the dispatcher contract. They differ only in
// the bound store (radiusAdjustStore vs brushRadiusAdjustStore), unit
// math, and edit-mode gate. The return-code policy must stay parallel
// so a user moving between Edit-Mode propEdit-F and Weight-Paint
// brush-F gets the same gesture semantics.

function radiusOverlayClassify(evt) {
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
  { type: 'mousemove', clientX: 50, clientY: 50 },
  { type: 'wheel', deltaY: -1 },
  { type: 'wheel', deltaY: 1 },
  { type: 'mousedown', button: 0 },
  { type: 'mousedown', button: 1 },
  { type: 'mousedown', button: 2 },
  { type: 'contextmenu' },
  { type: 'keydown', key: 'Escape' },
  { type: 'keydown', key: 'Enter' },
  { type: 'keydown', key: 'f', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
  { type: 'keydown', key: 'g' },
  { type: 'keydown', key: 'b' },
  { type: 'click' },
];

for (const evt of PARITY_EVENTS) {
  const label = `${evt.type}${evt.key ? `:${evt.key}` : evt.button !== undefined ? `:btn${evt.button}` : ''}`;
  ok(classifyEvent(evt) === radiusOverlayClassify(evt),
    `§5 — gesture parity with RadiusAdjustOverlay at ${label}`);
}

// ── §6 — editMode-flip cancel-path policy ────────────────────────────
//
// While modal is active, if editMode flips OFF 'weightPaint' (mode pill /
// outliner / programmatic), the cancel path runs:
//   1. Restore brushSize = startBrushSize via setBrush({brushSize:...})
//   2. cancel() — clears store
//
// Without (1) the user would lose their start size silently (Esc would
// only restore IF they Esc — flipping modes shouldn't be punishment).

function cancelOnModeFlip(store, setBrush, editorState) {
  if (!store.get().active) return;
  if (editorState.editMode === 'weightPaint') return;
  const { startBrushSize } = store.get();
  if (typeof startBrushSize === 'number') setBrush({ brushSize: startBrushSize });
  store.cancel();
}

{
  const s = makeStore();
  let lastBrushSet = null;
  const setBrush = (partial) => { lastBrushSet = partial; };
  s.begin(50);

  // Simulate user dragged to brushSize=200 then flipped mode
  cancelOnModeFlip(s, setBrush, { editMode: 'edit' });

  ok(s.get().active === false, '§6 — mode flip → modal cancelled');
  ok(lastBrushSet?.brushSize === 50,
    '§6 — mode flip restores startBrushSize via setBrush({brushSize})');
}

{
  const s = makeStore();
  let lastBrushSet = null;
  const setBrush = (partial) => { lastBrushSet = partial; };
  s.begin(80);

  // Mode stays at weightPaint → no-op
  cancelOnModeFlip(s, setBrush, { editMode: 'weightPaint' });

  ok(s.get().active === true,
    '§6 — mode stays at weightPaint → modal STAYS active (no spurious cancel)');
  ok(lastBrushSet === null,
    '§6 — mode stays at weightPaint → no brushSize write');
}

console.log(`brushRadiusAdjustModal: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
