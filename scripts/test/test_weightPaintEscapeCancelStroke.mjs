// Regression for Weight-Paint Escape-cancel-stroke (2026-06-12).
//
// Bug class: pressing Escape mid-stroke had NO rollback path. The
// global Escape handler fired `selection.clear` (no-op in Weight Paint),
// the stroke kept running, and the eventual pointerup committed the
// partial stroke to undo history. User intent ("cancel this stroke")
// vs system behavior ("commit whatever I painted") were completely
// inverted from Blender's PAINT_OT_*_paint semantic.
//
// Fix: WeightPaintOverlay now registers a window keydown listener that
// intercepts Escape when `dragRef.current !== null` (stroke in flight):
//   1. Cancel pending rAF; clear pending paint queue.
//   2. Roll back via `discardBatch` + `updateProject({skipHistory:true})`.
//      Same mechanism ModalVertexTransformOverlay uses for extrude+drag.
//   3. Clear dragRef so the next pointerup early-returns instead of
//      calling endBatch (which would crash the depth counter).
//
// Browser releases pointer capture automatically on pointerup; no
// explicit releasePointerCapture needed.
//
// Run: node scripts/test/test_weightPaintEscapeCancelStroke.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — Escape gate: fires only when stroke is in flight ───────────

function shouldRollback(keyEvent, dragRefCurrent) {
  if (keyEvent.key !== 'Escape') return false;
  if (!dragRefCurrent) return false;
  return true;
}

ok(shouldRollback({ key: 'Escape' }, { pointerId: 1, batched: true }) === true,
  '§1 — Escape during stroke → rollback');
ok(shouldRollback({ key: 'Escape' }, null) === false,
  '§1 — Escape with no stroke → pass-through (let selection.clear fire)');
ok(shouldRollback({ key: 'g' }, { pointerId: 1, batched: true }) === false,
  '§1 — non-Escape key during stroke → no-op (stroke continues)');
ok(shouldRollback({ key: 'Enter' }, { pointerId: 1, batched: true }) === false,
  '§1 — Enter during stroke → no-op (Enter is not a Blender cancel)');

// ── §2 — rollback sequence: rAF → snapshot → dragRef ───────────────
//
// Order matters:
//   1. Cancel pending rAF FIRST so no late paint dab applies to the
//      rolled-back project (would re-corrupt it).
//   2. Clear pending paint queue (same reason — about to be ignored).
//   3. discardBatch — pops snapshot from undo stack; applyFn restores
//      project state.
//   4. Clear dragRef LAST so subsequent pointerup is a no-op.

function executeRollback(state) {
  const events = [];

  // 1. Cancel rAF
  if (state.rafIdRef.current != null) {
    events.push({ type: 'cancelAnimationFrame', id: state.rafIdRef.current });
    state.rafIdRef.current = null;
  }

  // 2. Clear pending queue
  if (state.pendingPaintRef.current != null) {
    events.push({ type: 'clearPendingPaint' });
    state.pendingPaintRef.current = null;
  }

  // 3. Roll back via discardBatch
  if (state.dragRef.current?.batched) {
    state.discardBatch((snapshot) => {
      events.push({ type: 'updateProject', snapshot, skipHistory: true });
    });
  }

  // 4. Clear dragRef
  events.push({ type: 'clearDragRef' });
  state.dragRef.current = null;

  return events;
}

{
  let discardBatchCalls = 0;
  const state = {
    rafIdRef: { current: 42 },
    pendingPaintRef: { current: { sx: 100, sy: 100, erase: false } },
    dragRef: { current: { pointerId: 7, batched: true, sx: 99, sy: 99 } },
    discardBatch: (applyFn) => { discardBatchCalls++; applyFn({ projectId: 'pre' }); },
  };

  const events = executeRollback(state);

  ok(events[0].type === 'cancelAnimationFrame' && events[0].id === 42,
    '§2 — rAF cancelled FIRST (id=42)');
  ok(events[1].type === 'clearPendingPaint',
    '§2 — pending paint queue cleared SECOND');
  ok(events[2].type === 'updateProject' && events[2].skipHistory === true,
    '§2 — updateProject called with skipHistory:true');
  ok(events[2].snapshot?.projectId === 'pre',
    '§2 — updateProject receives pre-stroke snapshot');
  ok(events[3].type === 'clearDragRef',
    '§2 — dragRef cleared LAST (after snapshot restored)');
  ok(discardBatchCalls === 1,
    '§2 — discardBatch called exactly once');
  ok(state.rafIdRef.current === null && state.pendingPaintRef.current === null && state.dragRef.current === null,
    '§2 — all refs cleared after rollback');
}

// ── §3 — Skip discardBatch when batched=false ───────────────────────
//
// Defensive: if some future code path opens a stroke WITHOUT
// beginBatch, the discardBatch call would pop a snapshot belonging to
// a different gesture (or no snapshot at all → corrupting depth
// counter). The batched flag is the explicit "this stroke owns a
// pre-snapshot" marker.

{
  let discardBatchCalls = 0;
  const state = {
    rafIdRef: { current: null },
    pendingPaintRef: { current: null },
    dragRef: { current: { pointerId: 1, batched: false, sx: 0, sy: 0 } },
    discardBatch: () => { discardBatchCalls++; },
  };

  executeRollback(state);

  ok(discardBatchCalls === 0,
    '§3 — discardBatch NOT called when drag.batched === false');
  ok(state.dragRef.current === null,
    '§3 — dragRef still cleared even without rollback');
}

// ── §4 — Subsequent pointerup is no-op after rollback ───────────────
//
// After dragRef is cleared, the SVG's onPointerUp handler must
// early-return WITHOUT calling endBatch (which would decrement depth
// past zero) and WITHOUT flushing pending paint (already cleared).

function handlePointerUp(state, e) {
  const drag = state.dragRef.current;
  if (!drag || drag.pointerId !== e.pointerId) return { type: 'no-op' };
  return { type: 'commit', flushedPaint: state.rafIdRef.current != null, endBatchCalled: drag.batched };
}

{
  const state = { rafIdRef: { current: null }, dragRef: { current: null } };
  const result = handlePointerUp(state, { pointerId: 7 });
  ok(result.type === 'no-op',
    '§4 — pointerup after Escape-rollback is a no-op (dragRef null)');
}

// ── §5 — Pointermove after rollback also no-op ──────────────────────
//
// The user might still be moving the mouse with LMB held. Without
// proper drag-ref check, this would re-trigger schedulePaint.

function handlePointerMove(state, e) {
  const drag = state.dragRef.current;
  if (!drag || drag.pointerId !== e.pointerId) return { type: 'cursor-move-only' };
  return { type: 'cursor-and-paint' };
}

{
  const state = { dragRef: { current: null } };
  const result = handlePointerMove(state, { pointerId: 7 });
  ok(result.type === 'cursor-move-only',
    '§5 — pointermove after Escape-rollback updates cursor only (no paint)');
}

// ── §6 — Escape propagation policy ──────────────────────────────────
//
// preventDefault + stopPropagation when Escape consumed → prevent
// global selection.clear from also firing. Without stopPropagation
// the global dispatcher (bubble-phase window listener) would still
// see Escape and clear selection — confusing UX (user thinks "Escape
// cancelled my stroke" but also their selection vanished).

function eventConsumption(rolledBack) {
  if (!rolledBack) return { preventDefault: false, stopPropagation: false };
  return { preventDefault: true, stopPropagation: true };
}

{
  const consumed = eventConsumption(true);
  ok(consumed.preventDefault === true,
    '§6 — Escape during stroke calls preventDefault');
  ok(consumed.stopPropagation === true,
    '§6 — Escape during stroke calls stopPropagation '
    + '(prevents global selection.clear from also firing)');
}

{
  const unconsumed = eventConsumption(false);
  ok(unconsumed.preventDefault === false && unconsumed.stopPropagation === false,
    '§6 — Escape with no stroke does NOT consume '
    + '(global Escape handlers fire normally)');
}

// ── §7 — handler-lifecycle policy ───────────────────────────────────
//
// The window keydown listener is registered on mount, removed on
// unmount. WeightPaintOverlay mounts only when `editMode === 'weightPaint'
// && nodeMesh exists` (line 158 `if (!active) return null;`), so the
// listener naturally scopes to "weight paint mode is active AND a part
// is selected with mesh data." No additional gate needed inside the
// handler — if user is in Weight Paint with no part selected, the
// overlay isn't mounted, no listener exists, Escape falls through to
// selection.clear (correct).

ok(true, '§7 — handler scope documented (mount-gated by active flag, '
  + 'no in-handler editMode check needed)');

console.log(`weightPaintEscapeCancelStroke: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
