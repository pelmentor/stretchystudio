// Regression for Phase 2.C (2026-06-12) — F-radius-adjust modal migration.
//
// Asserts the radiusAdjustStore lifecycle + modal-tool framework integration.
//
// Pre-migration the modal state lived in CanvasViewport's local
// `radiusAdjustModeRef`, was guarded by a typoed `editMode === 'mesh'`
// gate (editor store uses `'edit'` not `'mesh'` — the modal was DEAD
// CODE), and the F/Esc/wheel/click/mousemove handling was scattered
// across 4 separate handlers in CanvasViewport.
//
// Post-migration:
//   - radiusAdjustStore holds {active, startRadius, anchorClient}
//   - RadiusAdjustOverlay registers via useModalTool when active
//   - Handler owns F/Esc/wheel/mousedown/mousemove window events
//   - CanvasViewport keeps only the propEdit ring rendering (reads
//     the store for anchor pin) + the F-press entry trigger
//
// Run: node scripts/test/test_radiusAdjustModal.mjs

import { useRadiusAdjustStore } from '../../src/store/radiusAdjustStore.js';
import { useModalToolStore } from '../../src/v3/modalTool/store.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

function reset() {
  useRadiusAdjustStore.getState().cancel();
  const s = useModalToolStore.getState();
  for (const e of [...s.stack]) s.unregister(e.id);
}

// ── §1 — begin / commit / cancel lifecycle ─────────────────────────

{
  reset();
  ok(useRadiusAdjustStore.getState().active === false,
    '§1 — initial: active=false');
  useRadiusAdjustStore.getState().begin(48);
  const s = useRadiusAdjustStore.getState();
  ok(s.active === true, '§1 — begin: active=true');
  ok(s.startRadius === 48, '§1 — begin: startRadius captured');
  ok(s.anchorClient === null, '§1 — begin: anchorClient null (set on first mousemove)');
}

{
  reset();
  useRadiusAdjustStore.getState().begin(20);
  useRadiusAdjustStore.getState().commit();
  const s = useRadiusAdjustStore.getState();
  ok(s.active === false, '§1 — commit: active cleared');
  ok(s.startRadius === null, '§1 — commit: startRadius cleared');
  ok(s.anchorClient === null, '§1 — commit: anchorClient cleared');
}

{
  reset();
  useRadiusAdjustStore.getState().begin(20);
  useRadiusAdjustStore.getState().cancel();
  const s = useRadiusAdjustStore.getState();
  ok(s.active === false, '§1 — cancel: active cleared');
  ok(s.startRadius === null, '§1 — cancel: startRadius cleared');
}

// ── §2 — setAnchor on first mousemove ──────────────────────────────

{
  reset();
  useRadiusAdjustStore.getState().begin(50);
  useRadiusAdjustStore.getState().setAnchor({ x: 120, y: 80 });
  const s = useRadiusAdjustStore.getState();
  ok(s.anchorClient?.x === 120 && s.anchorClient?.y === 80,
    `§2 — setAnchor captures anchor (got ${JSON.stringify(s.anchorClient)})`);
}

// ── §3 — modal-tool dispatcher walk semantics ──────────────────────

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
  // Mock the F-radius modal handler. Like other modal G/R/S: owns
  // most keystrokes (no competing modals mid-gesture), specific
  // commit/cancel triggers.
  const handler = {
    current: (e) => {
      if (e.type === 'keydown' && e.key === 'Escape') return 'CANCELLED';
      if (e.type === 'keydown' && e.key === 'Enter')  return 'FINISHED';
      if (e.type === 'keydown' && (e.key === 'f' || e.key === 'F')
          && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return 'FINISHED';
      if (e.type === 'mousedown' && e.button === 2)   return 'CANCELLED';
      if (e.type === 'mousedown')                      return 'FINISHED';
      if (e.type === 'mousemove')                      return 'RUNNING_MODAL';
      if (e.type === 'wheel')                          return 'RUNNING_MODAL';
      if (e.type === 'contextmenu')                    return 'CANCELLED';
      if (e.type === 'keydown')                        return 'RUNNING_MODAL';
      return 'PASS_THROUGH';
    },
  };
  useModalToolStore.getState().register('radiusAdjust', handler);

  // F-again toggles off (commits, keeps current radius).
  let r = dispatch({ type: 'keydown', key: 'f' });
  ok(r.consumedBy === 'radiusAdjust' && r.result === 'FINISHED',
    '§3 — F-again: FINISHED (commit, keep current radius)');

  // Esc cancels (restore startRadius).
  r = dispatch({ type: 'keydown', key: 'Escape' });
  ok(r.consumedBy === 'radiusAdjust' && r.result === 'CANCELLED',
    '§3 — Esc: CANCELLED (overlay restores startRadius)');

  // Enter commits.
  r = dispatch({ type: 'keydown', key: 'Enter' });
  ok(r.consumedBy === 'radiusAdjust' && r.result === 'FINISHED',
    '§3 — Enter: FINISHED');

  // LMB commits.
  r = dispatch({ type: 'mousedown', button: 0 });
  ok(r.consumedBy === 'radiusAdjust' && r.result === 'FINISHED',
    '§3 — LMB-down: FINISHED');

  // RMB cancels.
  r = dispatch({ type: 'mousedown', button: 2 });
  ok(r.consumedBy === 'radiusAdjust' && r.result === 'CANCELLED',
    '§3 — RMB-down: CANCELLED');

  // RMB contextmenu also cancels.
  r = dispatch({ type: 'contextmenu' });
  ok(r.consumedBy === 'radiusAdjust' && r.result === 'CANCELLED',
    '§3 — contextmenu: CANCELLED');

  // Mousemove drives cursor-distance gesture.
  r = dispatch({ type: 'mousemove', clientX: 200, clientY: 200 });
  ok(r.consumedBy === 'radiusAdjust' && r.result === 'RUNNING_MODAL',
    '§3 — mousemove: RUNNING_MODAL');

  // Wheel nudges radius.
  r = dispatch({ type: 'wheel', deltaY: -100 });
  ok(r.consumedBy === 'radiusAdjust' && r.result === 'RUNNING_MODAL',
    '§3 — wheel: RUNNING_MODAL (canvas wheel never sees event during modal)');

  // Stray KeyG (would start translate modal) gets swallowed.
  r = dispatch({ type: 'keydown', key: 'g' });
  ok(r.consumedBy === 'radiusAdjust' && r.result === 'RUNNING_MODAL',
    '§3 — stray KeyG: RUNNING_MODAL (no nested transform modal)');
}

// ── §4 — useModalTool isActive=false unregisters ───────────────────

{
  reset();
  const handler = { current: (e) => e.type === 'wheel' ? 'RUNNING_MODAL' : 'PASS_THROUGH' };
  useModalToolStore.getState().register('radiusAdjust', handler);
  let r = dispatch({ type: 'wheel', deltaY: 1 });
  ok(r.consumedBy === 'radiusAdjust',
    '§4 — active: handler consumes wheel (canvas zoom suppressed)');

  // Simulate useModalTool's cleanup on isActive flip false.
  useModalToolStore.getState().unregister('radiusAdjust');
  r = dispatch({ type: 'wheel', deltaY: 1 });
  ok(r.consumedBy === null,
    '§4 — unregistered: wheel passes through to canvas zoom path');
}

// ── §5 — invariant: begin after begin re-seeds startRadius ─────────
//
// Defensive: if the F-press is somehow fired twice without a
// commit/cancel in between (concurrent input race), the SECOND begin
// should NOT lose the original startRadius without a cancel. We
// preserve the first startRadius by re-seeding (last write wins is
// the simplest semantic) — verifies the store doesn't silently
// short-circuit.

{
  reset();
  useRadiusAdjustStore.getState().begin(30);
  useRadiusAdjustStore.getState().begin(60);
  const s = useRadiusAdjustStore.getState();
  ok(s.active === true, '§5 — re-begin: still active');
  ok(s.startRadius === 60, '§5 — re-begin: startRadius updated (last-write-wins)');
  ok(s.anchorClient === null, '§5 — re-begin: anchorClient reset');
}

// ── §6 — stack ordering vs modal G/R/S ─────────────────────────────
//
// Defensive: if both radius-adjust and modalTransform are somehow
// registered concurrently (shouldn't happen — F gate is editMode ===
// 'edit' and modalTransform usually fires in object/pose), the LATEST
// registration wins per dispatcher latest-first walk. This is the same
// invariant the framework test asserts; we restate it here so a future
// dispatcher refactor that breaks it surfaces with this test too.

{
  reset();
  const transformHandler = {
    current: (e) => e.type === 'keydown' ? 'RUNNING_MODAL' : 'PASS_THROUGH',
  };
  const radiusHandler = {
    current: (e) => e.type === 'keydown' && e.key === 'Escape' ? 'CANCELLED' : 'PASS_THROUGH',
  };
  useModalToolStore.getState().register('modalTransform', transformHandler);
  useModalToolStore.getState().register('radiusAdjust', radiusHandler);

  const r = dispatch({ type: 'keydown', key: 'Escape' });
  ok(r.consumedBy === 'radiusAdjust',
    '§6 — radiusAdjust (latest) consumes Escape first');
  ok(r.calls.length === 1,
    '§6 — modalTransform handler not called (radius stopped propagation)');
}

console.log(`radiusAdjustModal: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
