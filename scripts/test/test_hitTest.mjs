// Click-to-select hit-test unit tests.
//
// Run: node scripts/test/test_hitTest.mjs

import { hitTestParts, pointInTriangle } from '../../src/io/hitTest.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── pointInTriangle ─────────────────────────────────────────────────

{
  // Triangle (0,0)–(10,0)–(0,10).
  assert(pointInTriangle(2, 2, 0, 0, 10, 0, 0, 10), 'inside');
  assert(!pointInTriangle(20, 20, 0, 0, 10, 0, 0, 10), 'outside');
  assert(!pointInTriangle(-1, 5, 0, 0, 10, 0, 0, 10), 'outside left');
  // On a vertex
  assert(pointInTriangle(0, 0, 0, 0, 10, 0, 0, 10), 'on vertex A');
  // On an edge
  assert(pointInTriangle(5, 0, 0, 0, 10, 0, 0, 10), 'on edge AB');
  assert(pointInTriangle(0, 5, 0, 0, 10, 0, 0, 10), 'on edge AC');
  // Reverse winding (CW vs CCW) — inclusive sign-based test handles both
  assert(pointInTriangle(2, 2, 0, 0, 0, 10, 10, 0), 'inside (reverse winding)');
}

// ── hitTestParts: basic topmost selection ───────────────────────────

// Build a project with three overlapping square parts at draw_order 0,1,2.
// Each part has a single quad triangulated into two triangles. Part B's
// quad is offset, C is at the front. We test:
//   (1) clicks landing only on one part hit that part.
//   (2) clicks landing on overlap pick the highest draw_order (front).
//   (3) clicks on empty canvas return null.
//   (4) hidden parts are excluded.
//   (5) parts without mesh are excluded.

function makeSquarePart(id, drawOrder, x, y, size = 10, opts = {}) {
  return {
    id,
    type: 'part',
    name: id,
    draw_order: drawOrder,
    visible: opts.visible ?? true,
    parent: null,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
    mesh: opts.mesh === null
      ? null
      : {
        // Two-triangle quad: (x,y)-(x+size,y)-(x,y+size)-(x+size,y+size)
        vertices: [
          { x, y, restX: x, restY: y },
          { x: x + size, y, restX: x + size, restY: y },
          { x, y: y + size, restX: x, restY: y + size },
          { x: x + size, y: y + size, restX: x + size, restY: y + size },
        ],
        triangles: [[0, 1, 2], [1, 3, 2]],
        uvs: [],
        edgeIndices: new Set(),
      },
  };
}

{
  const project = {
    nodes: [
      makeSquarePart('A', 0, 0, 0),     // back: (0..10, 0..10)
      makeSquarePart('B', 1, 5, 5),     // mid: (5..15, 5..15) — overlaps A in (5..10, 5..10)
      makeSquarePart('C', 2, 8, 8),     // front: (8..18, 8..18) — overlaps both at (8..10, 8..10)
    ],
  };

  // (1) Click only over A: x=2,y=2 → 'A'
  assert(hitTestParts(project, [], 2, 2) === 'A', 'topmost: A only');
  // (1b) Click only over C: x=15,y=15 → 'C'
  assert(hitTestParts(project, [], 15, 15) === 'C', 'topmost: C only');
  // (2) Click in 3-way overlap (8..10, 8..10): should pick C (front)
  assert(hitTestParts(project, [], 9, 9) === 'C', 'topmost wins in overlap');
  // (2b) Click in 2-way overlap (5..8 x 5..8) → should pick B (front of A)
  assert(hitTestParts(project, [], 6, 6) === 'B', 'topmost wins B over A');
  // (3) Click on empty canvas: x=100,y=100 → null
  assert(hitTestParts(project, [], 100, 100) === null, 'empty canvas → null');
}

// ── hidden / mesh-less parts excluded ──────────────────────────────

{
  const project = {
    nodes: [
      makeSquarePart('Hidden', 5, 0, 0, 10, { visible: false }),
      makeSquarePart('A', 0, 0, 0),
    ],
  };
  assert(hitTestParts(project, [], 2, 2) === 'A', 'hidden part skipped');
}

{
  const project = {
    nodes: [
      makeSquarePart('NoMesh', 5, 0, 0, 10, { mesh: null }),
      makeSquarePart('A', 0, 0, 0),
    ],
  };
  assert(hitTestParts(project, [], 2, 2) === 'A', 'mesh-less part skipped');
}

// ── group nodes excluded ───────────────────────────────────────────

{
  const project = {
    nodes: [
      { id: 'G', type: 'group', draw_order: 99, visible: true, parent: null },
      makeSquarePart('A', 0, 0, 0),
    ],
  };
  assert(hitTestParts(project, [], 2, 2) === 'A', 'group node skipped');
}

// ── rig-evaluated frames take priority over rest mesh ──────────────

{
  // Rest mesh of A is at (0..10, 0..10). Rig moves it to (50..60, 50..60).
  // A click at (5,5) should NOT select A any more; (55,55) should.
  const project = {
    nodes: [makeSquarePart('A', 0, 0, 0)],
  };
  const movedVerts = new Float32Array([
    50, 50,
    60, 50,
    50, 60,
    60, 60,
  ]);
  const frames = [{ id: 'A', vertexPositions: movedVerts }];
  assert(hitTestParts(project, frames, 5, 5) === null, 'rest pose ignored when rig drives');
  assert(hitTestParts(project, frames, 55, 55) === 'A', 'rig-evaluated position selected');
}

// ── frames is null/empty → fallback to rest mesh ───────────────────

{
  const project = { nodes: [makeSquarePart('A', 0, 0, 0)] };
  assert(hitTestParts(project, null, 2, 2) === 'A', 'null frames → rest pose');
  assert(hitTestParts(project, undefined, 2, 2) === 'A', 'undefined frames → rest pose');
  assert(hitTestParts(project, [], 2, 2) === 'A', 'empty frames → rest pose');
}

// ── empty / malformed project ─────────────────────────────────────

{
  assert(hitTestParts({ nodes: [] }, [], 1, 1) === null, 'empty nodes → null');
  assert(hitTestParts({}, [], 1, 1) === null, 'no nodes key → null');
  assert(hitTestParts(null, [], 1, 1) === null, 'null project → null');
}

// ── empty triangle list excluded ──────────────────────────────────

{
  const part = makeSquarePart('A', 0, 0, 0);
  part.mesh.triangles = [];
  const project = { nodes: [part] };
  assert(hitTestParts(project, [], 5, 5) === null, 'empty triangulation → null');
}

// ── worldMatrices fallback (non-rig parts) ────────────────────────

{
  // Rest mesh at (0..10, 0..10). worldMatrix translates +100,+100 →
  // visible at (100..110, 100..110). Click at (105,105) should select.
  const project = { nodes: [makeSquarePart('A', 0, 0, 0)] };
  // Column-major 3×3 affine: identity rotation/scale, translate (100,100).
  const wm = new Float32Array([1, 0, 0, 0, 1, 0, 100, 100, 1]);
  const worldMatrices = new Map([['A', wm]]);
  assert(hitTestParts(project, [], 105, 105, { worldMatrices }) === 'A', 'wm-translated hit');
  assert(hitTestParts(project, [], 5, 5, { worldMatrices }) === null, 'rest-pose miss when wm offsets it');
}

console.log(`hitTest: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
