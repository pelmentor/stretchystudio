// Regression for Phase 2.B (2026-06-12) migration of ModalVertexTransformOverlay
// to the modal-tool framework. Sister to the ModalTransform migration test.
//
// Locks the contract surface between handler and:
//   - modalVertexTransformStore (begin/commit/cancel/setAxis/appendTyped/popTyped)
//   - useModalTool registration  (isActive=!!kind toggles register/unregister)
//   - dispatcher walk            (PASS_THROUGH falls down; RUNNING_MODAL stops)
//
// Differences vs node-modal:
//   - kind: 'translate' | 'rotate' | 'scale' (no `null` while active)
//   - per-part: partId required
//   - vertIndices: Set<number>
//   - rollbackOnCancel: cancel goes through discardBatch (extrude-driven path)
//
// Run: node scripts/test/test_modalVertexTransformOverlayFrameworkMigration.mjs

import { useModalVertexTransformStore } from '../../src/store/modalVertexTransformStore.js';
import { useModalToolStore } from '../../src/v3/modalTool/store.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

function reset() {
  useModalVertexTransformStore.getState().cancel();
  const s = useModalToolStore.getState();
  for (const e of [...s.stack]) s.unregister(e.id);
}

function makeOriginal(idxs) {
  const m = new Map();
  for (const i of idxs) m.set(i, { x: i * 10, y: i * 10, restX: i * 10, restY: i * 10 });
  return m;
}

// ── §1 — modal store begin/commit lifecycle ─────────────────────────

{
  reset();
  useModalVertexTransformStore.getState().begin({
    kind: 'translate',
    partId: 'part-1',
    startMouse:  { x: 100, y: 100 },
    pivotCanvas: { x: 50,  y: 50  },
    original:    makeOriginal([0, 1, 2]),
    vertIndices: new Set([0, 1, 2]),
  });
  const s = useModalVertexTransformStore.getState();
  ok(s.kind === 'translate', '§1 — begin: kind=translate');
  ok(s.partId === 'part-1', '§1 — begin: partId captured');
  ok(s.startMouse?.x === 100, '§1 — begin: startMouse captured');
  ok(s.original.size === 3, '§1 — begin: original map captured (3 verts)');
  ok(s.vertIndices.size === 3, '§1 — begin: vertIndices captured');
  ok(s.rollbackOnCancel === false, '§1 — begin: default rollbackOnCancel=false');
}

// ── §2 — commit clears (handler return FINISHED triggers it) ─────────

{
  reset();
  useModalVertexTransformStore.getState().begin({
    kind: 'rotate',
    partId: 'part-1',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    makeOriginal([0]),
    vertIndices: new Set([0]),
  });
  useModalVertexTransformStore.getState().commit();
  const s = useModalVertexTransformStore.getState();
  ok(s.kind === null, '§2 — commit: kind cleared (overlay unmounts → useModalTool unregisters)');
  ok(s.partId === null, '§2 — commit: partId cleared');
  ok(s.original.size === 0, '§2 — commit: original cleared');
  ok(s.vertIndices.size === 0, '§2 — commit: vertIndices cleared');
}

// ── §3 — cancel clears (handler return CANCELLED triggers it) ────────

{
  reset();
  useModalVertexTransformStore.getState().begin({
    kind: 'scale',
    partId: 'part-1',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    makeOriginal([0]),
    vertIndices: new Set([0]),
  });
  useModalVertexTransformStore.getState().cancel();
  const s = useModalVertexTransformStore.getState();
  ok(s.kind === null, '§3 — cancel: kind cleared');
  ok(s.typedBuffer === '', '§3 — cancel: typedBuffer cleared');
}

// ── §4 — setAxis toggle (X / Y / null) ───────────────────────────────

{
  reset();
  useModalVertexTransformStore.getState().begin({
    kind: 'translate',
    partId: 'part-1',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    makeOriginal([0]),
    vertIndices: new Set([0]),
  });
  useModalVertexTransformStore.getState().setAxis('x');
  ok(useModalVertexTransformStore.getState().axis === 'x', '§4 — X press: axis=x');
  useModalVertexTransformStore.getState().setAxis(null);
  ok(useModalVertexTransformStore.getState().axis === null, '§4 — X again (toggle): axis=null');
  useModalVertexTransformStore.getState().setAxis('y');
  ok(useModalVertexTransformStore.getState().axis === 'y', '§4 — Y press: axis=y');
}

// ── §5 — typed buffer append + pop ───────────────────────────────────

{
  reset();
  useModalVertexTransformStore.getState().begin({
    kind: 'translate',
    partId: 'part-1',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    makeOriginal([0]),
    vertIndices: new Set([0]),
  });
  const s = useModalVertexTransformStore.getState();
  s.appendTyped('4');
  s.appendTyped('2');
  ok(useModalVertexTransformStore.getState().typedBuffer === '42',
    `§5 — typed digits accumulate (got "${useModalVertexTransformStore.getState().typedBuffer}")`);
  s.popTyped();
  ok(useModalVertexTransformStore.getState().typedBuffer === '4',
    `§5 — pop drops last char (got "${useModalVertexTransformStore.getState().typedBuffer}")`);
}

// ── §6 — rollbackOnCancel set when extrude opens modal ──────────────

{
  reset();
  useModalVertexTransformStore.getState().begin({
    kind: 'translate',
    partId: 'part-1',
    startMouse:  { x: 0, y: 0 },
    pivotCanvas: { x: 0, y: 0 },
    original:    makeOriginal([0]),
    vertIndices: new Set([0]),
    rollbackOnCancel: true,
  });
  const s = useModalVertexTransformStore.getState();
  ok(s.rollbackOnCancel === true,
    '§6 — extrude path: rollbackOnCancel=true (handler routes cancel via discardBatch)');
}

// ── §7 — modal-tool dispatcher walk semantics ───────────────────────

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
  // Mock the vertex-modal handler. Like node-modal: owns most keys.
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
  useModalToolStore.getState().register('modalVertexTransform', handler);

  // Stray KeyE — must NOT pass through (would start extrude on top of
  // an active vertex modal, audit G-3 / G-4 lesson).
  let r = dispatch({ type: 'keydown', key: 'e' });
  ok(r.consumedBy === 'modalVertexTransform' && r.result === 'RUNNING_MODAL',
    '§7 — stray KeyE: RUNNING_MODAL (no nested extrude)');

  r = dispatch({ type: 'keydown', key: 'm' });
  ok(r.consumedBy === 'modalVertexTransform' && r.result === 'RUNNING_MODAL',
    '§7 — stray KeyM: RUNNING_MODAL (no nested merge)');

  r = dispatch({ type: 'keydown', key: 'Escape' });
  ok(r.consumedBy === 'modalVertexTransform' && r.result === 'CANCELLED',
    '§7 — Esc: CANCELLED (overlay calls rollbackThenCancel)');

  r = dispatch({ type: 'keydown', key: 'Enter' });
  ok(r.consumedBy === 'modalVertexTransform' && r.result === 'FINISHED',
    '§7 — Enter: FINISHED');

  r = dispatch({ type: 'mousedown', button: 0 });
  ok(r.consumedBy === 'modalVertexTransform' && r.result === 'FINISHED',
    '§7 — LMB-down: FINISHED');

  r = dispatch({ type: 'mousedown', button: 2 });
  ok(r.consumedBy === 'modalVertexTransform' && r.result === 'CANCELLED',
    '§7 — RMB-down: CANCELLED');

  r = dispatch({ type: 'mousemove', clientX: 0, clientY: 0 });
  ok(r.consumedBy === 'modalVertexTransform' && r.result === 'RUNNING_MODAL',
    '§7 — mousemove: RUNNING_MODAL');
}

// ── §8 — useModalTool isActive=false unregisters ───────────────────

{
  reset();
  const handler = { current: (e) => e.type === 'keydown' ? 'RUNNING_MODAL' : 'PASS_THROUGH' };
  useModalToolStore.getState().register('modalVertexTransform', handler);
  let r = dispatch({ type: 'keydown', key: 'g' });
  ok(r.consumedBy === 'modalVertexTransform', '§8 — active: handler consumes');

  useModalToolStore.getState().unregister('modalVertexTransform');
  r = dispatch({ type: 'keydown', key: 'g' });
  ok(r.consumedBy === null, '§8 — unregistered: nothing consumes');
}

console.log(`modalVertexTransformOverlayFrameworkMigration: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
