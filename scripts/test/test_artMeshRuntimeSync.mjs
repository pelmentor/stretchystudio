// `persistArtMeshRuntime` — seedAllRig's persistence pass that mirrors
// `harvest.rigSpec.artMeshes[i]` (bindings + keyforms + parent) into
// `project.nodes[i].mesh.runtime` so post-load `selectRigSpec` produces
// equivalent art-mesh output.
//
// Run: node scripts/test/test_artMeshRuntimeSync.mjs

import { persistArtMeshRuntime } from '../../src/store/artMeshRuntimeSync.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}

// ── Default-mode: writes runtime data to matching parts ─────────────

{
  const project = {
    nodes: [
      { id: 'handwear-l', type: 'part', mesh: { vertices: [{ x: 0, y: 0 }] } },
      { id: 'face',       type: 'part', mesh: { vertices: [{ x: 1, y: 1 }] } },
      { id: 'no-mesh',    type: 'part' },          // no mesh → skipped
      { id: 'BodyXWarp',  type: 'deformer' },     // not a part → skipped
    ],
  };
  const rigSpec = {
    artMeshes: [
      {
        id: 'handwear-l',
        parent: { type: 'rotation', id: 'GroupRotation_leftArm' },
        bindings: [{
          parameterId: 'ParamRotation_leftElbow',
          keys: new Float32Array([-30, 0, 30]),
          interpolation: 'LINEAR',
        }],
        keyforms: [
          { keyTuple: [-30], vertexPositions: new Float32Array([10, 11]), opacity: 1 },
          { keyTuple: [0],   vertexPositions: new Float32Array([12, 13]), opacity: 1 },
          { keyTuple: [30],  vertexPositions: new Float32Array([14, 15]), opacity: 1 },
        ],
      },
      {
        id: 'face',
        parent: { type: 'warp', id: 'RigWarp_face' },
        bindings: [],
        keyforms: [
          { keyTuple: [], vertexPositions: [99, 100], opacity: 0.5, drawOrder: 7 },
        ],
      },
    ],
  };
  persistArtMeshRuntime(project, rigSpec);

  const handwear = project.nodes[0];
  assert(!!handwear.mesh.runtime, 'handwear has runtime');
  assertEq(handwear.mesh.runtime.parent,
    { type: 'rotation', id: 'GroupRotation_leftArm' },
    'handwear runtime.parent');
  assert(Array.isArray(handwear.mesh.runtime.bindings), 'handwear bindings is Array');
  assertEq(handwear.mesh.runtime.bindings[0].parameterId,
    'ParamRotation_leftElbow', 'handwear binding paramId');
  assertEq(handwear.mesh.runtime.bindings[0].keys, [-30, 0, 30],
    'handwear binding.keys coerced from Float32Array');
  assert(Array.isArray(handwear.mesh.runtime.bindings[0].keys),
    'handwear binding.keys is plain Array (not typed)');
  assertEq(handwear.mesh.runtime.keyforms.length, 3, 'handwear has 3 keyforms');
  assertEq(handwear.mesh.runtime.keyforms[0].vertexPositions, [10, 11],
    'handwear keyform[0].positions coerced from Float32Array');
  assert(Array.isArray(handwear.mesh.runtime.keyforms[0].vertexPositions),
    'handwear vertexPositions is plain Array');
  assertEq(handwear.mesh.runtime.keyforms[0].keyTuple, [-30],
    'handwear keyform[0].keyTuple');
  assertEq(handwear.mesh.runtime.keyforms[0].opacity, 1, 'opacity preserved');

  const face = project.nodes[1];
  assertEq(face.mesh.runtime.parent, { type: 'warp', id: 'RigWarp_face' },
    'face runtime.parent');
  assertEq(face.mesh.runtime.keyforms[0].drawOrder, 7,
    'drawOrder preserved when present');
  assertEq(face.mesh.runtime.keyforms[0].opacity, 0.5, 'partial opacity preserved');
  assertEq(face.mesh.runtime.bindings.length, 0, 'face has empty bindings');

  // No-mesh part stays untouched
  assert(project.nodes[2].mesh === undefined, 'no-mesh part untouched');
  // Deformer node stays untouched
  assert(project.nodes[3].mesh === undefined, 'deformer node untouched');
}

// ── Replace mode: parts not in rigSpec have stale runtime cleared ───

{
  const project = {
    nodes: [
      { id: 'A', type: 'part', mesh: { vertices: [{ x: 0, y: 0 }], runtime: {
        bindings: [{ parameterId: 'StaleParam', keys: [0], interpolation: 'LINEAR' }],
        keyforms: [{ keyTuple: [0], vertexPositions: [9, 9], opacity: 1 }],
        parent: { type: 'root', id: null },
      } } },
      { id: 'B', type: 'part', mesh: { vertices: [{ x: 1, y: 1 }] } },
    ],
  };
  const rigSpec = {
    artMeshes: [
      // Only A is in the harvest. B's runtime should be untouched
      // (B has no runtime); A should be replaced with fresh data.
      {
        id: 'A',
        parent: { type: 'warp', id: 'BodyXWarp' },
        bindings: [],
        keyforms: [{ keyTuple: [], vertexPositions: [5, 6], opacity: 1 }],
      },
    ],
  };
  persistArtMeshRuntime(project, rigSpec, 'replace');
  const A = project.nodes[0];
  assertEq(A.mesh.runtime.parent, { type: 'warp', id: 'BodyXWarp' },
    'replace mode: A.runtime overwritten with fresh data');
  assertEq(A.mesh.runtime.keyforms[0].vertexPositions, [5, 6],
    'replace mode: stale positions replaced');
  assertEq(A.mesh.runtime.bindings.length, 0,
    'replace mode: stale bindings replaced with empty array');
  assert(project.nodes[1].mesh.runtime === undefined,
    'replace mode: B has no rigSpec entry → no runtime');
}

// ── Replace clears stale runtime when part is no longer in harvest ──

{
  const project = {
    nodes: [
      { id: 'staleHandwear', type: 'part', mesh: { vertices: [{ x: 0, y: 0 }], runtime: {
        bindings: [{ parameterId: 'P', keys: [0], interpolation: 'LINEAR' }],
        keyforms: [{ keyTuple: [0], vertexPositions: [1, 2], opacity: 1 }],
        parent: { type: 'rotation', id: 'GhostRotation' },
      } } },
    ],
  };
  // rigSpec doesn't include staleHandwear → its runtime should be cleared
  persistArtMeshRuntime(project, { artMeshes: [] }, 'replace');
  assert(project.nodes[0].mesh.runtime === undefined,
    'replace mode: stale runtime cleared when part dropped from rigSpec');
}

// ── Idempotence ────────────────────────────────────────────────────

{
  const project = {
    nodes: [
      { id: 'A', type: 'part', mesh: { vertices: [{ x: 0, y: 0 }] } },
    ],
  };
  const rigSpec = {
    artMeshes: [{
      id: 'A',
      parent: { type: 'root', id: null },
      bindings: [],
      keyforms: [{ keyTuple: [], vertexPositions: [3, 3], opacity: 1 }],
    }],
  };
  persistArtMeshRuntime(project, rigSpec);
  const snap1 = JSON.stringify(project.nodes[0].mesh.runtime);
  persistArtMeshRuntime(project, rigSpec);
  const snap2 = JSON.stringify(project.nodes[0].mesh.runtime);
  assert(snap1 === snap2, 'persistArtMeshRuntime is idempotent');
}

// ── Defensive — null / empty / no-nodes inputs ─────────────────────

{
  // Nullish project — no throw
  persistArtMeshRuntime(null, { artMeshes: [] });
  persistArtMeshRuntime(undefined, { artMeshes: [] });
  // Project without nodes — no throw
  persistArtMeshRuntime({}, { artMeshes: [] });
  // No rigSpec — no throw, nothing changes
  const project = { nodes: [{ id: 'A', type: 'part', mesh: { vertices: [] } }] };
  persistArtMeshRuntime(project, null);
  persistArtMeshRuntime(project, undefined);
  persistArtMeshRuntime(project, {});
  passed += 6;
}

// ── JSON-friendly: post-write project must survive round-trip ──────

{
  const project = {
    nodes: [{ id: 'A', type: 'part', mesh: { vertices: [{ x: 0, y: 0 }] } }],
  };
  const rigSpec = {
    artMeshes: [{
      id: 'A',
      parent: { type: 'rotation', id: 'X' },
      bindings: [{ parameterId: 'P', keys: new Float32Array([1, 2]), interpolation: 'LINEAR' }],
      keyforms: [{ keyTuple: new Float32Array([1]), vertexPositions: new Float32Array([3, 4]), opacity: 1 }],
    }],
  };
  persistArtMeshRuntime(project, rigSpec);
  const json = JSON.stringify(project);
  const reloaded = JSON.parse(json);
  const r = reloaded.nodes[0].mesh.runtime;
  assertEq(r.parent, { type: 'rotation', id: 'X' }, 'JSON round-trip parent');
  assertEq(r.bindings[0].keys, [1, 2], 'JSON round-trip binding.keys');
  assertEq(r.keyforms[0].keyTuple, [1], 'JSON round-trip keyTuple');
  assertEq(r.keyforms[0].vertexPositions, [3, 4],
    'JSON round-trip vertexPositions (Float32Array → plain Array survived)');
}

console.log(`artMeshRuntimeSync: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
