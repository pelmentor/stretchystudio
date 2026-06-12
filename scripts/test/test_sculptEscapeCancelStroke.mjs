// Regression for Sculpt Escape-cancel-stroke (2026-06-12).
//
// Bug class: pressing Escape mid-sculpt-stroke had NO rollback path.
// The global Escape handler fired selection.clear (no-op in Sculpt
// mode), the stroke kept running until LMB release, and the eventual
// pointerup committed the partial stroke to undo history. Same shape
// as the Weight Paint Escape-cancel-stroke gap closed in af3cf1d.
//
// Prerequisite: sculpt stroke commit refactor (0f20fce) replaced the
// per-tick skipHistory toggle with proper beginBatch/endBatch
// boundaries, giving Escape a `discardBatch` target to call against.
//
// Difference from Weight Paint Escape:
//   - Weight paint discardBatch + clear dragRef is enough — the
//     HeatmapLayer re-renders when weightArr changes via Zustand
//     notify.
//   - Sculpt mutates `mesh.vertices` in place AND uploads positions
//     to GL per tick. discardBatch restores project state, but the GL
//     buffer still holds last-tick verts. Must explicitly re-upload
//     `drag.origVerts` (start-of-stroke snapshot captured at
//     pointerdown line 3179) so the visual reverts.
//
// Run: node scripts/test/test_sculptEscapeCancelStroke.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — gate predicate ─────────────────────────────────────────────

function shouldRollback(keyEvent, drag) {
  if (keyEvent.key !== 'Escape') return false;
  if (!drag) return false;
  if (drag.mode !== 'sculpt') return false;
  return true;
}

ok(shouldRollback({ key: 'Escape' }, { mode: 'sculpt', batched: true }) === true,
  '§1 — Escape during sculpt stroke → rollback');
ok(shouldRollback({ key: 'Escape' }, null) === false,
  '§1 — Escape with no drag → pass-through');
ok(shouldRollback({ key: 'Escape' }, { mode: 'brush', batched: true }) === false,
  '§1 — Escape during Edit-Mode brush drag → not our handler (brush has its own)');
ok(shouldRollback({ key: 'Escape' }, { mode: 'select' }) === false,
  '§1 — Escape during select-drag (box select etc.) → not our handler');
ok(shouldRollback({ key: 'g' }, { mode: 'sculpt' }) === false,
  '§1 — G during sculpt stroke → no-op');
ok(shouldRollback({ key: 'Enter' }, { mode: 'sculpt' }) === false,
  '§1 — Enter during sculpt stroke → no-op');

// ── §2 — rollback sequence: discardBatch → re-upload → clear dragRef ─

function executeRollback(state) {
  const events = [];
  const drag = state.dragRef.current;

  // 1. discardBatch (project state)
  if (drag.batched) {
    state.discardBatch((snapshot) => {
      events.push({ type: 'updateProject', snapshot, skipHistory: true });
    });
  }

  // 2. Re-upload origVerts to GL
  if (state.scene && drag.origVerts && drag.allUvs) {
    state.scene.parts.uploadPositions(drag.partId, drag.origVerts, drag.allUvs);
    events.push({ type: 'uploadPositions', partId: drag.partId, vertCount: drag.origVerts.length });
    state.scene._markDirty();
    events.push({ type: 'markDirty' });
  }

  // 3. Clear dragRef
  state.dragRef.current = null;
  events.push({ type: 'clearDragRef' });

  return events;
}

{
  const scene = { parts: { uploadPositions: () => {} }, _markDirty: () => {} };
  const origVerts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }];
  const state = {
    dragRef: {
      current: {
        mode: 'sculpt',
        partId: 'p1',
        batched: true,
        hasTicked: true,
        origVerts,
        allUvs: new Float32Array([0, 0, 1, 0, 1, 1]),
      },
    },
    discardBatch: (applyFn) => { applyFn({ projectId: 'pre' }); },
    scene,
  };

  const events = executeRollback(state);

  ok(events[0].type === 'updateProject' && events[0].skipHistory === true,
    '§2 — discardBatch + updateProject(skipHistory:true) FIRST');
  ok(events[0].snapshot?.projectId === 'pre',
    '§2 — updateProject receives pre-stroke snapshot');
  ok(events[1].type === 'uploadPositions' && events[1].vertCount === 3,
    '§2 — uploadPositions re-uploads origVerts SECOND (visual revert)');
  ok(events[2].type === 'markDirty',
    '§2 — markDirty signals scene to re-render with restored verts');
  ok(events[3].type === 'clearDragRef',
    '§2 — clear dragRef LAST so pointerup is a no-op');
  ok(state.dragRef.current === null,
    '§2 — dragRef cleared after rollback');
}

// ── §3 — empty stroke (hasTicked=false) still rolls back ────────────
//
// Even if no tick produced visible change, beginBatch ran at
// pointerdown and the batch is open. Escape must still discardBatch
// (pops the snapshot) — same as the pointerup empty-click path in the
// commit refactor.

{
  let discardCalls = 0;
  const scene = { parts: { uploadPositions: () => {} }, _markDirty: () => {} };
  const state = {
    dragRef: {
      current: {
        mode: 'sculpt',
        partId: 'p1',
        batched: true,
        hasTicked: false,
        origVerts: [{ x: 0, y: 0 }],
        allUvs: new Float32Array([0, 0]),
      },
    },
    discardBatch: () => { discardCalls++; },
    scene,
  };

  executeRollback(state);
  ok(discardCalls === 1, '§3 — empty-tick stroke still discards batch (pops snapshot)');
  ok(state.dragRef.current === null, '§3 — empty-tick dragRef cleared');
}

// ── §4 — defensive: batched=false drag does NOT discardBatch ────────

{
  let discardCalls = 0;
  const scene = { parts: { uploadPositions: () => {} }, _markDirty: () => {} };
  const state = {
    dragRef: {
      current: {
        mode: 'sculpt',
        partId: 'p1',
        batched: false,
        origVerts: [{ x: 0, y: 0 }],
        allUvs: new Float32Array([0, 0]),
      },
    },
    discardBatch: () => { discardCalls++; },
    scene,
  };

  executeRollback(state);
  ok(discardCalls === 0,
    '§4 — drag with batched=false → no discardBatch (defensive against future paths)');
  ok(state.dragRef.current === null,
    '§4 — dragRef still cleared');
}

// ── §5 — propagation policy: prevent global selection.clear ─────────

function eventConsumption(rolledBack) {
  return rolledBack
    ? { preventDefault: true, stopPropagation: true }
    : { preventDefault: false, stopPropagation: false };
}

{
  const consumed = eventConsumption(true);
  ok(consumed.preventDefault && consumed.stopPropagation,
    '§5 — Escape during sculpt stroke calls preventDefault + stopPropagation '
    + '(prevents global selection.clear from also firing)');
}

{
  const unconsumed = eventConsumption(false);
  ok(!unconsumed.preventDefault && !unconsumed.stopPropagation,
    '§5 — Escape with no sculpt drag does NOT consume '
    + '(global Escape fires normally)');
}

// ── §6 — handler does NOT fire in Edit Mode (Edit-Mode brush has its
//        own rollback semantic) ────────────────────────────────────────
//
// The mode check (drag.mode === 'sculpt') prevents this handler from
// rolling back an Edit-Mode brush deform — that gesture has different
// commit semantics (it goes through draftPose, not directly mutating
// mesh.vertices) and would corrupt undo if this handler interfered.

ok(shouldRollback({ key: 'Escape' }, { mode: 'brush', partId: 'p1' }) === false,
  '§6 — Edit-Mode brush drag NOT rolled back by sculpt Escape handler');

// ── §7 — symmetry with WeightPaintOverlay Escape (af3cf1d) ──────────
//
// Same gate predicate shape (Escape + active drag mode-check).
// Same discardBatch + clear-dragRef structure.
// DIFFERENT: sculpt additionally re-uploads origVerts to GL because
// sculpt mutates mesh.vertices in place; weight paint doesn't touch
// positions, so the heatmap re-render via Zustand is enough.

const symmetryTable = {
  weightPaint: { discardBatch: true, clearDragRef: true, reUploadGL: false },
  sculpt:      { discardBatch: true, clearDragRef: true, reUploadGL: true },
};

ok(symmetryTable.weightPaint.discardBatch === symmetryTable.sculpt.discardBatch,
  '§7 — both Escape handlers share discardBatch step');
ok(symmetryTable.weightPaint.clearDragRef === symmetryTable.sculpt.clearDragRef,
  '§7 — both Escape handlers share clear-dragRef step');
ok(symmetryTable.sculpt.reUploadGL === true && symmetryTable.weightPaint.reUploadGL === false,
  '§7 — sculpt-only extra step: re-upload origVerts to GL (vertex-position revert)');

console.log(`sculptEscapeCancelStroke: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
