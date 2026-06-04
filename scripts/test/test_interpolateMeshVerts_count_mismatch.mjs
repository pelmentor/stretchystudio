// 2026-06-04 — `interpolateMeshVerts` must throw on vertex-count mismatch
// instead of silently returning half-interpolated geometry (PARENT-D from
// audit Workflow `wf_2feab013-def`).
//
// Pre-fix the inner map() returned `{x: vA.x, y: vA.y}` for every index
// where `kB.value[i]` was undefined. At any t > 0 this produced visibly
// wrong geometry — some verts interpolated, the trailing surplus stayed
// pinned to A. Silent because no log, no exception, no UI cue. The
// docstring already mandated same-count.
//
// Post-fix: a typed Error fires (`[animationEngine] mesh-verts ...
// keyform vertex-count mismatch ...`) pointing at the offending segment.
// Caller is the animation tick — the editor lifecycle converts uncaught
// errors into a paused-playback state, so the user sees the failure
// immediately instead of broken geometry.
//
// Run: node scripts/test/test_interpolateMeshVerts_count_mismatch.mjs

// The function is not exported; we exercise it through computePoseOverrides
// since `mesh_verts` properties route via `interpolateMeshVerts`.
import { computePoseOverrides } from '../../src/renderer/animationEngine.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function makeMeshVertsAction(kfA, kfB) {
  // mesh_verts target shape: rnaPath that decodes to {kind:'node',
  // nodeId:'p1', property:'mesh_verts'}. `decodeFCurveTarget` parses
  // `objects["p1"].mesh_verts` (the canonical SS RNA-path format).
  return {
    id: 'a1', name: 'test',
    fcurves: [
      {
        rnaPath: 'objects["p1"].mesh_verts',
        keyforms: [
          { time: 0,    value: kfA, interpolation: 'LINEAR',
            handleLeft: { x: -1, y: 0 }, handleRight: { x: 1, y: 0 } },
          { time: 1000, value: kfB, interpolation: 'LINEAR',
            handleLeft: { x: 999, y: 0 }, handleRight: { x: 1001, y: 0 } },
        ],
      },
    ],
  };
}

// 1 — Same-count keyforms still interpolate correctly (regression check).
{
  const kfA = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const kfB = [{ x: 0, y: 10 }, { x: 10, y: 10 }];
  const action = makeMeshVertsAction(kfA, kfB);
  const overrides = computePoseOverrides(action, 500);
  const p1 = overrides.get('p1');
  assert(p1 != null, 'same-count: p1 override exists');
  assert(Array.isArray(p1.mesh_verts) && p1.mesh_verts.length === 2,
    `same-count: mesh_verts array length 2 (got ${p1.mesh_verts?.length})`);
  // At t=0.5 (LINEAR), verts should lerp 50% between A and B.
  assert(approx(p1.mesh_verts[0].x, 0),  'same-count: vert0.x = 0');
  assert(approx(p1.mesh_verts[0].y, 5),  'same-count: vert0.y = 5');
  assert(approx(p1.mesh_verts[1].x, 10), 'same-count: vert1.x = 10');
  assert(approx(p1.mesh_verts[1].y, 5),  'same-count: vert1.y = 5');
}

// 2 — Mismatched vert count → throws with descriptive message.
{
  const kfA = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]; // 3 verts
  const kfB = [{ x: 0, y: 10 }, { x: 10, y: 10 }];                 // 2 verts
  const action = makeMeshVertsAction(kfA, kfB);
  let threw = false;
  let errMsg = '';
  try {
    computePoseOverrides(action, 500);
  } catch (err) {
    threw = true;
    errMsg = err?.message ?? String(err);
  }
  assert(threw, 'mismatch: throws instead of silently half-interpolating');
  assert(errMsg.includes('vertex-count mismatch'),
    `mismatch: error message mentions "vertex-count mismatch" (got "${errMsg}")`);
  assert(errMsg.includes('Re-Init Rig'),
    'mismatch: error message points user at the fix (Re-Init Rig)');
  assert(errMsg.includes('3 verts') && errMsg.includes('2 verts'),
    'mismatch: error inlines the two divergent counts');
}

// 3 — Boundary cases: timeMs at keyframe edges return the verbatim
//     keyframe value without invoking the assertion (no throw).
{
  const kfA = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  const kfB = [{ x: 0, y: 10 }, { x: 10, y: 10 }];
  const action = makeMeshVertsAction(kfA, kfB);
  // At t=0 — verbatim kfA (early-return before the binary search).
  const atA = computePoseOverrides(action, 0);
  assert(atA.get('p1')?.mesh_verts?.length === 3,
    'boundary t=0: kfA returned verbatim (3 verts, no mismatch check)');
  // At t=1000 — verbatim last keyframe value (kfB).
  const atB = computePoseOverrides(action, 1000);
  assert(atB.get('p1')?.mesh_verts?.length === 2,
    'boundary t=last: kfB returned verbatim (2 verts, no mismatch check)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
