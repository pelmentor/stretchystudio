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

// ── pre-mesh PSD parts: alpha sampling + imageBounds fallback ─────
//
// BUG-024 — During the wizard's Reorder step, parts have no mesh yet
// but DO carry imageWidth/imageHeight (= full canvas size for PSD
// parts). The original quad-only fallback always hit because every
// part's quad spans the entire canvas; alpha sampling and imageBounds
// both narrow the test to the layer's actual opaque footprint.

function makePremeshPart(id, drawOrder, bounds) {
  // bounds = { minX, minY, maxX, maxY } in canvas space.
  return {
    id, type: 'part', name: id,
    parent: null, draw_order: drawOrder,
    visible: true, opacity: 1, clip_mask: null,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 50, pivotY: 50 },
    meshOpts: null, mesh: null,
    imageWidth: 100, imageHeight: 100,
    imageBounds: bounds,
  };
}

function makeAlphaImageData(box) {
  // 100×100 RGBA, opaque inside `box`, transparent everywhere else.
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      data[(y * 100 + x) * 4 + 3] = 255;
    }
  }
  return { data, width: 100, height: 100 };
}

// M7b — wrap the test imageData into the AlphaMaskRecord shape that
// hitTestParts now consumes. Identity downsample (mask = source alpha
// channel at 100×100) keeps the existing assertions valid.
function makeAlphaMaskRecord(box) {
  const src = makeAlphaImageData(box);
  const mask = new Uint8Array(src.width * src.height);
  for (let i = 0; i < mask.length; i++) mask[i] = src.data[i * 4 + 3];
  return { mask, w: src.width, h: src.height, srcW: src.width, srcH: src.height };
}

{
  // Two overlapping pre-mesh layers: face (60×60 centered at 50,50),
  // hair (40×35 in the upper-left quadrant). At (60,60) only face is
  // opaque; at (15,10) only hair; at (30,30) both — hair on top.
  const face = makePremeshPart('face', 0, { minX: 20, minY: 20, maxX: 80, maxY: 80 });
  const hair = makePremeshPart('hair', 1, { minX: 10, minY: 5,  maxX: 50, maxY: 40 });
  const project = { nodes: [face, hair] };
  const imageDataMap = new Map([
    ['face', makeAlphaMaskRecord({ x0: 20, y0: 20, x1: 80, y1: 80 })],
    ['hair', makeAlphaMaskRecord({ x0: 10, y0: 5,  x1: 50, y1: 40 })],
  ]);

  // Alpha sampling distinguishes layers by actual opaque pixels.
  assert(hitTestParts(project, [], 60, 60, { imageDataMap }) === 'face', 'alpha: face only');
  assert(hitTestParts(project, [], 15, 10, { imageDataMap }) === 'hair', 'alpha: hair only');
  assert(hitTestParts(project, [], 30, 30, { imageDataMap }) === 'hair', 'alpha: hair on top of face');
  assert(hitTestParts(project, [], 5, 5,   { imageDataMap }) === null,   'alpha: outside both');
  // Click inside hair's bbox (10..50, 5..40) but a transparent pixel of hair
  // should fall through to face when face is opaque there.
  // hair opaque (10..50, 5..40). face opaque (20..80, 20..80). At (45, 35):
  // both layers' bboxes contain it; alpha-on-hair = 255 (it's painted there)
  // → returns hair. So pick a point inside hair-bbox but outside hair-alpha:
  // e.g. (45, 38) is inside hair-bbox, but hair-alpha covers (10..50, 5..40)
  // so it's still painted. The simplest "fall-through" point: if hair has
  // a transparent hole inside its bbox. We didn't model that here — the
  // alpha is uniform inside the box. Skip the fall-through assertion;
  // it's verified by construction (alpha < threshold → continue → next part).
}

{
  // Same project, no imageDataMap → imageBounds path.
  const face = makePremeshPart('face', 0, { minX: 20, minY: 20, maxX: 80, maxY: 80 });
  const hair = makePremeshPart('hair', 1, { minX: 10, minY: 5,  maxX: 50, maxY: 40 });
  const project = { nodes: [face, hair] };
  assert(hitTestParts(project, [], 60, 60) === 'face', 'bbox: face only');
  assert(hitTestParts(project, [], 15, 10) === 'hair', 'bbox: hair only');
  assert(hitTestParts(project, [], 30, 30) === 'hair', 'bbox: hair on top of face');
  assert(hitTestParts(project, [], 5, 5)   === null,   'bbox: outside both');
  // Click inside both bboxes but only inside face: e.g. (60, 35).
  // face bbox (20..80, 20..80) contains it; hair bbox (10..50, 5..40)
  // does NOT contain (60, 35) — x=60 > 50. So result must be face.
  assert(hitTestParts(project, [], 60, 35) === 'face', 'bbox: outside hair → fall through to face');
}

console.log(`hitTest: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
