// Toolset Phase 1.B — Lasso (point-in-polygon, even-odd fill rule).
//
// Run: node scripts/test/test_lassoSelect_winding.mjs

import {
  pointInPolygon,
  verticesInPolygon,
  partsInPolygon,
  mat3Identity,
} from '../../src/io/hitTest.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function arrEq(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

// ── Test 1: convex square ──
{
  const xs = [0, 100, 100,   0];
  const ys = [0,   0, 100, 100];
  assert(pointInPolygon( 50,  50, xs, ys) === true,  'Test 1: centre inside');
  assert(pointInPolygon(-10,  50, xs, ys) === false, 'Test 1: left outside');
  assert(pointInPolygon( 50, 110, xs, ys) === false, 'Test 1: below outside');
}

// ── Test 2: triangle ──
{
  const xs = [0, 100, 50];
  const ys = [0,   0, 100];
  assert(pointInPolygon(50, 30, xs, ys) === true,  'Test 2: triangle inside');
  assert(pointInPolygon(0, 50, xs, ys) === false,  'Test 2: outside left edge');
  assert(pointInPolygon(50, 99, xs, ys) === true,  'Test 2: near apex');
}

// ── Test 3: concave (star / chevron) ──
{
  // Chevron-shaped polygon: outer points form concave dent.
  // Coordinates: a "C" shape opening to the right.
  const xs = [  0,  60,  60,  20,  20,  60,  60,   0];
  const ys = [  0,   0,  20,  20,  80,  80, 100, 100];
  // (10, 50) — inside the "C"'s vertical strip on the left.
  assert(pointInPolygon(10, 50, xs, ys) === true,  'Test 3: inside C-strip');
  // (40, 50) — inside the C-cutout (the dent), should be outside.
  assert(pointInPolygon(40, 50, xs, ys) === false, 'Test 3: inside dent → outside');
  // (50, 10) — inside the top arm of the C.
  assert(pointInPolygon(50, 10, xs, ys) === true,  'Test 3: top arm');
}

// ── Test 4: degenerate (n < 3) returns false ──
{
  assert(pointInPolygon(0, 0, [0, 1], [0, 1]) === false, 'Test 4: 2-point polygon');
  assert(pointInPolygon(0, 0, [], []) === false, 'Test 4: empty polygon');
}

// ── Test 5: figure-8 self-intersecting (even-odd rule) ──
{
  // Two adjacent quads sharing a vertex form a figure-8 in even-odd:
  // both lobes count as inside; the cross-over point is on the boundary.
  // Polygon: (0,0)→(40,0)→(40,40)→(60,40)→(60,80)→(0,80)→ ... too complex.
  // Use a simpler self-intersecting bowtie: two triangles sharing apex.
  // (0,0) → (100,100) → (0,100) → (100,0) → close. This is a bowtie;
  // the centre is "outside" by even-odd.
  const xs = [  0, 100,   0, 100];
  const ys = [  0, 100, 100,   0];
  // Bowtie geometry (path: (0,0)→(100,100)→(0,100)→(100,0)→close):
  // forms two triangles meeting at centre (50,50). Lobes are
  // ABOVE / BELOW centre (not left/right) — the figure is mirror-
  // symmetric across the horizontal midline.
  assert(pointInPolygon(50, 50, xs, ys) === false, 'Test 5: bowtie centre → outside (even-odd)');
  assert(pointInPolygon(50, 25, xs, ys) === true,  'Test 5: bowtie lower lobe → inside');
  assert(pointInPolygon(50, 75, xs, ys) === true,  'Test 5: bowtie upper lobe → inside');
}

// ── Test 6: verticesInPolygon picks correct verts ──
{
  const verts = [
    { x:  10, y:  10 }, // 0 — inside square
    { x:  50, y:  50 }, // 1 — inside square
    { x: 200, y: 200 }, // 2 — outside
    { x:  90, y:  90 }, // 3 — inside (corner)
  ];
  // Square (0,0)-(100,100).
  const xs = [0, 100, 100,   0];
  const ys = [0,   0, 100, 100];
  const idx = verticesInPolygon(verts, xs, ys);
  assert(arrEq(idx, [0, 1, 3]), 'Test 6: verticesInPolygon picks 0,1,3');
}

// ── Test 7: verticesInPolygon flat-array form ──
{
  const verts = [10, 10,  50, 50,  200, 200,  90, 90];
  const xs = [0, 100, 100,   0];
  const ys = [0,   0, 100, 100];
  const idx = verticesInPolygon(verts, xs, ys);
  assert(arrEq(idx, [0, 1, 3]), 'Test 7: flat-array picks 0,1,3');
}

// ── Test 8: degenerate polygon returns no verts ──
{
  const verts = [{ x: 50, y: 50 }];
  assert(arrEq(verticesInPolygon(verts, [0, 1], [0, 1]), []), 'Test 8: 2-point polygon → empty');
  assert(arrEq(verticesInPolygon(verts, [], []), []), 'Test 8: empty polygon → empty');
}

// ── Test 9: partsInPolygon (Object Mode lasso) — AABB centre/corners
//          test passes for parts whose AABB touches the polygon.
{
  function quadPart(id, minX, minY, maxX, maxY) {
    return {
      id, type: 'part', visible: true, draw_order: 0,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      mesh: {
        vertices: [
          { x: minX, y: minY }, { x: maxX, y: minY },
          { x: maxX, y: maxY }, { x: minX, y: maxY },
        ],
        triangles: [0, 1, 2, 0, 2, 3],
        uvs: new Float32Array(8),
      },
    };
  }
  const parts = [
    quadPart('A',   0,   0, 100, 100),
    quadPart('B', 200, 200, 300, 300),
  ];
  const wm = new Map();
  for (const p of parts) wm.set(p.id, mat3Identity());

  // Polygon covers A but not B.
  const xs = [-50, 150, 150, -50];
  const ys = [-50, -50, 150, 150];
  const ids = partsInPolygon({ nodes: parts }, null, xs, ys, { worldMatrices: wm });
  assert(arrEq(ids, ['A']), 'Test 9: partsInPolygon picks only A');
}

// ── Test 10: partsInPolygon — degenerate polygon returns empty ──
{
  const ids = partsInPolygon({ nodes: [] }, null, [0, 1], [0, 1], {});
  assert(arrEq(ids, []), 'Test 10: degenerate polygon → empty');
}

console.log(`lassoSelect_winding: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
