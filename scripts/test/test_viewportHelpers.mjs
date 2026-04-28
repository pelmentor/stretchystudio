// v3 Phase 0F.1 — Tests for the pure viewport helpers extracted from
// CanvasViewport.jsx. The functions never escaped the React file
// before, so they had no test coverage despite being pure utilities;
// this fixture is the first time their behaviour is locked in.
//
// Run: node scripts/test/test_viewportHelpers.mjs

import {
  clientToCanvasSpace,
  worldToLocal,
  findNearestVertex,
  brushWeight,
  sampleAlpha,
  computeImageBounds,
  basename,
  computeSmartMeshOpts,
  zoomAroundCursor,
} from '../../src/components/canvas/viewport/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

// ── clientToCanvasSpace ─────────────────────────────────────────────

{
  const canvas = { getBoundingClientRect: () => ({ left: 100, top: 50 }) };

  // No zoom, no pan: client-relative offset = canvas-space coord
  const v1 = { zoom: 1, panX: 0, panY: 0 };
  const [x1, y1] = clientToCanvasSpace(canvas, 150, 80, v1);
  assert(x1 === 50 && y1 === 30, 'identity transform');

  // 2x zoom halves the canvas-space delta
  const v2 = { zoom: 2, panX: 0, panY: 0 };
  const [x2, y2] = clientToCanvasSpace(canvas, 150, 80, v2);
  assert(x2 === 25 && y2 === 15, '2x zoom shrinks delta');

  // Pan offsets the origin in world coords
  const v3 = { zoom: 1, panX: 10, panY: 20 };
  const [x3, y3] = clientToCanvasSpace(canvas, 150, 80, v3);
  assert(x3 === 40 && y3 === 10, 'pan shifts origin');
}

// ── worldToLocal ────────────────────────────────────────────────────

{
  // Identity matrix → output equals input
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y] = worldToLocal(7, 11, I);
  assert(x === 7 && y === 11, 'worldToLocal: identity');

  // Translation -10 -20 (col-major: tx=col2[0], ty=col2[1])
  const T = [1, 0, 0, 0, 1, 0, -10, -20, 1];
  const [tx, ty] = worldToLocal(15, 25, T);
  assert(tx === 5 && ty === 5, 'worldToLocal: translation');

  // 2× scale
  const S = [2, 0, 0, 0, 2, 0, 0, 0, 1];
  const [sx, sy] = worldToLocal(3, 4, S);
  assert(sx === 6 && sy === 8, 'worldToLocal: scale');
}

// ── findNearestVertex ───────────────────────────────────────────────

{
  const verts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert(findNearestVertex(verts, 1, 1, 5) === 0, 'corner pick: top-left');
  assert(findNearestVertex(verts, 11, 1, 5) === 1, 'corner pick: top-right');
  assert(findNearestVertex(verts, 11, 11, 5) === 2, 'corner pick: bottom-right');
  // Outside radius → -1
  assert(findNearestVertex(verts, 100, 100, 5) === -1, 'no vertex within radius');
  // Empty array
  assert(findNearestVertex([], 0, 0, 5) === -1, 'empty array → -1');
  // Equal distance → first one wins (deterministic)
  const equiV = [{ x: -1, y: 0 }, { x: 1, y: 0 }];
  assert(findNearestVertex(equiV, 0, 0, 5) === 0, 'tie: lower index wins');
}

// ── brushWeight ─────────────────────────────────────────────────────

{
  // hardness=1 → uniform 1 inside, 0 outside
  assert(brushWeight(0, 10, 1) === 1, 'hardness=1 center → 1');
  assert(brushWeight(5, 10, 1) === 1, 'hardness=1 mid → 1');
  assert(brushWeight(10, 10, 1) === 0, 'hardness=1 edge → 0');
  assert(brushWeight(15, 10, 1) === 0, 'hardness=1 outside → 0');

  // hardness=0 → cosine falloff
  assert(near(brushWeight(0, 10, 0), 1), 'hardness=0 center → 1');
  assert(near(brushWeight(10, 10, 0), 0), 'hardness=0 edge → 0');
  assert(near(brushWeight(5, 10, 0), 0.5), 'hardness=0 half → 0.5 (cos(π/2))');

  // Outside is always 0 regardless of hardness
  assert(brushWeight(20, 10, 0) === 0, 'outside: hardness=0');
  assert(brushWeight(20, 10, 0.5) === 0, 'outside: hardness=0.5');
}

// ── sampleAlpha ─────────────────────────────────────────────────────

function makeAlphaImage(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4 + 3] = fill;
  }
  return { data, width: w, height: h };
}

{
  const img = makeAlphaImage(4, 4, 200);
  assert(sampleAlpha(img, 0, 0) === 200, 'sample inside');
  assert(sampleAlpha(img, 3.7, 1.2) === 200, 'sample with fractional coords');
  assert(sampleAlpha(img, -1, 0) === 0, 'sample left of edge → 0');
  assert(sampleAlpha(img, 0, -1) === 0, 'sample above edge → 0');
  assert(sampleAlpha(img, 4, 0) === 0, 'sample at right edge → 0 (exclusive)');
  assert(sampleAlpha(img, 0, 4) === 0, 'sample at bottom edge → 0 (exclusive)');
}

// ── computeImageBounds ──────────────────────────────────────────────

{
  // Fully transparent → null
  const transparent = makeAlphaImage(8, 8, 0);
  assert(computeImageBounds(transparent) === null, 'fully transparent → null');

  // Fully opaque
  const opaque = makeAlphaImage(8, 8, 255);
  const ob = computeImageBounds(opaque);
  assert(ob.minX === 0 && ob.minY === 0 && ob.maxX === 7 && ob.maxY === 7, 'fully opaque bbox');

  // One pixel opaque at (3, 5)
  const one = makeAlphaImage(8, 8, 0);
  one.data[(5 * 8 + 3) * 4 + 3] = 255;
  const b = computeImageBounds(one);
  assert(b.minX === 3 && b.minY === 5 && b.maxX === 3 && b.maxY === 5, 'single pixel bbox');

  // Threshold gating
  const dim = makeAlphaImage(2, 2, 5);
  assert(computeImageBounds(dim, 10) === null, 'below threshold → null');
  assert(computeImageBounds(dim, 1) !== null, 'above threshold → bbox');
}

// ── basename ────────────────────────────────────────────────────────

assert(basename('foo.psd') === 'foo', 'basename: simple');
assert(basename('a.b.c') === 'a.b', 'basename: only last extension stripped');
assert(basename('noext') === 'noext', 'basename: no extension is identity');
assert(basename('.hidden') === '', 'basename: dotfile becomes empty');

// ── computeSmartMeshOpts ────────────────────────────────────────────

{
  const transparent = computeSmartMeshOpts(null);
  assert(transparent.gridSpacing === 30, 'transparent fallback: gridSpacing=30');
  assert(transparent.numEdgePoints === 80, 'transparent fallback: numEdgePoints=80');

  // Tiny part — clamped to mins
  const tiny = computeSmartMeshOpts({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  assert(tiny.gridSpacing >= 6, 'tiny part: gridSpacing ≥ 6');
  assert(tiny.numEdgePoints >= 12, 'tiny part: numEdgePoints ≥ 12');

  // Huge part — clamped to maxs
  const huge = computeSmartMeshOpts({ minX: 0, minY: 0, maxX: 10000, maxY: 10000 });
  assert(huge.gridSpacing <= 80, 'huge part: gridSpacing ≤ 80');
  assert(huge.numEdgePoints <= 300, 'huge part: numEdgePoints ≤ 300');

  // Monotonic — bigger area → bigger grid
  const small = computeSmartMeshOpts({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  const med   = computeSmartMeshOpts({ minX: 0, minY: 0, maxX: 500, maxY: 500 });
  assert(med.gridSpacing >= small.gridSpacing, 'gridSpacing monotonic in area');
  assert(med.numEdgePoints >= small.numEdgePoints, 'numEdgePoints monotonic in area');
}

// ── zoomAroundCursor ────────────────────────────────────────────────

{
  // Zoom in: cursor at world (50, 50) when view is identity
  const v0 = { zoom: 1, panX: 0, panY: 0 };
  const inResult = zoomAroundCursor(v0, -1, 50, 50);
  assert(near(inResult.zoom, 1.1), 'zoom in: zoom = 1.1');
  // World point under cursor: world = (cursor - pan) / zoom = (50, 50)
  // After zoom: world = (50 - newPanX) / 1.1 should still be 50
  assert(near((50 - inResult.panX) / inResult.zoom, 50), 'zoom in: cursor world point fixed (x)');
  assert(near((50 - inResult.panY) / inResult.zoom, 50), 'zoom in: cursor world point fixed (y)');

  // Zoom out
  const outResult = zoomAroundCursor(v0, 1, 50, 50);
  assert(near(outResult.zoom, 1 / 1.1), 'zoom out: zoom = 1/1.1');
  assert(near((50 - outResult.panX) / outResult.zoom, 50), 'zoom out: cursor world point fixed (x)');

  // Clamping at max
  const max = zoomAroundCursor({ zoom: 20, panX: 0, panY: 0 }, -1, 0, 0);
  assert(max.zoom === 20, 'zoom clamped at 20');

  // Clamping at min
  const min = zoomAroundCursor({ zoom: 0.05, panX: 0, panY: 0 }, 1, 0, 0);
  assert(min.zoom === 0.05, 'zoom clamped at 0.05');

  // Zoom around a different cursor moves pan correctly
  const v1 = { zoom: 2, panX: 100, panY: 50 };
  const cursor = zoomAroundCursor(v1, -1, 200, 100);
  // World point under cursor before: ((200 - 100) / 2, (100 - 50) / 2) = (50, 25)
  // After zoom, world point under same cursor should be the same
  assert(near((200 - cursor.panX) / cursor.zoom, 50), 'zoom: world X fixed at cursor');
  assert(near((100 - cursor.panY) / cursor.zoom, 25), 'zoom: world Y fixed at cursor');
}

console.log(`viewportHelpers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
