// Toolset Plan Phase 6.A — Select Linked expand selection.
//
// Verifies `selectLinkedExpandSelection(mesh, currentSel)`:
//   - Expands each seed to its connected component.
//   - Multiple seeds in different components: all components light up.
//   - Seed already at a component's full set: idempotent.
//   - Empty seed: empty result.
//   - Out-of-bounds / non-numeric seeds: skipped.
//
// Run: node scripts/test/test_selectLinked_fromSelection.mjs

import { selectLinkedExpandSelection } from '../../src/v3/operators/select/linked.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

// 1. Single-tri mesh, seed = {0} → expands to {0,1,2}.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10}],
    triangles: [[0,1,2]],
  };
  const r = selectLinkedExpandSelection(mesh, [0]);
  assert(r instanceof Set, 'returns Set');
  assert(r.size === 3 && r.has(0) && r.has(1) && r.has(2),
    `seed {0} → expanded {0,1,2}, got ${[...r]}`);
}

// 2. Two disconnected triangles, seed = one vert from each → both
//    components fully light up.
{
  const mesh = {
    vertices: [
      {x:0,y:0},{x:10,y:0},{x:5,y:10},
      {x:100,y:0},{x:110,y:0},{x:105,y:10},
    ],
    triangles: [[0,1,2],[3,4,5]],
  };
  const r = selectLinkedExpandSelection(mesh, [0, 4]);
  assert(r.size === 6,
    `seeds {0,4} → both components, got ${[...r]}`);
  for (const i of [0,1,2,3,4,5]) {
    assert(r.has(i), `expanded includes vert ${i}`);
  }
}

// 3. Two disconnected triangles, seed = only one vert → just that
//    component (NOT the other).
{
  const mesh = {
    vertices: [
      {x:0,y:0},{x:10,y:0},{x:5,y:10},
      {x:100,y:0},{x:110,y:0},{x:105,y:10},
    ],
    triangles: [[0,1,2],[3,4,5]],
  };
  const r = selectLinkedExpandSelection(mesh, [0]);
  assert(r.size === 3, `seed {0} → only tri A, got ${[...r]}`);
  assert(!r.has(3) && !r.has(4) && !r.has(5),
    `seed {0} → tri B excluded, got ${[...r]}`);
}

// 4. Idempotent: seed = full component → result = same component.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10}],
    triangles: [[0,1,2]],
  };
  const r = selectLinkedExpandSelection(mesh, new Set([0,1,2]));
  assert(r.size === 3, `idempotent (got ${[...r]})`);
}

// 5. Empty seed → empty result.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10}],
    triangles: [[0,1,2]],
  };
  const r = selectLinkedExpandSelection(mesh, []);
  assert(r instanceof Set && r.size === 0, `empty seed → empty, got ${[...r]}`);
}

// 6. Mesh with no verts → null.
{
  const mesh = { vertices: [], triangles: [] };
  assert(selectLinkedExpandSelection(mesh, [0]) === null,
    'empty mesh → null');
}

// 7. Out-of-bounds and non-numeric seeds: silently skipped.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10}],
    triangles: [[0,1,2]],
  };
  const r = selectLinkedExpandSelection(mesh, [-1, 100, 'x', null, 0]);
  assert(r.size === 3, `bad seeds skipped, vert 0 expanded, got ${[...r]}`);
}

// 8. Orphan vert (no triangles incident): seed = orphan → singleton.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10},{x:50,y:50}],
    triangles: [[0,1,2]],
  };
  const r = selectLinkedExpandSelection(mesh, [3]);
  assert(r.size === 1 && r.has(3),
    `orphan seed → singleton {3}, got ${[...r]}`);
}

// 9. Mixed seeds: orphan + connected — both contribute.
{
  const mesh = {
    vertices: [{x:0,y:0},{x:10,y:0},{x:5,y:10},{x:50,y:50}],
    triangles: [[0,1,2]],
  };
  const r = selectLinkedExpandSelection(mesh, [1, 3]);
  assert(r.size === 4, `mixed seeds → tri-A + orphan = 4 (got ${[...r]})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
