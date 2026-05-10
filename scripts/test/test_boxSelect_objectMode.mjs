// Toolset Phase 1.A — Object-Mode box select (parts whose AABB
// intersects the rect).
//
// Run: node scripts/test/test_boxSelect_objectMode.mjs

import { partsInRect, mat3Identity } from '../../src/io/hitTest.js';

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

// Helpers ───────────────────────────────────────────────────────────────

function quadPart(id, minX, minY, maxX, maxY) {
  return {
    id,
    type: 'part',
    visible: true,
    draw_order: 0,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    mesh: {
      vertices: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      triangles: [0, 1, 2, 0, 2, 3],
      uvs: new Float32Array(8),
    },
  };
}

function project(parts) { return { nodes: parts }; }
function identityMatricesFor(parts) {
  const m = new Map();
  for (const p of parts) m.set(p.id, mat3Identity());
  return m;
}

// ── Test 1: simple rect intersects two of three parts (rest mesh) ──
{
  const parts = [
    quadPart('A',   0,   0,  100, 100),
    quadPart('B', 200, 200,  300, 300),
    quadPart('C',  50,  50,  250, 250),
  ];
  const proj = project(parts);
  const wm = identityMatricesFor(parts);
  // Rect (75,75)-(225,225) — A overlaps top-left, B overlaps top-left,
  // C overlaps fully.
  const ids = partsInRect(proj, null, 75, 75, 225, 225, { worldMatrices: wm });
  assert(arrEq(ids, ['A', 'B', 'C']), 'Test 1: all three intersect');
}

// ── Test 2: rect outside all parts → empty ──
{
  const parts = [quadPart('A', 0, 0, 100, 100)];
  const proj = project(parts);
  const wm = identityMatricesFor(parts);
  const ids = partsInRect(proj, null, 500, 500, 600, 600, { worldMatrices: wm });
  assert(arrEq(ids, []), 'Test 2: no intersect → empty');
}

// ── Test 3: rect normalized when min > max ──
{
  const parts = [quadPart('A', 0, 0, 100, 100)];
  const proj = project(parts);
  const wm = identityMatricesFor(parts);
  // Pass max < min — should normalize and still hit.
  const ids = partsInRect(proj, null, 100, 100, 0, 0, { worldMatrices: wm });
  assert(arrEq(ids, ['A']), 'Test 3: rect normalized');
}

// ── Test 4: invisible parts skipped ──
{
  const a = quadPart('A', 0, 0, 100, 100);
  const b = quadPart('B', 0, 0, 100, 100);
  b.visible = false;
  const proj = project([a, b]);
  const wm = identityMatricesFor([a, b]);
  const ids = partsInRect(proj, null, 0, 0, 200, 200, { worldMatrices: wm });
  assert(arrEq(ids, ['A']), 'Test 4: invisible part skipped');
}

// ── Test 5: edge-touching rect counts (inclusive) ──
{
  const parts = [quadPart('A', 0, 0, 100, 100)];
  const proj = project(parts);
  const wm = identityMatricesFor(parts);
  // Rect that exactly touches A's right edge — inclusive.
  const ids = partsInRect(proj, null, 100, 0, 200, 100, { worldMatrices: wm });
  assert(arrEq(ids, ['A']), 'Test 5: edge-touching counts');
}

// ── Test 6: chainEval frames (canvas-px flat array) preferred over rest ──
{
  const a = quadPart('A', 0, 0, 100, 100);
  const proj = project([a]);
  const wm = identityMatricesFor([a]);
  // Frame puts A at (500, 500) — different location from rest.
  const frames = [{ id: 'A', vertexPositions: new Float32Array([500, 500, 600, 500, 600, 600, 500, 600]) }];
  // Rect at rest position should miss; rect at frame position should hit.
  const idsRest = partsInRect(proj, frames, 0, 0, 50, 50, { worldMatrices: wm });
  assert(arrEq(idsRest, []), 'Test 6: frames override rest (rest position misses)');
  const idsFrame = partsInRect(proj, frames, 550, 550, 600, 600, { worldMatrices: wm });
  assert(arrEq(idsFrame, ['A']), 'Test 6: frames override rest (frame position hits)');
}

// ── Test 7: finalVertsByPartId (composed verts) preferred over frames ──
{
  const a = quadPart('A', 0, 0, 100, 100);
  const proj = project([a]);
  const wm = identityMatricesFor([a]);
  // Frame says (500, 500); finalVerts says (1000, 1000) — finalVerts wins.
  const frames = [{ id: 'A', vertexPositions: new Float32Array([500, 500, 600, 500, 600, 600, 500, 600]) }];
  const finalVertsByPartId = new Map([
    ['A', [{ x: 1000, y: 1000 }, { x: 1100, y: 1000 }, { x: 1100, y: 1100 }, { x: 1000, y: 1100 }]],
  ]);
  const idsFrame = partsInRect(proj, frames, 550, 550, 600, 600, { worldMatrices: wm, finalVertsByPartId });
  assert(arrEq(idsFrame, []), 'Test 7: finalVerts wins over frames (frame position misses)');
  const idsFinal = partsInRect(proj, frames, 1050, 1050, 1100, 1100, { worldMatrices: wm, finalVertsByPartId });
  assert(arrEq(idsFinal, ['A']), 'Test 7: finalVerts wins over frames (finalVerts position hits)');
}

// ── Test 8: pre-mesh PSD parts use imageBounds ──
{
  // No mesh; only imageBounds.
  const a = {
    id: 'A',
    type: 'part',
    visible: true,
    draw_order: 0,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    imageBounds: { minX: 50, minY: 50, maxX: 150, maxY: 150 },
  };
  const proj = project([a]);
  // Outside imageBounds → miss.
  const idsMiss = partsInRect(proj, null, 200, 200, 300, 300, { worldMatrices: new Map() });
  assert(arrEq(idsMiss, []), 'Test 8: imageBounds miss');
  // Inside imageBounds → hit.
  const idsHit = partsInRect(proj, null, 100, 100, 200, 200, { worldMatrices: new Map() });
  assert(arrEq(idsHit, ['A']), 'Test 8: imageBounds hit');
}

// ── Test 9: empty project → empty ──
{
  const ids = partsInRect({ nodes: [] }, null, 0, 0, 100, 100, {});
  assert(arrEq(ids, []), 'Test 9: empty project');
}

// ── Test 10: groups skipped (only parts) ──
{
  const parts = [quadPart('A', 0, 0, 100, 100)];
  const group = { id: 'G', type: 'group', visible: true };
  const proj = project([...parts, group]);
  const wm = identityMatricesFor(parts);
  const ids = partsInRect(proj, null, 0, 0, 200, 200, { worldMatrices: wm });
  assert(arrEq(ids, ['A']), 'Test 10: groups not in box-select result');
}

console.log(`boxSelect_objectMode: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
