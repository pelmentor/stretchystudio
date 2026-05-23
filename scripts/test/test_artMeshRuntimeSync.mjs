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
//
// Fixture choice: `neck` exercises the live `ParamAngleX[-30, 0, 30]`
// 3-keyform shape that `meshLayerKeyform.js` (`hasNeckCornerShapekeys`
// branch) produces for cornering-tagged neck meshes — proves the
// 3-keyform + Float32Array → plain-Array copy path. `face` exercises
// the 1-keyform-on-empty-binding default + opacity + drawOrder.
//
// Both shapes are real outputs of the live emitter as of 2026-05-23.
// The fixture previously used a `handwear-l` part with a
// `ParamRotation_<bone>` 3-keyform shape — that shape was retired by
// RULE №4 Slice 1 (the bone-baked art-mesh adapter, commit 2fe8750):
// post-Slice-1 the emitter pushes a single `ParamOpacity[1.0]` rest
// keyform for bone-baked parts and bone LBS owns the deformation.
// Audit-fixed here so the fixture documents a live contract.

{
  const project = {
    nodes: [
      { id: 'neck',       type: 'part', mesh: { vertices: [{ x: 0, y: 0 }] } },
      { id: 'face',       type: 'part', mesh: { vertices: [{ x: 1, y: 1 }] } },
      { id: 'no-mesh',    type: 'part' },          // no mesh → skipped
      { id: 'BodyXWarp',  type: 'deformer' },     // not a part → skipped
    ],
  };
  const rigSpec = {
    artMeshes: [
      {
        id: 'neck',
        parent: { type: 'rotation', id: 'GroupRotation_neck' },
        bindings: [{
          parameterId: 'ParamAngleX',
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

  const neck = project.nodes[0];
  assert(!!neck.mesh.runtime, 'neck has runtime');
  // RULE №4 Slice M3.3: persistArtMeshRuntime no longer writes
  // `runtime.parent`. The Cubism-shaped leaf cache was retired; the
  // chain leaf is derived from project topology by
  // `synthesizeModifierStacks` (via `findInnermostBodyWarpId`) and from
  // `part.modifiers[0]` by `selectRigSpec`. v47 migration strips the
  // field from any persisted save on load.
  assert(!('parent' in neck.mesh.runtime),
    'M3.3 — neck runtime has no `parent` field');
  assert(Array.isArray(neck.mesh.runtime.bindings), 'neck bindings is Array');
  assertEq(neck.mesh.runtime.bindings[0].parameterId,
    'ParamAngleX', 'neck binding paramId');
  assertEq(neck.mesh.runtime.bindings[0].keys, [-30, 0, 30],
    'neck binding.keys coerced from Float32Array');
  assert(Array.isArray(neck.mesh.runtime.bindings[0].keys),
    'neck binding.keys is plain Array (not typed)');
  assertEq(neck.mesh.runtime.keyforms.length, 3, 'neck has 3 keyforms');
  assertEq(neck.mesh.runtime.keyforms[0].vertexPositions, [10, 11],
    'neck keyform[0].positions coerced from Float32Array');
  assert(Array.isArray(neck.mesh.runtime.keyforms[0].vertexPositions),
    'neck vertexPositions is plain Array');
  assertEq(neck.mesh.runtime.keyforms[0].keyTuple, [-30],
    'neck keyform[0].keyTuple');
  assertEq(neck.mesh.runtime.keyforms[0].opacity, 1, 'opacity preserved');

  const face = project.nodes[1];
  assert(!('parent' in face.mesh.runtime),
    'M3.3 — face runtime has no `parent` field');
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
  // M3.3 — replace overwrites with fresh data that omits `parent`,
  // even though the stale entry had one.
  assert(!('parent' in A.mesh.runtime),
    'replace mode: M3.3 — replaced runtime has no `parent` field even when prior shape had one');
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
  assert(!('parent' in r),
    'JSON round-trip — M3.3: persisted runtime has no `parent` field');
  assertEq(r.bindings[0].keys, [1, 2], 'JSON round-trip binding.keys');
  assertEq(r.keyforms[0].keyTuple, [1], 'JSON round-trip keyTuple');
  assertEq(r.keyforms[0].vertexPositions, [3, 4],
    'JSON round-trip vertexPositions (Float32Array → plain Array survived)');
}

console.log(`artMeshRuntimeSync: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
