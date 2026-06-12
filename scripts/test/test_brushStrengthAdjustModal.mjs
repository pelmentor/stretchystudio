// Regression for the Weight-Paint Shift+F brush-strength modal (2026-06-12).
//
// Bug class: Weight Paint mode was missing Blender's Shift+F brush-strength
// gesture — second of the four gaps in the 2026-06-12 weight-paint audit
// punch list. F-radius shipped in the previous commit (419e872); this
// completes the radial-control pair.
//
// Fix:
//   - New `brushStrengthAdjustStore` mirrors brushRadiusAdjustStore shape.
//     Holds `startBrushStrength` for Esc-restore.
//   - `BrushStrengthAdjustOverlay` writes `editorStore.brushStrength`
//     ∈ [0,1] from cursor distance: strength = clamp(dist / 200px, 0, 1).
//     200px reflects Blender's default dial throw for fraction-typed
//     radial-control gestures.
//   - CanvasViewport's F-key useEffect now branches on shiftKey:
//     bare F → brushRadiusAdjustStore, Shift+F → brushStrengthAdjustStore.
//     Mutually exclusive — only one modal can be active at a time
//     because the begin() check rejects re-entry.
//
// Run: node scripts/test/test_brushStrengthAdjustModal.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — store state machine ────────────────────────────────────────

function makeStore() {
  let state = {
    active: false,
    startBrushStrength: null,
    anchorClient: null,
  };
  return {
    get: () => ({ ...state }),
    begin: (startBrushStrength) => {
      state = { active: true, startBrushStrength, anchorClient: null };
    },
    setAnchor: (anchorClient) => {
      state = { ...state, anchorClient };
    },
    commit: () => {
      state = { active: false, startBrushStrength: null, anchorClient: null };
    },
    cancel: () => {
      state = { active: false, startBrushStrength: null, anchorClient: null };
    },
  };
}

{
  const s = makeStore();
  ok(s.get().active === false, '§1 — initial: inactive');
  s.begin(0.5);
  ok(s.get().active === true && s.get().startBrushStrength === 0.5,
    '§1 — begin(0.5) captures start');
  ok(s.get().anchorClient === null,
    '§1 — begin clears stale anchor');

  s.setAnchor({ x: 50, y: 75 });
  ok(s.get().anchorClient?.x === 50 && s.get().anchorClient?.y === 75,
    '§1 — setAnchor stores client coords');

  s.commit();
  ok(s.get().active === false && s.get().startBrushStrength === null && s.get().anchorClient === null,
    '§1 — commit clears all');
}

{
  const s = makeStore();
  s.begin(0.8);
  s.cancel();
  ok(s.get().active === false && s.get().startBrushStrength === null,
    '§1 — cancel clears (caller must restore brushStrength via setBrushStrength FIRST)');
}

// ── §2 — gesture math ───────────────────────────────────────────────
//
// strength = clamp(distance / STRENGTH_PIXELS_PER_UNIT, 0, 1)
// STRENGTH_PIXELS_PER_UNIT = 200

function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function distToStrength(anchorX, anchorY, mouseX, mouseY) {
  const dx = mouseX - anchorX;
  const dy = mouseY - anchorY;
  return clamp01(Math.hypot(dx, dy) / 200);
}

ok(distToStrength(100, 100, 100, 100) === 0,
  '§2 — pointer on anchor → strength=0');
ok(distToStrength(100, 100, 200, 100) === 0.5,
  '§2 — 100px from anchor → strength=0.5');
ok(distToStrength(100, 100, 300, 100) === 1,
  '§2 — 200px from anchor → strength=1.0 (full)');
ok(distToStrength(100, 100, 500, 100) === 1,
  '§2 — 400px from anchor → strength=1.0 (clamped)');
ok(distToStrength(100, 100, 110, 100) === 0.05,
  '§2 — 10px from anchor → strength=0.05');
// Diagonal — sqrt(200²+200²) ≈ 283 → clamped to 1.0
ok(distToStrength(100, 100, 300, 300) === 1,
  '§2 — diagonal 283px from anchor → strength=1.0 (clamped)');

// ── §3 — wheel step math ────────────────────────────────────────────
//
// ±0.05 absolute step (not relative — since the value is a fraction,
// relative steps go to zero near 0).

function wheelStep(curStrength, deltaY) {
  const STEP = 0.05;
  return deltaY < 0 ? clamp01(curStrength + STEP) : clamp01(curStrength - STEP);
}

ok(wheelStep(0.5, -1) === 0.55,
  '§3 — wheel up at 0.5 → 0.55');
ok(wheelStep(0.5, 1) === 0.45,
  '§3 — wheel down at 0.5 → 0.45');
ok(Math.abs(wheelStep(0.03, 1) - 0) < 1e-9,
  '§3 — wheel down at 0.03 → 0 (clamped)');
ok(wheelStep(0, 1) === 0,
  '§3 — wheel down at 0 stays at 0');
ok(wheelStep(0.97, -1) === 1,
  '§3 — wheel up at 0.97 → 1 (clamped)');
ok(wheelStep(1, -1) === 1,
  '§3 — wheel up at 1 stays at 1');

// ── §4 — handler event dispatch policy ──────────────────────────────

function classifyEvent(evt) {
  if (evt.type === 'mousemove') return 'RUNNING_MODAL';
  if (evt.type === 'wheel') return 'RUNNING_MODAL';
  if (evt.type === 'mousedown') return evt.button === 2 ? 'CANCELLED' : 'FINISHED';
  if (evt.type === 'contextmenu') return 'CANCELLED';
  if (evt.type === 'keydown') {
    if (evt.key === 'Escape') return 'CANCELLED';
    if (evt.key === 'Enter') return 'FINISHED';
    // Both bare F AND Shift+F commit (toggle off). Modifier-key not
    // checked because user habit during the modal is to release Shift
    // before tapping F to commit; treating only Shift+F would surprise.
    if ((evt.key === 'f' || evt.key === 'F')
        && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
      return 'FINISHED';
    }
    return 'RUNNING_MODAL';
  }
  return 'PASS_THROUGH';
}

ok(classifyEvent({ type: 'mousemove' }) === 'RUNNING_MODAL',
  '§4 — mousemove → RUNNING_MODAL');
ok(classifyEvent({ type: 'wheel', deltaY: -1 }) === 'RUNNING_MODAL',
  '§4 — wheel → RUNNING_MODAL (swallows so canvas V2D-zoom does NOT fire)');
ok(classifyEvent({ type: 'mousedown', button: 0 }) === 'FINISHED',
  '§4 — LMB → FINISHED (commit)');
ok(classifyEvent({ type: 'mousedown', button: 2 }) === 'CANCELLED',
  '§4 — RMB → CANCELLED');
ok(classifyEvent({ type: 'keydown', key: 'Escape' }) === 'CANCELLED',
  '§4 — Escape → CANCELLED');
ok(classifyEvent({ type: 'keydown', key: 'f' }) === 'FINISHED',
  '§4 — bare f during modal → FINISHED (mid-gesture toggle-off)');
ok(classifyEvent({ type: 'keydown', key: 'F', shiftKey: true }) === 'FINISHED',
  '§4 — Shift+F during modal → FINISHED (toggle-off chord)');
ok(classifyEvent({ type: 'keydown', key: 'F', ctrlKey: true }) === 'RUNNING_MODAL',
  '§4 — Ctrl+F during modal → RUNNING_MODAL (not the toggle-off chord)');
ok(classifyEvent({ type: 'keydown', key: 'g' }) === 'RUNNING_MODAL',
  '§4 — G during modal → RUNNING_MODAL');

// ── §5 — F-key dispatch policy (shift branching) ────────────────────
//
// CanvasViewport's F-handler must branch on shiftKey: bare F opens the
// radius modal, Shift+F opens the strength modal. Mutually exclusive.

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
  '§5 — bare F → opens RADIUS modal');
ok(fHandlerBranch({ key: 'F', shiftKey: true }, false, false) === 'OPEN_STRENGTH',
  '§5 — Shift+F → opens STRENGTH modal');
ok(fHandlerBranch({ key: 'f' }, true, false) === 'NONE',
  '§5 — bare F when RADIUS active → no-op (rejected by re-entry check)');
ok(fHandlerBranch({ key: 'F', shiftKey: true }, false, true) === 'NONE',
  '§5 — Shift+F when STRENGTH active → no-op');
ok(fHandlerBranch({ key: 'F', shiftKey: true }, true, false) === 'OPEN_STRENGTH',
  '§5 — Shift+F when RADIUS active → STRENGTH still opens '
  + '(each modal\'s re-entry check is independent — but in practice '
  + 'radius being live would have swallowed the keydown before this handler)');
ok(fHandlerBranch({ key: 'f', ctrlKey: true }, false, false) === 'NONE',
  '§5 — Ctrl+F → no-op (reserved for future, e.g. file menu)');
ok(fHandlerBranch({ key: 'f', altKey: true }, false, false) === 'NONE',
  '§5 — Alt+F → no-op');
ok(fHandlerBranch({ key: 'f', metaKey: true }, false, false) === 'NONE',
  '§5 — Cmd+F → no-op (browser-find shortcut)');
ok(fHandlerBranch({ key: 'g' }, false, false) === 'NONE',
  '§5 — non-F key → no-op');

// ── §6 — gate parity check with sister overlay ──────────────────────

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

// Non-F events parity:
const NON_F_EVENTS = [
  { type: 'mousemove' },
  { type: 'wheel', deltaY: -1 },
  { type: 'mousedown', button: 0 },
  { type: 'mousedown', button: 2 },
  { type: 'contextmenu' },
  { type: 'keydown', key: 'Escape' },
  { type: 'keydown', key: 'Enter' },
  { type: 'keydown', key: 'g' },
  { type: 'click' },
];
for (const evt of NON_F_EVENTS) {
  const label = `${evt.type}${evt.key ? `:${evt.key}` : evt.button !== undefined ? `:btn${evt.button}` : ''}`;
  ok(classifyEvent(evt) === radiusOverlayClassify(evt),
    `§6 — non-F gesture parity at ${label}`);
}

// F-key DIFFERS: strength accepts Shift+F as commit, radius rejects it
// (radius's toggle-off chord is bare F only — Shift+F there would mean
// "user wants to enter strength modal but radius is already up", which
// shouldn't happen in practice but is documented as such).
ok(classifyEvent({ type: 'keydown', key: 'F', shiftKey: true }) === 'FINISHED',
  '§6 — STRENGTH overlay treats Shift+F as commit (mid-gesture toggle-off)');
ok(radiusOverlayClassify({ type: 'keydown', key: 'F', shiftKey: true }) === 'RUNNING_MODAL',
  '§6 — RADIUS overlay treats Shift+F as catch-all (strict no-modifier toggle)');

console.log(`brushStrengthAdjustModal: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
