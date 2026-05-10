// Toolset Plan Phase 6.D — Circle Select hit-test helpers.
//
// Verifies `verticesInCircle(verts, cx, cy, r)` and
// `partsInCircle(project, frames, cx, cy, r, opts)`.
//
// Run: node scripts/test/test_circle_select_helpers.mjs

import { verticesInCircle, partsInCircle } from '../../src/io/hitTest.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── verticesInCircle ──────────────────────────────────────────────

// 1. Object-shape verts, all inside circle.
{
  const verts = [
    {x:0,y:0}, {x:1,y:1}, {x:-1,y:-1}, {x:2,y:0},
  ];
  // Circle at origin, r=3 → all 4 inside.
  const r = verticesInCircle(verts, 0, 0, 3);
  assert(r.length === 4, `r=3 → all 4 inside, got ${r.length}`);
  for (const i of [0,1,2,3]) {
    assert(r.includes(i), `includes vert ${i}`);
  }
}

// 2. Object-shape verts, partial inside.
{
  const verts = [
    {x:0,y:0}, {x:5,y:0}, {x:0,y:5}, {x:100,y:100},
  ];
  // Circle at origin, r=2.5 → only vert 0 inside (others at dist 5+).
  const r = verticesInCircle(verts, 0, 0, 2.5);
  assert(r.length === 1 && r[0] === 0,
    `r=2.5 at origin → just vert 0, got ${r}`);
  // r=5.5 → verts 0,1,2 inside (1 and 2 at dist exactly 5; <= boundary).
  const r2 = verticesInCircle(verts, 0, 0, 5.5);
  assert(r2.length === 3 && r2.includes(0) && r2.includes(1) && r2.includes(2),
    `r=5.5 → {0,1,2}, got ${r2}`);
}

// 3. Boundary inclusion: vert at exactly r=radius IS included.
{
  const verts = [{x:5,y:0}];
  const r = verticesInCircle(verts, 0, 0, 5);
  assert(r.length === 1, `vert at r=5 with radius=5 → included (got ${r.length})`);
}

// 4. Flat-array verts.
{
  const flat = [0,0, 5,0, 0,5, 100,100]; // 4 verts
  const r = verticesInCircle(flat, 0, 0, 5.5);
  assert(r.length === 3 && r.includes(0) && r.includes(1) && r.includes(2),
    `flat-shape → {0,1,2}, got ${r}`);
}

// 5. Empty / zero-radius / negative-radius edge cases.
{
  assert(verticesInCircle([], 0, 0, 1).length === 0, 'empty verts → []');
  assert(verticesInCircle([{x:0,y:0}], 0, 0, 0).length === 0, 'r=0 → []');
  assert(verticesInCircle([{x:0,y:0}], 0, 0, -1).length === 0, 'r<0 → []');
  assert(verticesInCircle(null, 0, 0, 1).length === 0, 'null verts → []');
}

// 6. Output is sorted ascending (matches verticesInRect contract).
{
  // Place verts so circle picks indices 1, 3, 4 (not in tail order).
  const verts = [
    {x:100,y:100},  // 0 — outside
    {x:1,y:0},      // 1 — inside
    {x:200,y:200},  // 2 — outside
    {x:0,y:1},      // 3 — inside
    {x:0.5,y:0.5},  // 4 — inside
  ];
  const r = verticesInCircle(verts, 0, 0, 2);
  assert(r.length === 3, `3 verts inside (got ${r.length})`);
  for (let i = 1; i < r.length; i++) {
    assert(r[i] > r[i-1], `output sorted ascending at ${i}`);
  }
}

// ── partsInCircle ─────────────────────────────────────────────────

// Helper: build a project with one part whose mesh has known AABB.
function projectWithPart(id, vertsArr) {
  return {
    nodes: [{
      id,
      type: 'part',
      visible: true,
      mesh: { vertices: vertsArr },
      transform: { x:0, y:0, rotation:0, scaleX:1, scaleY:1 },
    }],
  };
}

// 7. Single part fully inside circle.
{
  const proj = projectWithPart('p1', [
    {x:0,y:0},{x:10,y:0},{x:5,y:10},
  ]);
  // Circle at (5,5), r=20 → AABB (0..10,0..10) entirely inside.
  const r = partsInCircle(proj, null, 5, 5, 20);
  assert(r.length === 1 && r[0] === 'p1', `part inside → ['p1'], got ${r}`);
}

// 8. Circle outside AABB but close — should NOT pick.
{
  const proj = projectWithPart('p1', [
    {x:0,y:0},{x:10,y:0},{x:5,y:10},
  ]);
  // Circle at (50,50), r=5 → far from AABB.
  const r = partsInCircle(proj, null, 50, 50, 5);
  assert(r.length === 0, `circle far from AABB → [], got ${r}`);
}

// 9. Circle clips AABB corner — picks.
{
  const proj = projectWithPart('p1', [
    {x:0,y:0},{x:10,y:0},{x:5,y:10},
  ]);
  // Circle at (12, 12), r=3 → distance to AABB corner (10,10) is sqrt(8) ≈ 2.83.
  const r = partsInCircle(proj, null, 12, 12, 3);
  assert(r.length === 1 && r[0] === 'p1', `circle clips corner → picks part, got ${r}`);
}

// 10. Hidden part (visible: false) skipped.
{
  const proj = projectWithPart('p1', [
    {x:0,y:0},{x:10,y:0},{x:5,y:10},
  ]);
  proj.nodes[0].visible = false;
  const r = partsInCircle(proj, null, 5, 5, 20);
  assert(r.length === 0, `hidden part → not picked, got ${r}`);
}

// 11. Multiple parts, some inside circle.
{
  const proj = {
    nodes: [
      { id:'p1', type:'part', visible:true,
        mesh:{vertices:[{x:0,y:0},{x:5,y:0},{x:0,y:5}]},
        transform:{x:0,y:0,rotation:0,scaleX:1,scaleY:1} },
      { id:'p2', type:'part', visible:true,
        mesh:{vertices:[{x:100,y:100},{x:105,y:100},{x:100,y:105}]},
        transform:{x:0,y:0,rotation:0,scaleX:1,scaleY:1} },
    ],
  };
  // Circle at origin, r=10 → only p1.
  const r = partsInCircle(proj, null, 0, 0, 10);
  assert(r.length === 1 && r[0] === 'p1', `1 of 2 parts in circle, got ${r}`);
}

// 12. Empty project → empty.
{
  assert(partsInCircle({nodes:[]}, null, 0, 0, 100).length === 0, 'empty proj → []');
  assert(partsInCircle(null, null, 0, 0, 100).length === 0, 'null proj → []');
}

// 13. Zero / negative radius → empty.
{
  const proj = projectWithPart('p1', [{x:0,y:0},{x:10,y:0},{x:5,y:10}]);
  assert(partsInCircle(proj, null, 0, 0, 0).length === 0, 'r=0 → []');
  assert(partsInCircle(proj, null, 0, 0, -1).length === 0, 'r<0 → []');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
