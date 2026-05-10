// Toolset Plan Phase 2 audit fix (D-1, D-2, D-7) — Blender-faithful
// gesture model integration test.
//
// Replicates the snap branches inside `ModalTransformOverlay.applyDelta`
// against pure helpers, so we can pin the gesture-vocabulary contract:
//
//   - master OFF, no Ctrl   → no snap (free transform).
//   - master OFF, Ctrl held → snap engages (SNAP_INV).
//   - master ON,  no Ctrl   → snap engages.
//   - master ON,  Ctrl held → no snap (SNAP_INV).
//   - Shift held in any state → MOD_PRECISION (precision math, never
//     a snap-engagement modifier).
//
// Run: node scripts/test/test_snap_gesture_model.mjs

import {
  buildSnapHash,
  enumerateSelectionAnchorVerts,
  pickSelectionAnchor,
  snapDeltaToGrid,
  snapAngleToIncrement,
  snapScaleToIncrement,
  applyPrecisionToDelta,
  applyPrecisionToAngle,
  applyPrecisionToScale,
} from '../../src/lib/snap/index.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function close(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

const D2R = Math.PI / 180;

// Snap config matching SNAP_DEFAULT (audit-revised).
function makeSnap(overrides = {}) {
  return {
    enabled: false,
    modes: {
      grid:      { enabled: true,  increment: 16, precision: 1.6 },
      vertex:    { enabled: true,  threshold:   8 },
      increment: { enabled: false, value:       5, precision:   1 },
    },
    target: 'closest',
    ...overrides,
  };
}

// Mini reproduction of the modal's translate-snap branching. Returns
// the final dx, dy plus whether vertex-snap engaged.
function computeTranslateOutcome({
  rawDx, rawDy,
  cursorCanvas,
  anchorVerts,
  snapHash,
  snap,
  shift, ctrl,
}) {
  const masterOn = !!snap?.enabled;
  const effSnap = ctrl ? !masterOn : masterOn;
  let dx = rawDx, dy = rawDy;
  let vertexHit = null;

  if (effSnap && snap.modes.vertex.enabled) {
    const hit = snapHash.findNearest(cursorCanvas.x, cursorCanvas.y, snap.modes.vertex.threshold);
    if (hit) {
      const anchor = pickSelectionAnchor(anchorVerts, snap.target ?? 'closest', {
        snapTarget: hit, cursor: cursorCanvas,
      });
      dx = hit.x - anchor.x;
      dy = hit.y - anchor.y;
      vertexHit = hit;
    }
  }

  if (effSnap && !vertexHit && snap.modes.grid.enabled) {
    const grid = snap.modes.grid;
    const inc = shift ? grid.precision : grid.increment;
    const snapped = snapDeltaToGrid({ x: dx, y: dy }, inc);
    dx = snapped.x; dy = snapped.y;
  }

  if (!effSnap && shift) {
    const p = applyPrecisionToDelta({ x: dx, y: dy }, 0.1);
    dx = p.x; dy = p.y;
  } else if (effSnap && !vertexHit && !snap.modes.grid.enabled && shift) {
    const p = applyPrecisionToDelta({ x: dx, y: dy }, 0.1);
    dx = p.x; dy = p.y;
  }

  return { dx, dy, vertexHit };
}

const project = {
  nodes: [
    { id: 'A', type: 'part', mesh: { vertices: [
      { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 },
    ] } },
    { id: 'B', type: 'part', mesh: { vertices: [{ x: 500, y: 500 }] } },
  ],
};
const selection = [{ id: 'A', type: 'part' }];
const editorState = { editMode: 'object', activeVertex: null, selectedVertexIndices: new Map() };
const snapHash = buildSnapHash(project, { cellSize: 64, excludePartId: 'A' });
const anchorVerts = enumerateSelectionAnchorVerts(project, selection, editorState);

// ── Translate gesture matrix ─────────────────────────────────────────

// 1. Master OFF, no shift, no ctrl → free transform (raw delta).
{
  const r = computeTranslateOutcome({
    rawDx: 17, rawDy: 23,
    cursorCanvas: { x: 200, y: 200 },
    anchorVerts, snapHash,
    snap: makeSnap(),
    shift: false, ctrl: false,
  });
  assert(r.dx === 17 && r.dy === 23, 'master OFF + no mods → raw delta');
  assert(r.vertexHit === null, 'master OFF + no mods → no snap');
}

// 2. Master OFF, Shift held → MOD_PRECISION (× 0.1).
{
  const r = computeTranslateOutcome({
    rawDx: 100, rawDy: 200,
    cursorCanvas: { x: 0, y: 0 },
    anchorVerts, snapHash,
    snap: makeSnap(),
    shift: true, ctrl: false,
  });
  assert(close(r.dx, 10) && close(r.dy, 20),
    `master OFF + Shift → precision (10, 20), got (${r.dx}, ${r.dy})`);
  assert(r.vertexHit === null, 'master OFF + Shift → no snap');
}

// 3. Master OFF + Ctrl → SNAP_INV (snap fires!). Cursor near B's vert.
{
  const r = computeTranslateOutcome({
    rawDx: 0, rawDy: 0,
    cursorCanvas: { x: 502, y: 501 },   // near B@(500,500), within threshold 8
    anchorVerts, snapHash,
    snap: makeSnap(),
    shift: false, ctrl: true,
  });
  assert(r.vertexHit !== null && r.vertexHit.partId === 'B',
    'master OFF + Ctrl → SNAP_INV engages snap to B');
  // anchor is closest A-vert to (500,500) → A[2]@(200,200) is nearest.
  // delta = (500,500) - (200,200) = (300,300)
  assert(close(r.dx, 300) && close(r.dy, 300),
    `delta = target - closest-anchor = (300,300), got (${r.dx},${r.dy})`);
}

// 4. Master ON + no Ctrl → snap fires.
{
  const r = computeTranslateOutcome({
    rawDx: 0, rawDy: 0,
    cursorCanvas: { x: 502, y: 501 },
    anchorVerts, snapHash,
    snap: makeSnap({ enabled: true }),
    shift: false, ctrl: false,
  });
  assert(r.vertexHit !== null && r.vertexHit.partId === 'B',
    'master ON → snap fires');
}

// 5. Master ON + Ctrl → SNAP_INV cancels snap.
{
  const r = computeTranslateOutcome({
    rawDx: 17, rawDy: 23,
    cursorCanvas: { x: 502, y: 501 },
    anchorVerts, snapHash,
    snap: makeSnap({ enabled: true }),
    shift: false, ctrl: true,
  });
  assert(r.vertexHit === null, 'master ON + Ctrl → SNAP_INV cancels snap');
  assert(r.dx === 17 && r.dy === 23, 'and falls back to raw delta');
}

// 6. Master ON + grid only (no vertex) + Shift → grid precision.
{
  const snap = makeSnap({
    enabled: true,
    modes: {
      grid:      { enabled: true,  increment: 16, precision: 1.6 },
      vertex:    { enabled: false, threshold:   8 },
      increment: { enabled: false, value:       5, precision:   1 },
    },
  });
  const r = computeTranslateOutcome({
    rawDx: 17, rawDy: 23,
    cursorCanvas: { x: 0, y: 0 },
    anchorVerts, snapHash,
    snap,
    shift: true, ctrl: false,
  });
  // Shift → precision = 1.6. round(17/1.6)*1.6 = 11*1.6 = 17.6
  // round(23/1.6)*1.6 = 14*1.6 = 22.4
  assert(close(r.dx, 17.6) && close(r.dy, 22.4),
    `grid Shift = precision 1.6 → (17.6, 22.4), got (${r.dx}, ${r.dy})`);
}

// 7. Master ON + grid only + no Shift → grid increment 16.
{
  const snap = makeSnap({
    enabled: true,
    modes: {
      grid:      { enabled: true,  increment: 16, precision: 1.6 },
      vertex:    { enabled: false, threshold:   8 },
      increment: { enabled: false, value:       5, precision:   1 },
    },
  });
  const r = computeTranslateOutcome({
    rawDx: 17, rawDy: 23,
    cursorCanvas: { x: 0, y: 0 },
    anchorVerts, snapHash,
    snap,
    shift: false, ctrl: false,
  });
  // round(17/16)*16 = 16, round(23/16)*16 = 16
  assert(close(r.dx, 16) && close(r.dy, 16),
    `grid no-Shift = inc 16 → (16, 16), got (${r.dx}, ${r.dy})`);
}

// ── Rotate gesture matrix (replicate the rotate snap branches) ───────

function computeRotateOutcome({ rawAngle, snap, shift, ctrl }) {
  const masterOn = !!snap?.enabled;
  const effSnap = ctrl ? !masterOn : masterOn;
  if (effSnap && snap.modes.increment.enabled) {
    const inc = snap.modes.increment;
    const stepDeg = shift ? inc.precision : inc.value;
    return snapAngleToIncrement(rawAngle, stepDeg);
  }
  if (shift) return applyPrecisionToAngle(rawAngle, 0.1);
  return rawAngle;
}

// 8. Rotate, master OFF + Shift = precision (* 0.1)
{
  const out = computeRotateOutcome({
    rawAngle: D2R * 30, snap: makeSnap(), shift: true, ctrl: false,
  });
  assert(close(out, D2R * 3), `rotate Shift no-snap → 30°*0.1 = 3°, got ${out / D2R}°`);
}

// 9. Rotate, master ON + increment.enabled, no Shift → 5° step
{
  const snap = makeSnap({ enabled: true, modes: {
    grid: { enabled: false, increment: 16, precision: 1.6 },
    vertex: { enabled: false, threshold: 8 },
    increment: { enabled: true, value: 5, precision: 1 },
  } });
  const out = computeRotateOutcome({ rawAngle: D2R * 7, snap, shift: false, ctrl: false });
  assert(close(out, D2R * 5), `rotate snap-on no-Shift → 7° rounds to 5°, got ${out / D2R}°`);
}

// 10. Rotate, master ON + increment.enabled, Shift → 1° precision step
{
  const snap = makeSnap({ enabled: true, modes: {
    grid: { enabled: false, increment: 16, precision: 1.6 },
    vertex: { enabled: false, threshold: 8 },
    increment: { enabled: true, value: 5, precision: 1 },
  } });
  const out = computeRotateOutcome({ rawAngle: D2R * 7.4, snap, shift: true, ctrl: false });
  assert(close(out, D2R * 7), `rotate snap+Shift → 7.4° rounds to 7° at 1° step, got ${out / D2R}°`);
}

// 11. Rotate, master ON + Ctrl → SNAP_INV → no snap, no precision (no Shift)
{
  const snap = makeSnap({ enabled: true, modes: {
    grid: { enabled: false, increment: 16, precision: 1.6 },
    vertex: { enabled: false, threshold: 8 },
    increment: { enabled: true, value: 5, precision: 1 },
  } });
  const out = computeRotateOutcome({ rawAngle: D2R * 7, snap, shift: false, ctrl: true });
  assert(close(out, D2R * 7), `rotate snap-on + Ctrl SNAP_INV → no snap, raw 7°, got ${out / D2R}°`);
}

// ── Scale gesture matrix ─────────────────────────────────────────────

function computeScaleOutcome({ rawScale, snap, shift, ctrl }) {
  const masterOn = !!snap?.enabled;
  const effSnap = ctrl ? !masterOn : masterOn;
  if (effSnap && snap.modes.increment.enabled) {
    const inc = snap.modes.increment;
    const stepDeg = shift ? inc.precision : inc.value;
    return snapScaleToIncrement(rawScale, stepDeg);
  }
  if (shift) return applyPrecisionToScale(rawScale, 0.1);
  return rawScale;
}

// 12. Scale, master OFF + Shift = precision (relative-to-1)
{
  const out = computeScaleOutcome({ rawScale: 1.5, snap: makeSnap(), shift: true, ctrl: false });
  assert(close(out, 1.05), `scale Shift no-snap → 1 + 0.5*0.1 = 1.05, got ${out}`);
}

// 13. Scale, master ON + increment.enabled, no Shift → 0.05× step
{
  const snap = makeSnap({ enabled: true, modes: {
    grid: { enabled: false, increment: 16, precision: 1.6 },
    vertex: { enabled: false, threshold: 8 },
    increment: { enabled: true, value: 5, precision: 1 },
  } });
  const out = computeScaleOutcome({ rawScale: 1.07, snap, shift: false, ctrl: false });
  // step = 5/100 = 0.05. round(1.07/0.05)*0.05 = 21*0.05 = 1.05
  assert(close(out, 1.05), `scale snap on, 1.07 → 1.05 at 0.05 step, got ${out}`);
}

// 14. Scale, master ON + increment.enabled + Shift → 0.01× precision step
{
  const snap = makeSnap({ enabled: true, modes: {
    grid: { enabled: false, increment: 16, precision: 1.6 },
    vertex: { enabled: false, threshold: 8 },
    increment: { enabled: true, value: 5, precision: 1 },
  } });
  const out = computeScaleOutcome({ rawScale: 1.07, snap, shift: true, ctrl: false });
  // precision = 1 → step = 1/100 = 0.01. round(1.07/0.01)*0.01 = 1.07
  assert(close(out, 1.07), `scale snap + Shift → 1.07 at 0.01 step (identity), got ${out}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
