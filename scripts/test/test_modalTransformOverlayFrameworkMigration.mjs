// Regression for Phase 2.A (2026-06-12) migration of ModalTransformOverlay
// to the modal-tool framework (src/v3/modalTool/).
//
// The handler closure lives inside the React component and isn't directly
// importable — but the migration's correctness rests on a stable
// CONTRACT between the handler and:
//   - modalTransformStore  (begin/commit/cancel/setAxis/appendTyped/popTyped/
//                           enterNumericMode/exitNumericMode/setLiveDelta)
//   - useModalTool         (register/unregister lifecycle keyed by isActive)
//   - InputDispatcher walk (PASS_THROUGH falls down; anything else stops)
//
// This test locks the contract surface so a future refactor of either side
// breaks loudly. The end-to-end click-through is verified manually in the
// browser (modal-transform tests in jsdom would need full React mount).
//
// Mirrors test_boxSelectArmAnchor.mjs in shape.
//
// Run: node scripts/test/test_modalTransformOverlayFrameworkMigration.mjs

import { useModalTransformStore } from '../../src/store/modalTransformStore.js';
import { useModalToolStore } from '../../src/v3/modalTool/store.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

function reset() {
  useModalTransformStore.getState().cancel();
  const s = useModalToolStore.getState();
  for (const e of [...s.stack]) s.unregister(e.id);
}

// ── §1 — modal store begin/commit lifecycle ─────────────────────────

{
  reset();
  const original = new Map([['node-1', { x: 10, y: 20, rotation: 0 }]]);
  useModalTransformStore.getState().begin({
    kind: 'translate',
    startMouse:  { x: 100, y: 100 },
    pivotCanvas: { x: 50,  y: 50  },
    original,
  });
  const s = useModalTransformStore.getState();
  ok(s.kind === 'translate', '§1 — begin: kind=translate (handler will activate)');
  ok(s.startMouse?.x === 100, '§1 — begin: startMouse captured');
  ok(s.pivotCanvas?.x === 50, '§1 — begin: pivotCanvas captured');
  ok(s.original.size === 1, '§1 — begin: original map captured');
  ok(s.axis === null, '§1 — begin: axis null');
  ok(s.typedBuffer === '', '§1 — begin: typedBuffer empty');
  ok(s.numericMode === false, '§1 — begin: numericMode off');
}

// ── §2 — commit clears everything (handler return FINISHED) ─────────

{
  reset();
  useModalTransformStore.getState().begin({
    kind: 'rotate',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    new Map([['node-1', { rotation: 0 }]]),
  });
  useModalTransformStore.getState().commit();
  const s = useModalTransformStore.getState();
  ok(s.kind === null, '§2 — commit: kind cleared (overlay unmounts → useModalTool unregisters)');
  ok(s.startMouse === null, '§2 — commit: startMouse cleared');
  ok(s.original.size === 0, '§2 — commit: original cleared');
}

// ── §3 — cancel clears everything (handler return CANCELLED) ────────

{
  reset();
  useModalTransformStore.getState().begin({
    kind: 'scale',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    new Map([['node-1', { scaleX: 1, scaleY: 1 }]]),
  });
  useModalTransformStore.getState().cancel();
  const s = useModalTransformStore.getState();
  ok(s.kind === null, '§3 — cancel: kind cleared');
  ok(s.typedBuffer === '', '§3 — cancel: typedBuffer cleared');
}

// ── §4 — setAxis toggle (X / Y / null) ───────────────────────────────

{
  reset();
  useModalTransformStore.getState().begin({
    kind: 'translate',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    new Map(),
  });
  useModalTransformStore.getState().setAxis('x');
  ok(useModalTransformStore.getState().axis === 'x', '§4 — X press: axis=x');
  useModalTransformStore.getState().setAxis(null);
  ok(useModalTransformStore.getState().axis === null, '§4 — X press again (toggle): axis=null');
  useModalTransformStore.getState().setAxis('y');
  ok(useModalTransformStore.getState().axis === 'y', '§4 — Y press: axis=y');
}

// ── §5 — typed buffer append + pop ───────────────────────────────────

{
  reset();
  useModalTransformStore.getState().begin({
    kind: 'translate',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    new Map(),
  });
  const s = useModalTransformStore.getState();
  s.appendTyped('1');
  s.appendTyped('2');
  s.appendTyped('.');
  s.appendTyped('5');
  ok(useModalTransformStore.getState().typedBuffer === '12.5',
    `§5 — typed digits accumulate (got "${useModalTransformStore.getState().typedBuffer}")`);
  s.popTyped();
  ok(useModalTransformStore.getState().typedBuffer === '12.',
    `§5 — pop drops last char (got "${useModalTransformStore.getState().typedBuffer}")`);
}

// ── §6 — enterNumericMode / exitNumericMode ─────────────────────────

{
  reset();
  useModalTransformStore.getState().begin({
    kind: 'translate',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    new Map(),
  });
  useModalTransformStore.getState().enterNumericMode();
  ok(useModalTransformStore.getState().numericMode === true,
    '§6 — = pressed: numericMode=true');
  // = again: NO-OP (one-way enable per `numinput.cc:369-378`).
  useModalTransformStore.getState().enterNumericMode();
  ok(useModalTransformStore.getState().numericMode === true,
    '§6 — = pressed again: stays true (one-way enable)');
  useModalTransformStore.getState().exitNumericMode();
  ok(useModalTransformStore.getState().numericMode === false,
    '§6 — Ctrl+= pressed: numericMode=false');
}

// ── §7 — setLiveDelta publishes for HUD ──────────────────────────────

{
  reset();
  useModalTransformStore.getState().begin({
    kind: 'translate',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    new Map(),
  });
  useModalTransformStore.getState().setLiveDelta(
    Object.freeze({ dx: 12.34, dy: -5.67, dRot: 0, scale: 1 }),
  );
  const s = useModalTransformStore.getState();
  ok(s.liveDelta.dx === 12.34, '§7 — setLiveDelta(dx)');
  ok(s.liveDelta.dy === -5.67, '§7 — setLiveDelta(dy)');
}

// ── §8 — modal-tool framework dispatcher walk semantics ─────────────
//
// Simulates the dispatcher invoking the handler. Asserts the contract
// the migrated overlay relies on: 'RUNNING_MODAL' / 'FINISHED' /
// 'CANCELLED' stop propagation; 'PASS_THROUGH' falls down to the
// next handler.

function dispatch(event) {
  const stack = useModalToolStore.getState().stack;
  const calls = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const handler = stack[i].handler.current;
    if (!handler) continue;
    calls.push(stack[i].id);
    const result = handler(event);
    if (result === 'PASS_THROUGH' || !result) continue;
    return { consumedBy: stack[i].id, result, calls };
  }
  return { consumedBy: null, result: 'PASS_THROUGH', calls };
}

{
  reset();
  // Mock the modalTransform handler the way the real overlay would
  // register it — owns most keys, returns 'RUNNING_MODAL' for unowned.
  const handler = {
    current: (e) => {
      if (e.type === 'keydown' && e.key === 'Escape') return 'CANCELLED';
      if (e.type === 'keydown' && e.key === 'Enter')  return 'FINISHED';
      if (e.type === 'mousedown' && e.button === 2)   return 'CANCELLED';
      if (e.type === 'mousedown')                      return 'FINISHED';
      if (e.type === 'mousemove')                      return 'RUNNING_MODAL';
      if (e.type === 'keydown')                        return 'RUNNING_MODAL';
      return 'PASS_THROUGH';
    },
  };
  useModalToolStore.getState().register('modalTransform', handler);

  // Modal owns every keydown — no PASS_THROUGH for stray keys.
  let r = dispatch({ type: 'keydown', key: 'g' });
  ok(r.consumedBy === 'modalTransform' && r.result === 'RUNNING_MODAL',
    '§8 — stray KeyG: RUNNING_MODAL (no competing modal can start)');

  r = dispatch({ type: 'keydown', key: 'r' });
  ok(r.consumedBy === 'modalTransform' && r.result === 'RUNNING_MODAL',
    '§8 — stray KeyR: RUNNING_MODAL');

  // Esc cancels.
  r = dispatch({ type: 'keydown', key: 'Escape' });
  ok(r.consumedBy === 'modalTransform' && r.result === 'CANCELLED',
    '§8 — Esc: CANCELLED');

  // Enter commits.
  r = dispatch({ type: 'keydown', key: 'Enter' });
  ok(r.consumedBy === 'modalTransform' && r.result === 'FINISHED',
    '§8 — Enter: FINISHED');

  // LMB commits, RMB cancels.
  r = dispatch({ type: 'mousedown', button: 0 });
  ok(r.consumedBy === 'modalTransform' && r.result === 'FINISHED',
    '§8 — LMB-down: FINISHED');

  r = dispatch({ type: 'mousedown', button: 2 });
  ok(r.consumedBy === 'modalTransform' && r.result === 'CANCELLED',
    '§8 — RMB-down: CANCELLED');

  // Mousemove keeps the modal alive.
  r = dispatch({ type: 'mousemove', clientX: 0, clientY: 0 });
  ok(r.consumedBy === 'modalTransform' && r.result === 'RUNNING_MODAL',
    '§8 — mousemove: RUNNING_MODAL (gesture continues)');
}

// ── §9 — stacking: modalTransform OVER circleSelect — modal owns keys ─
//
// If circle-select is somehow underneath (shouldn't happen — they're
// mutually exclusive — but defensive), modal-transform's RUNNING_MODAL
// stops the walk and circle-select doesn't see the key.

{
  reset();
  const circleHandler = {
    current: (e) => {
      // Circle would pass keys through (we proved that in CircleSelectOverlay
      // — the X-delete bug fix). Bottom-of-stack handler.
      if (e.type === 'keydown' && e.key === 'Escape') return 'CANCELLED';
      return 'PASS_THROUGH';
    },
  };
  const modalHandler = {
    current: (e) => {
      if (e.type === 'keydown') return 'RUNNING_MODAL';
      return 'PASS_THROUGH';
    },
  };
  useModalToolStore.getState().register('circleSelect', circleHandler);
  useModalToolStore.getState().register('modalTransform', modalHandler);

  const r = dispatch({ type: 'keydown', key: 'x' });
  ok(r.consumedBy === 'modalTransform',
    '§9 — modal-transform (top) consumes x; circle-select (under) never sees it');
  ok(r.calls.length === 1, '§9 — circle-select handler NOT called');
}

// ── §10 — useModalTool isActive=false unregisters the handler ──────
//
// Simulates the kind→null transition (modal commit/cancel): the overlay
// no longer registers; events fall to whoever's underneath.

{
  reset();
  const handler = { current: (e) => e.type === 'keydown' ? 'RUNNING_MODAL' : 'PASS_THROUGH' };
  useModalToolStore.getState().register('modalTransform', handler);
  let r = dispatch({ type: 'keydown', key: 'g' });
  ok(r.consumedBy === 'modalTransform', '§10 — active: handler consumes');

  // Mirror what useModalTool does on isActive=false (cleanup effect):
  useModalToolStore.getState().unregister('modalTransform');
  r = dispatch({ type: 'keydown', key: 'g' });
  ok(r.consumedBy === null, '§10 — unregistered: nothing consumes (modal closed)');
  ok(r.calls.length === 0, '§10 — handler not called after unregister');
}

console.log(`modalTransformOverlayFrameworkMigration: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
