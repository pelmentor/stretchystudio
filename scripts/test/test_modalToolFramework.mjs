// Modal-tool framework — store + dispatcher semantics test.
//
// Asserts the Blender-faithful modal handler stack:
//   - register(id, handlerRef) pushes to end of stack
//   - register(id, ...) again replaces same-id entry (dedup)
//   - unregister(id) removes
//   - Dispatcher walks latest-first
//   - 'PASS_THROUGH' (or falsy/undefined) continues to next handler
//   - 'RUNNING_MODAL' | 'FINISHED' | 'CANCELLED' stops propagation
//
// The dispatcher itself is React component code, but the routing logic
// is the same shape we can exercise with a manual stack walk.
//
// Mirrors Blender's `wm_event_system.cc:2617-2747` modal handler stack
// + `wm_handler_operator_call` return-value semantics.
//
// Run: node scripts/test/test_modalToolFramework.mjs

import { useModalToolStore } from '../../src/v3/modalTool/store.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

function reset() {
  const s = useModalToolStore.getState();
  for (const e of [...s.stack]) s.unregister(e.id);
}

/**
 * Replicates the dispatcher's walk-latest-first + result-stops-propagation
 * logic. Returns the index of the handler that consumed the event, or -1
 * if it passed through everything.
 *
 * @param {Event|object} event - any event-shape object
 * @returns {{consumedBy: string|null, calls: string[]}}
 */
function dispatch(event) {
  const stack = useModalToolStore.getState().stack;
  const calls = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const handler = stack[i].handler.current;
    if (!handler) continue;
    calls.push(stack[i].id);
    const result = handler(event);
    if (result === 'PASS_THROUGH' || !result) continue;
    return { consumedBy: stack[i].id, calls };
  }
  return { consumedBy: null, calls };
}

// ── §1 — register pushes to end ──────────────────────────────────────

{
  reset();
  const handler = { current: () => 'PASS_THROUGH' };
  useModalToolStore.getState().register('a', handler);
  const s = useModalToolStore.getState();
  ok(s.stack.length === 1, '§1 — single register: stack length 1');
  ok(s.stack[0].id === 'a', '§1 — first entry is id="a"');
}

// ── §2 — register same id twice deduplicates ────────────────────────

{
  reset();
  const h1 = { current: () => 'PASS_THROUGH' };
  const h2 = { current: () => 'PASS_THROUGH' };
  useModalToolStore.getState().register('a', h1);
  useModalToolStore.getState().register('a', h2);
  const s = useModalToolStore.getState();
  ok(s.stack.length === 1, '§2 — re-register same id: stack length still 1');
  ok(s.stack[0].handler === h2, '§2 — handler ref replaced with latest');
}

// ── §3 — register different ids stacks them in registration order ───

{
  reset();
  const ha = { current: () => 'PASS_THROUGH' };
  const hb = { current: () => 'PASS_THROUGH' };
  const hc = { current: () => 'PASS_THROUGH' };
  useModalToolStore.getState().register('a', ha);
  useModalToolStore.getState().register('b', hb);
  useModalToolStore.getState().register('c', hc);
  const s = useModalToolStore.getState();
  ok(s.stack.length === 3, '§3 — three registers: stack length 3');
  ok(s.stack[0].id === 'a' && s.stack[2].id === 'c',
    '§3 — order: a (first) at index 0, c (latest) at index 2');
}

// ── §4 — unregister removes by id ───────────────────────────────────

{
  reset();
  const ha = { current: () => 'PASS_THROUGH' };
  const hb = { current: () => 'PASS_THROUGH' };
  useModalToolStore.getState().register('a', ha);
  useModalToolStore.getState().register('b', hb);
  useModalToolStore.getState().unregister('a');
  const s = useModalToolStore.getState();
  ok(s.stack.length === 1, '§4 — unregister a: stack length 1');
  ok(s.stack[0].id === 'b', '§4 — only b remains');
}

// ── §5 — dispatcher walks latest-first ──────────────────────────────

{
  reset();
  const ha = { current: () => 'RUNNING_MODAL' };
  const hb = { current: () => 'RUNNING_MODAL' };
  useModalToolStore.getState().register('a', ha);
  useModalToolStore.getState().register('b', hb);
  const r = dispatch({ type: 'keydown' });
  ok(r.consumedBy === 'b', `§5 — latest (b) consumed first (got ${r.consumedBy})`);
  ok(r.calls.length === 1 && r.calls[0] === 'b',
    '§5 — handler a was NOT called (b stopped propagation)');
}

// ── §6 — PASS_THROUGH falls down the stack ─────────────────────────

{
  reset();
  const ha = { current: () => 'RUNNING_MODAL' };
  const hb = { current: () => 'PASS_THROUGH' };
  useModalToolStore.getState().register('a', ha);
  useModalToolStore.getState().register('b', hb);
  const r = dispatch({ type: 'keydown' });
  ok(r.consumedBy === 'a', `§6 — a consumed after b passed through (got ${r.consumedBy})`);
  ok(r.calls.length === 2 && r.calls[0] === 'b' && r.calls[1] === 'a',
    '§6 — b called first, then a');
}

// ── §7 — undefined / falsy returns are treated as PASS_THROUGH ─────

{
  reset();
  const ha = { current: () => 'RUNNING_MODAL' };
  const hb = { current: () => undefined };
  const hc = { current: () => false };
  useModalToolStore.getState().register('a', ha);
  useModalToolStore.getState().register('b', hb);
  useModalToolStore.getState().register('c', hc);
  const r = dispatch({ type: 'keydown' });
  ok(r.consumedBy === 'a',
    `§7 — c (false) and b (undefined) passed through, a consumed (got ${r.consumedBy})`);
  ok(r.calls.length === 3, '§7 — all three handlers called');
}

// ── §8 — empty stack: dispatcher returns null consumer ─────────────

{
  reset();
  const r = dispatch({ type: 'keydown' });
  ok(r.consumedBy === null, '§8 — empty stack: nothing consumed');
  ok(r.calls.length === 0, '§8 — no handlers called');
}

// ── §9 — all-passthrough stack: nothing consumes ────────────────────

{
  reset();
  useModalToolStore.getState().register('a', { current: () => 'PASS_THROUGH' });
  useModalToolStore.getState().register('b', { current: () => 'PASS_THROUGH' });
  const r = dispatch({ type: 'keydown' });
  ok(r.consumedBy === null, '§9 — all pass-through: nothing consumed');
  ok(r.calls.length === 2, '§9 — both handlers were called');
}

// ── §10 — FINISHED and CANCELLED also stop propagation ─────────────

{
  reset();
  useModalToolStore.getState().register('a', { current: () => 'RUNNING_MODAL' });
  useModalToolStore.getState().register('b', { current: () => 'FINISHED' });
  const r = dispatch({ type: 'mouseup' });
  ok(r.consumedBy === 'b', '§10 — FINISHED stops propagation');
}
{
  reset();
  useModalToolStore.getState().register('a', { current: () => 'RUNNING_MODAL' });
  useModalToolStore.getState().register('b', { current: () => 'CANCELLED' });
  const r = dispatch({ type: 'keydown' });
  ok(r.consumedBy === 'b', '§10 — CANCELLED stops propagation');
}

// ── §11 — handler null current is skipped (no crash) ───────────────

{
  reset();
  useModalToolStore.getState().register('a', { current: null });
  useModalToolStore.getState().register('b', { current: () => 'RUNNING_MODAL' });
  const r = dispatch({ type: 'keydown' });
  ok(r.consumedBy === 'b', '§11 — handler with null current is skipped');
  ok(r.calls.length === 1 && r.calls[0] === 'b',
    '§11 — null-current handler not invoked');
}

// ── §12 — handler ref mutation is picked up live ───────────────────

{
  reset();
  const ref = { current: () => 'PASS_THROUGH' };
  useModalToolStore.getState().register('a', ref);
  let r = dispatch({ type: 'keydown' });
  ok(r.consumedBy === null, '§12 — initial handler: PASS_THROUGH');
  // Mutate the ref — same store entry now wraps the new closure.
  ref.current = () => 'RUNNING_MODAL';
  r = dispatch({ type: 'keydown' });
  ok(r.consumedBy === 'a', '§12 — after ref mutation: RUNNING_MODAL consumed');
}

console.log(`modalToolFramework: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
