// Regression for "B-select starts drawing the rect from the B-press
// cursor instead of waiting for LMB-click" (user 2026-06-11).
//
// Asserts the Blender-faithful gesture-box state machine:
//   Phase 1 (armed):    `arm()` opens modal; kind='box', no startClient.
//                       Overlay listens for LMB-down but draws nothing.
//   Phase 2 (dragging): overlay's `anchor()` on first LMB-down sets
//                       startClient AND currentClient at the click.
//                       Subsequent `update()` advances currentClient.
//   Cancel:            `cancel()` resets everything (works in either
//                       phase). `commit()` same.
//
// Plus the lasso path: `begin()` still anchors immediately (Ctrl+LMB-
// drag already has the click), unchanged from prior behavior.
//
// Mirrors Blender's `Gesture Box` modal map at
// `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:6259-6270`
// where the `BEGIN` action only fires on LEFTMOUSE PRESS — not on
// operator invoke.
//
// Run: node scripts/test/test_boxSelectArmAnchor.mjs

import { useBoxSelectStore } from '../../src/store/boxSelectStore.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

function reset() { useBoxSelectStore.getState().cancel(); }

// ── §1 — `arm()` opens modal in armed-not-anchored state ─────────────

{
  reset();
  useBoxSelectStore.getState().arm({
    kind: 'box',
    mode: 'object',
    editPartId: null,
  });
  const s = useBoxSelectStore.getState();
  ok(s.kind === 'box', '§1 — armed: kind=box (overlay mounts)');
  ok(s.mode === 'object', '§1 — armed: mode captured');
  ok(s.startClient === null, '§1 — armed: NO startClient (no rect drawn)');
  ok(s.currentClient === null, '§1 — armed: NO currentClient');
}

// ── §2 — `anchor()` transitions armed → dragging at click point ─────

{
  reset();
  useBoxSelectStore.getState().arm({
    kind: 'box', mode: 'object', editPartId: null,
  });
  // Time passes — cursor moves around (no anchor yet, overlay swallows
  // moves before LMB-down). User finally clicks LMB at (220, 180).
  useBoxSelectStore.getState().anchor({ x: 220, y: 180 });
  const s = useBoxSelectStore.getState();
  ok(s.kind === 'box', '§2 — anchored: kind still box');
  ok(s.startClient?.x === 220 && s.startClient?.y === 180,
    `§2 — anchored: startClient = click point (got ${JSON.stringify(s.startClient)})`);
  ok(s.currentClient?.x === 220 && s.currentClient?.y === 180,
    `§2 — anchored: currentClient seeded at click point (rect at 0×0)`);
}

// ── §3 — `update()` after anchor grows the rect ──────────────────────

{
  reset();
  useBoxSelectStore.getState().arm({
    kind: 'box', mode: 'edit', editPartId: 'part-1',
  });
  useBoxSelectStore.getState().anchor({ x: 100, y: 100 });
  useBoxSelectStore.getState().update({ x: 300, y: 200 });
  const s = useBoxSelectStore.getState();
  ok(s.startClient?.x === 100 && s.startClient?.y === 100,
    '§3 — startClient preserved across update');
  ok(s.currentClient?.x === 300 && s.currentClient?.y === 200,
    '§3 — currentClient = latest cursor');
  ok(s.editPartId === 'part-1', '§3 — editPartId preserved');
}

// ── §4 — `cancel()` from armed phase resets everything ──────────────

{
  reset();
  useBoxSelectStore.getState().arm({
    kind: 'box', mode: 'object', editPartId: null,
  });
  useBoxSelectStore.getState().cancel();
  const s = useBoxSelectStore.getState();
  ok(s.kind === null, '§4 — cancel from armed clears kind');
  ok(s.startClient === null && s.currentClient === null,
    '§4 — cancel from armed clears anchor');
}

// ── §5 — `cancel()` from dragging phase resets everything ──────────

{
  reset();
  useBoxSelectStore.getState().arm({
    kind: 'box', mode: 'object', editPartId: null,
  });
  useBoxSelectStore.getState().anchor({ x: 50, y: 50 });
  useBoxSelectStore.getState().update({ x: 80, y: 80 });
  useBoxSelectStore.getState().cancel();
  const s = useBoxSelectStore.getState();
  ok(s.kind === null, '§5 — cancel from dragging clears kind');
  ok(s.startClient === null, '§5 — cancel from dragging clears startClient');
}

// ── §6 — lasso `begin()` path unchanged: anchors immediately ────────

{
  reset();
  useBoxSelectStore.getState().begin({
    kind: 'lasso',
    mode: 'object',
    editPartId: null,
    startClient: { x: 100, y: 100 },
    gestureModifier: 'add',
  });
  const s = useBoxSelectStore.getState();
  ok(s.kind === 'lasso', '§6 — lasso begin: kind=lasso');
  ok(s.startClient?.x === 100 && s.startClient?.y === 100,
    '§6 — lasso begin: anchored at click immediately');
  ok(s.currentClient?.x === 100 && s.currentClient?.y === 100,
    '§6 — lasso begin: currentClient seeded');
  ok(s.pathClient.length === 1 && s.pathClient[0]?.x === 100,
    '§6 — lasso begin: pathClient seeded with first point');
  ok(s.gestureModifier === 'add', '§6 — lasso begin: gestureModifier captured');
}

// ── §7 — lasso `update()` appends to path ───────────────────────────

{
  reset();
  useBoxSelectStore.getState().begin({
    kind: 'lasso', mode: 'object', editPartId: null,
    startClient: { x: 0, y: 0 },
  });
  useBoxSelectStore.getState().update({ x: 10, y: 10 });
  useBoxSelectStore.getState().update({ x: 20, y: 20 });
  const s = useBoxSelectStore.getState();
  ok(s.pathClient.length === 3,
    `§7 — lasso path = [seed, 10/10, 20/20] (got len ${s.pathClient.length})`);
  ok(s.currentClient?.x === 20 && s.currentClient?.y === 20,
    '§7 — lasso currentClient tracks latest');
}

// ── §8 — `update()` while armed (no startClient) is a no-op ─────────

{
  // Defensive: if the overlay's onMouseMove gate is removed in a future
  // refactor, the store should still not silently grow a rect from rest.
  reset();
  useBoxSelectStore.getState().arm({
    kind: 'box', mode: 'object', editPartId: null,
  });
  useBoxSelectStore.getState().update({ x: 999, y: 999 });
  const s = useBoxSelectStore.getState();
  ok(s.currentClient === null,
    '§8 — update() while armed leaves currentClient null (no spontaneous anchor)');
  ok(s.startClient === null,
    '§8 — update() while armed leaves startClient null');
}

console.log(`boxSelectArmAnchor: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
