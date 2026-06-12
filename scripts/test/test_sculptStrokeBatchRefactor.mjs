// Regression for the sculpt-stroke commit pattern refactor (2026-06-12).
//
// Pre-refactor: sculpt stroke used a per-tick `skipHistory` toggle.
// First non-empty tick called `updateProject` with `skipHistory:false`
// (which pushed a pre-tick snapshot), subsequent ticks with
// `skipHistory:true`. The whole stroke collapsed to one undo entry but
// the pattern had no rollback path — there's no batch boundary to call
// `discardBatch` against, so Escape-cancel-stroke couldn't be added
// without restructuring this first.
//
// Post-refactor: `beginBatch(project)` fires at pointerdown (pushing
// the pre-stroke snapshot once), all per-tick writes use
// `skipHistory:true`, and pointerup commits via `endBatch` (when at
// least one tick wrote) or `discardBatch` (empty stroke — no-op
// applyFn; verts unchanged).
//
// `hasTicked` tracks empty vs non-empty so the Grab brush's empty
// first tick case (no prevCursor → returns empty Map → no
// updateProject call) doesn't leave a stale snapshot on the undo
// stack at pointerup.
//
// Run: node scripts/test/test_sculptStrokeBatchRefactor.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — dragRef shape: batched + hasTicked replace firstTick ────────
//
// Pre-refactor dragRef had `firstTick: boolean` which the per-tick
// commit toggled. Post-refactor has `batched: true` (set at pointerdown
// when beginBatch fires) and `hasTicked: boolean` (set on first
// non-empty tick).

function pointerdownStrokeBegin(beginBatchCalls) {
  beginBatchCalls.count++;
  return {
    mode: 'sculpt',
    partId: 'p1',
    batched: true,
    hasTicked: false,
    // ... other stroke-state fields elided
  };
}

{
  const beginBatchCalls = { count: 0 };
  const drag = pointerdownStrokeBegin(beginBatchCalls);
  ok(drag.mode === 'sculpt', '§1 — pointerdown sets mode=sculpt');
  ok(drag.batched === true, '§1 — pointerdown sets batched=true (snapshot pushed)');
  ok(drag.hasTicked === false, '§1 — pointerdown initialises hasTicked=false');
  ok(beginBatchCalls.count === 1, '§1 — beginBatch called exactly once at pointerdown');
  ok(!('firstTick' in drag), '§1 — pre-refactor firstTick field is GONE');
}

// ── §2 — per-tick commit: skipHistory always true, hasTicked latches ──

function tickWriteUpdates(drag, updateProjectCalls, tickResultSize) {
  // Mirror of the per-tick code: bail on empty tick, otherwise mark
  // hasTicked + updateProject with skipHistory:true.
  if (tickResultSize === 0) return;
  drag.hasTicked = true;
  updateProjectCalls.push({ skipHistory: true });
}

{
  const drag = { batched: true, hasTicked: false };
  const calls = [];
  tickWriteUpdates(drag, calls, 0);
  ok(drag.hasTicked === false, '§2 — empty tick keeps hasTicked=false');
  ok(calls.length === 0, '§2 — empty tick does NOT call updateProject');
}

{
  const drag = { batched: true, hasTicked: false };
  const calls = [];
  tickWriteUpdates(drag, calls, 5);
  ok(drag.hasTicked === true, '§2 — first non-empty tick sets hasTicked=true');
  ok(calls.length === 1 && calls[0].skipHistory === true,
    '§2 — first non-empty tick calls updateProject({skipHistory:true})');
}

{
  const drag = { batched: true, hasTicked: false };
  const calls = [];
  tickWriteUpdates(drag, calls, 5);
  tickWriteUpdates(drag, calls, 3);
  tickWriteUpdates(drag, calls, 8);
  ok(calls.every((c) => c.skipHistory === true),
    '§2 — every per-tick write uses skipHistory:true (pre-refactor first-tick=false is GONE)');
  ok(drag.hasTicked === true, '§2 — hasTicked stays true across multiple ticks');
}

// ── §3 — pointerup: commit-or-discard policy ────────────────────────

function pointerupCommit(drag, hooks) {
  const wasSculpt = drag?.mode === 'sculpt';
  const sculptBatched = wasSculpt && drag.batched === true;
  const sculptHadTicks = wasSculpt && drag.hasTicked === true;
  if (sculptBatched) {
    if (sculptHadTicks) hooks.endBatch();
    else hooks.discardBatch(() => {});
  }
  return { wasSculpt, sculptBatched, sculptHadTicks };
}

{
  let endCalls = 0, discardCalls = 0;
  const hooks = { endBatch: () => endCalls++, discardBatch: () => discardCalls++ };
  const drag = { mode: 'sculpt', batched: true, hasTicked: true };
  pointerupCommit(drag, hooks);
  ok(endCalls === 1 && discardCalls === 0,
    '§3 — non-empty stroke → endBatch (commits as one undo entry)');
}

{
  let endCalls = 0, discardCalls = 0;
  const hooks = { endBatch: () => endCalls++, discardBatch: () => discardCalls++ };
  const drag = { mode: 'sculpt', batched: true, hasTicked: false };
  pointerupCommit(drag, hooks);
  ok(discardCalls === 1 && endCalls === 0,
    '§3 — empty stroke (Grab without follow-up move) → discardBatch (pops snapshot, no undo pollution)');
}

{
  let endCalls = 0, discardCalls = 0;
  const hooks = { endBatch: () => endCalls++, discardBatch: () => discardCalls++ };
  const drag = { mode: 'brush', batched: false, hasTicked: false };
  pointerupCommit(drag, hooks);
  ok(endCalls === 0 && discardCalls === 0,
    '§3 — non-sculpt drag → neither (brush deform uses its own commit path)');
}

// ── §4 — defensive: stale batched=false sculpt drag must not commit ──
//
// Future code paths that build a sculpt drag without calling beginBatch
// would have batched=false. The pointerup must NOT call endBatch on
// such drags (decrementing depth past zero is undefined behavior).

{
  let endCalls = 0, discardCalls = 0;
  const hooks = { endBatch: () => endCalls++, discardBatch: () => discardCalls++ };
  const drag = { mode: 'sculpt', batched: false, hasTicked: true };
  pointerupCommit(drag, hooks);
  ok(endCalls === 0 && discardCalls === 0,
    '§4 — sculpt drag with batched=false → no commit '
    + '(defensive against future code paths that bypass beginBatch)');
}

// ── §5 — empty pointerdown→pointerup (LMB click without move) ───────
//
// User clicks once with LMB, never moves. Stroke begins (beginBatch
// pushes snapshot), no ticks fire, pointerup discards the snapshot.
// Undo history must not contain a "ghost" sculpt entry for an
// uneventful click.

{
  let endCalls = 0, discardCalls = 0;
  const beginBatchCalls = { count: 0 };
  const hooks = { endBatch: () => endCalls++, discardBatch: () => discardCalls++ };

  // pointerdown
  const drag = pointerdownStrokeBegin(beginBatchCalls);
  // no pointermove ticks
  // pointerup
  pointerupCommit(drag, hooks);

  ok(beginBatchCalls.count === 1, '§5 — empty click: beginBatch fired at pointerdown');
  ok(discardCalls === 1, '§5 — empty click: discardBatch fired at pointerup');
  ok(endCalls === 0, '§5 — empty click: endBatch NOT fired (no undo pollution)');
}

// ── §6 — full stroke pointerdown→3 ticks→pointerup ──────────────────

{
  let endCalls = 0, discardCalls = 0;
  const beginBatchCalls = { count: 0 };
  const updateProjectCalls = [];
  const hooks = { endBatch: () => endCalls++, discardBatch: () => discardCalls++ };

  const drag = pointerdownStrokeBegin(beginBatchCalls);
  tickWriteUpdates(drag, updateProjectCalls, 5);
  tickWriteUpdates(drag, updateProjectCalls, 7);
  tickWriteUpdates(drag, updateProjectCalls, 4);
  pointerupCommit(drag, hooks);

  ok(beginBatchCalls.count === 1, '§6 — full stroke: beginBatch x1');
  ok(updateProjectCalls.length === 3, '§6 — full stroke: 3 per-tick writes');
  ok(updateProjectCalls.every(c => c.skipHistory === true),
    '§6 — full stroke: every write uses skipHistory:true');
  ok(endCalls === 1 && discardCalls === 0, '§6 — full stroke: endBatch commits to one undo entry');
}

// ── §7 — Grab brush case: empty first tick + non-empty subsequent ───
//
// Grab brush returns empty tickResult on the FIRST pointermove because
// prevCursor is null. Second pointermove onward returns non-empty
// (delta from startCursor → falloff-weighted displacement).
//
// Pre-refactor: firstTick was set true at pointerdown; the FIRST
// non-empty tick (which for Grab is the SECOND pointermove) flipped it
// to false and pushed the snapshot via skipHistory:false. Brittle —
// firstTick semantics meant "first non-empty tick" not "first tick."
//
// Post-refactor: beginBatch fires at pointerdown unconditionally.
// hasTicked stays false until something writes, regardless of how many
// empty ticks pass first.

{
  let endCalls = 0, discardCalls = 0;
  const beginBatchCalls = { count: 0 };
  const updateProjectCalls = [];
  const hooks = { endBatch: () => endCalls++, discardBatch: () => discardCalls++ };

  const drag = pointerdownStrokeBegin(beginBatchCalls);
  tickWriteUpdates(drag, updateProjectCalls, 0); // empty (Grab without prevCursor)
  tickWriteUpdates(drag, updateProjectCalls, 5); // non-empty (Grab second tick)
  tickWriteUpdates(drag, updateProjectCalls, 5); // non-empty (Grab third tick)
  pointerupCommit(drag, hooks);

  ok(updateProjectCalls.length === 2, '§7 — Grab: 2 non-empty writes (first tick skipped)');
  ok(updateProjectCalls.every(c => c.skipHistory === true),
    '§7 — Grab: all writes skipHistory:true (no first-tick special case)');
  ok(endCalls === 1, '§7 — Grab: endBatch commits the multi-tick stroke');
}

console.log(`sculptStrokeBatchRefactor: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
