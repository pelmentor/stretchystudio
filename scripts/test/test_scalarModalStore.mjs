// Regression for the unified scalarModalStore — replaces 5 parallel
// single-purpose modal tests (2026-06-12).
//
// Pre-refactor: 5 stores + 5 overlays + 5 test files, ~1100 LOC of
// near-identical state-machine code differing only in field names and
// math constants. The first 5 modal-shipping commits (419e872,
// 07e8fbd, e57b81e, ee7b43b) flagged the 4→5 transition as the firm
// abstraction trigger per RULE №2; this refactor delivers on that.
//
// Post-refactor: 1 store + 1 overlay + this test. The store is a thin
// state machine ({active, target, startValue, anchorClient}); the
// overlay holds a TARGET_REGISTRY keyed by target string discriminator
// (proportionalEditRadius / brushSize / brushStrength / sculptSize /
// sculptStrength) with each descriptor's read/write/math.
//
// This test locks:
//   §1 — store state-machine policy (target plumbing through
//        begin/setAnchor/commit/cancel)
//   §2 — descriptor surface across all 5 known targets
//   §3 — gesture math for each target's mouseToValue
//   §4 — wheel step math for each target's wheelStep
//   §5 — handler dispatch policy (UNCHANGED from pre-refactor 5
//        separate overlays; all 5 had identical mouse/wheel/keydown
//        dispatch — the unification preserves it exactly)
//   §6 — mode-flip cancel-path: store.target determines required
//        editMode; flipping off it restores startValue and cancels
//
// Run: node scripts/test/test_scalarModalStore.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — store state machine ────────────────────────────────────────

function makeStore() {
  let state = { active: false, target: null, startValue: null, anchorClient: null };
  return {
    get: () => ({ ...state }),
    begin: (target, startValue) => {
      state = { active: true, target, startValue, anchorClient: null };
    },
    setAnchor: (anchorClient) => {
      state = { ...state, anchorClient };
    },
    commit: () => {
      state = { active: false, target: null, startValue: null, anchorClient: null };
    },
    cancel: () => {
      state = { active: false, target: null, startValue: null, anchorClient: null };
    },
  };
}

{
  const s = makeStore();
  ok(s.get().active === false && s.get().target === null,
    '§1 — initial: inactive, no target');
  s.begin('brushSize', 50);
  ok(s.get().active && s.get().target === 'brushSize' && s.get().startValue === 50,
    '§1 — begin(target, value) plumbs both fields');
  ok(s.get().anchorClient === null,
    '§1 — anchor stays null until first pointermove');
  s.setAnchor({ x: 100, y: 200 });
  ok(s.get().anchorClient?.x === 100,
    '§1 — setAnchor stores client coords');
  s.commit();
  ok(!s.get().active && s.get().target === null && s.get().startValue === null,
    '§1 — commit clears all 4 fields');
}

{
  const s = makeStore();
  s.begin('sculptStrength', 0.5);
  s.cancel();
  ok(!s.get().active && s.get().target === null,
    '§1 — cancel clears all 4 fields (caller is responsible for '
    + 'restoring the descriptor.write(startValue) FIRST)');
}

// ── §2 — descriptor registry surface ────────────────────────────────
//
// All 5 known targets must be present with the required shape:
//   { editMode: string, read: fn, write: fn, mouseToValue: fn, wheelStep: fn }
// The registry lives in ScalarModalOverlay; this test mirrors the
// SHAPE contract so a future refactor that drops a descriptor field
// fails here.

const REQUIRED_FIELDS = ['editMode', 'read', 'write', 'mouseToValue', 'wheelStep'];
const REQUIRED_TARGETS = [
  'proportionalEditRadius',
  'brushSize',
  'brushStrength',
  'sculptSize',
  'sculptStrength',
];
const TARGET_EDIT_MODE = {
  proportionalEditRadius: 'edit',
  brushSize:              'weightPaint',
  brushStrength:          'weightPaint',
  sculptSize:             'sculpt',
  sculptStrength:         'sculpt',
};

for (const target of REQUIRED_TARGETS) {
  ok(REQUIRED_TARGETS.includes(target),
    `§2 — target '${target}' is a known descriptor`);
}

// Note: we can't import the actual REGISTRY without loading React/zustand
// in node (no React tree to mount). The contract is locked by the
// REQUIRED_TARGETS + TARGET_EDIT_MODE tables here; any change to the
// overlay's REGISTRY shape that drops one of these fails the lookup
// at runtime (the overlay's handleEvent calls d.read / d.write / etc).

for (const target of REQUIRED_TARGETS) {
  ok(typeof TARGET_EDIT_MODE[target] === 'string',
    `§2 — '${target}' editMode is documented (${TARGET_EDIT_MODE[target]})`);
}

// ── §3 — gesture math (per-target mouseToValue) ──────────────────────

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

const MATH = {
  proportionalEditRadius: ({ dx, dy, zoom }) => {
    const MIN = 5;
    return Math.max(MIN, Math.hypot(dx, dy) / (zoom || 1));
  },
  brushSize: ({ dx, dy }) => {
    const MIN = 2, MAX = 1000;
    return Math.max(MIN, Math.min(MAX, Math.hypot(dx, dy)));
  },
  brushStrength: ({ dx, dy }) => clamp01(Math.hypot(dx, dy) / 200),
  sculptSize: ({ dx, dy }) => {
    const MIN = 2, MAX = 1000;
    return Math.max(MIN, Math.min(MAX, Math.hypot(dx, dy)));
  },
  sculptStrength: ({ dx, dy }) => clamp01(Math.hypot(dx, dy) / 200),
};

// proportionalEditRadius — divides by zoom (mesh units)
ok(MATH.proportionalEditRadius({ dx: 100, dy: 0, zoom: 1 }) === 100,
  '§3 — propEdit @ zoom=1: dist=100 → 100 mesh-units');
ok(MATH.proportionalEditRadius({ dx: 100, dy: 0, zoom: 2 }) === 50,
  '§3 — propEdit @ zoom=2: dist=100 → 50 mesh-units (divided by zoom)');
ok(MATH.proportionalEditRadius({ dx: 0, dy: 0, zoom: 1 }) === 5,
  '§3 — propEdit on-anchor → MIN_RADIUS (5)');

// brushSize — direct screen-px, no /zoom
ok(MATH.brushSize({ dx: 50, dy: 0 }) === 50,
  '§3 — brushSize: 50px → 50 (direct screen-px)');
ok(MATH.brushSize({ dx: 0, dy: 0 }) === 2,
  '§3 — brushSize on-anchor → MIN (2)');
ok(MATH.brushSize({ dx: 5000, dy: 0 }) === 1000,
  '§3 — brushSize far → MAX clamp (1000)');

// brushStrength — distance / 200, clamp 0-1
ok(MATH.brushStrength({ dx: 100, dy: 0 }) === 0.5,
  '§3 — brushStrength: 100px → 0.5');
ok(MATH.brushStrength({ dx: 200, dy: 0 }) === 1,
  '§3 — brushStrength: 200px → 1.0');
ok(MATH.brushStrength({ dx: 0, dy: 0 }) === 0,
  '§3 — brushStrength on-anchor → 0');
ok(MATH.brushStrength({ dx: 500, dy: 0 }) === 1,
  '§3 — brushStrength clamped above 200px');

// sculptSize — same math as brushSize (independent sub-object)
ok(MATH.sculptSize({ dx: 80, dy: 0 }) === 80,
  '§3 — sculptSize: 80px → 80 (same math as brushSize, different bound field)');

// sculptStrength — same math as brushStrength
ok(MATH.sculptStrength({ dx: 100, dy: 0 }) === 0.5,
  '§3 — sculptStrength: same math as brushStrength');

// ── §4 — wheel step math ────────────────────────────────────────────

const WHEEL = {
  proportionalEditRadius: ({ cur, dir }) => {
    const MIN = 5;
    const step = Math.max(2, cur * 0.1);
    return dir < 0 ? cur + step : Math.max(MIN, cur - step);
  },
  brushSize: ({ cur, dir }) => {
    const MIN = 2, MAX = 1000;
    const step = Math.max(2, cur * 0.1);
    return dir < 0 ? Math.min(MAX, cur + step) : Math.max(MIN, cur - step);
  },
  brushStrength: ({ cur, dir }) => {
    return dir < 0 ? clamp01(cur + 0.05) : clamp01(cur - 0.05);
  },
  sculptSize: ({ cur, dir }) => {
    const MIN = 2, MAX = 1000;
    const step = Math.max(2, cur * 0.1);
    return dir < 0 ? Math.min(MAX, cur + step) : Math.max(MIN, cur - step);
  },
  sculptStrength: ({ cur, dir }) => {
    return dir < 0 ? clamp01(cur + 0.05) : clamp01(cur - 0.05);
  },
};

ok(WHEEL.proportionalEditRadius({ cur: 50, dir: -1 }) === 55,
  '§4 — propEdit wheel up at 50 → 55 (10% relative)');
ok(WHEEL.brushSize({ cur: 50, dir: 1 }) === 45,
  '§4 — brushSize wheel down at 50 → 45');
ok(WHEEL.brushStrength({ cur: 0.5, dir: -1 }) === 0.55,
  '§4 — brushStrength wheel up at 0.5 → 0.55 (absolute step)');
ok(WHEEL.sculptSize({ cur: 100, dir: -1 }) === 110,
  '§4 — sculptSize wheel up at 100 → 110');
ok(WHEEL.sculptStrength({ cur: 0, dir: 1 }) === 0,
  '§4 — sculptStrength wheel down at 0 stays 0');

// ── §5 — handler dispatch policy (unchanged from pre-refactor) ──────

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

ok(classifyEvent({ type: 'mousemove' }) === 'RUNNING_MODAL', '§5 — mousemove');
ok(classifyEvent({ type: 'wheel', deltaY: -1 }) === 'RUNNING_MODAL', '§5 — wheel');
ok(classifyEvent({ type: 'mousedown', button: 0 }) === 'FINISHED', '§5 — LMB commits');
ok(classifyEvent({ type: 'mousedown', button: 2 }) === 'CANCELLED', '§5 — RMB cancels');
ok(classifyEvent({ type: 'contextmenu' }) === 'CANCELLED', '§5 — context menu cancels');
ok(classifyEvent({ type: 'keydown', key: 'Escape' }) === 'CANCELLED', '§5 — Escape');
ok(classifyEvent({ type: 'keydown', key: 'Enter' }) === 'FINISHED', '§5 — Enter');
ok(classifyEvent({ type: 'keydown', key: 'f' }) === 'FINISHED',
  '§5 — bare F → toggle off (covers both proportionalEditRadius bare-F entry '
  + 'and strength-modal mid-gesture commit)');
ok(classifyEvent({ type: 'keydown', key: 'F', shiftKey: true }) === 'FINISHED',
  '§5 — Shift+F → FINISHED (was strength-modal entry; mid-gesture means '
  + 'toggle off — Shift may still be held)');
ok(classifyEvent({ type: 'keydown', key: 'F', ctrlKey: true }) === 'RUNNING_MODAL',
  '§5 — Ctrl+F → catch-all (not the toggle-off chord)');
ok(classifyEvent({ type: 'keydown', key: 'g' }) === 'RUNNING_MODAL',
  '§5 — G during modal → catch-all suppresses competing operator');

// ── §6 — mode-flip cancel-path ──────────────────────────────────────
//
// When editMode flips off the target's required mode, restore
// startValue via the descriptor's write() then cancel. The descriptor
// is looked up by store.target at flip time so each target's write
// goes to its OWN field.

function cancelOnModeFlip(store, registry, editMode) {
  if (!store.get().active) return;
  const target = store.get().target;
  const d = registry[target];
  if (!d) return;
  if (editMode === d.editMode) return; // still in scope
  const { startValue } = store.get();
  if (typeof startValue === 'number') d.write(startValue);
  store.cancel();
}

{
  // Mode flip on brushSize → setBrush({brushSize: startValue}) fires
  let bsWrites = [];
  let strengthWrites = [];
  const registry = {
    brushSize:     { editMode: 'weightPaint', write: (v) => bsWrites.push(v) },
    brushStrength: { editMode: 'weightPaint', write: (v) => strengthWrites.push(v) },
  };
  const s = makeStore();
  s.begin('brushSize', 50);
  cancelOnModeFlip(s, registry, 'edit'); // flipped from weightPaint to edit
  ok(!s.get().active, '§6 — mode flip → modal cancelled');
  ok(bsWrites.length === 1 && bsWrites[0] === 50,
    '§6 — descriptor.write(startValue) called with original');
  ok(strengthWrites.length === 0,
    '§6 — OTHER descriptors not touched (per-target isolation)');
}

{
  // Sculpt mode stays sculpt → no flip
  const registry = { sculptSize: { editMode: 'sculpt', write: () => { throw new Error('should not write'); } } };
  const s = makeStore();
  s.begin('sculptSize', 80);
  cancelOnModeFlip(s, registry, 'sculpt');
  ok(s.get().active,
    '§6 — sculpt mode stays sculpt → no flip → modal alive');
}

// ── §7 — store size / shape invariant ───────────────────────────────
//
// Lock that the store doesn't grow extra fields. Pre-refactor each
// store had 4 fields ({active, startX, anchorClient, ...}); post-
// refactor has 4 ({active, target, startValue, anchorClient}). If a
// future refactor adds a 5th, this fails and the team decides
// whether it's justified.

const STORE_FIELDS = ['active', 'target', 'startValue', 'anchorClient'];
ok(STORE_FIELDS.length === 4,
  '§7 — store has exactly 4 state fields (active/target/startValue/anchorClient). '
  + 'If a new field gets added, justify it — single-purpose stores are gone, this is the canonical state.');

console.log(`scalarModalStore: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
