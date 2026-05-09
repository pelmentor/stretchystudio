// Regression test for the broken-moc3 export bug observed 2026-05-09:
// `seedDefaultRigidWeights` writes all-1.0 boneWeights + jointBoneId
// onto every meshed part with a bone ancestor. The cmo3 path strips
// these via `extractMeshExportStruct` at the mesh-struct construction
// boundary in `exporter.js`. The moc3 path (`meshBindingPlan.js`) used
// to read `mesh.boneWeights` raw, falling into the bone-baked branch
// for rigid-intent parts and emitting 5 keyforms on
// `ParamRotation_<bone>` — even when the param didn't exist in
// `project.parameters`. `keyformBindings.js` then dropped the orphan
// binding silently leaving 5 unbound art-mesh keyforms in band 0,
// which Cubism Viewer rejects.
//
// Fix: pass `project` to `buildMeshBindingPlan` so it can route the
// per-mesh boneWeights/jointBoneId read through the same Cubism
// Adapter strip cmo3 uses. Rigid-intent parts then fall through to
// the default 1-keyform/ParamOpacity branch — matching cmo3.
//
// Run: node scripts/test/test_meshBindingPlan_rigidStrip.mjs

import { buildMeshBindingPlan } from '../../src/io/live2d/moc3/meshBindingPlan.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── Test 1: rigid-intent part falls through to default 1-keyform ──

{
  // Fixture: face mesh under torso bone with all-1.0 weights to torso.
  // Pre-fix: emitted 5 keyforms on ParamRotation_torso (bone-baked branch).
  // Post-fix: strips, falls through to default 1 keyform on ParamOpacity.
  const project = {
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso', name: 'torso', parent: null,
        transform: { pivotX: 0, pivotY: 0 } },
      { id: 'face', type: 'part', name: 'face', parent: 'torso',
        mesh: {
          vertices: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
          boneWeights: [1, 1],
          jointBoneId: 'torso',
        },
        opacity: 1,
      },
    ],
  };
  const meshParts = [{
    ...project.nodes[1],
    mesh: project.nodes[1].mesh,
  }];
  const groups = [project.nodes[0]];
  const { meshBindingPlan, totalArtMeshKeyforms, meshKeyformCount } = buildMeshBindingPlan({
    meshParts, groups, rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90],
    backdropTagsSet: new Set(),
    project,
  });

  assert(meshBindingPlan.length === 1, 'Test 1: 1 plan entry');
  const plan = meshBindingPlan[0];
  assert(plan.paramId === 'ParamOpacity',
    `Test 1: rigid-intent stripped → ParamOpacity (got ${plan.paramId})`);
  assert(plan.keys.length === 1 && plan.keys[0] === 1,
    `Test 1: 1 key at value 1.0 (got ${JSON.stringify(plan.keys)})`);
  assert(meshKeyformCount[0] === 1,
    `Test 1: meshKeyformCount[0] = 1 (got ${meshKeyformCount[0]})`);
  assert(totalArtMeshKeyforms === 1,
    `Test 1: totalArtMeshKeyforms = 1 (got ${totalArtMeshKeyforms})`);
  assert(plan.perVertexPositions === null,
    'Test 1: rigid-intent plan has no perVertexPositions');
}

// ── Test 2: bone-routing-intent (jointBoneId differs from structural parent) ──

{
  // Hand-only sub-mesh: child of leftArm structurally, but
  // jointBoneId='leftElbow' (auto-rig routes weights to elbow). Adapter
  // MUST PRESERVE — this is the Audit Issue 8 case from the Cubism
  // Adapter plan. moc3 should still emit 5 keyforms here.
  const project = {
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', name: 'leftArm', parent: null,
        transform: { pivotX: 0, pivotY: 0 } },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow', parent: 'leftArm',
        transform: { pivotX: 100, pivotY: 0 } },
      { id: 'handMesh', type: 'part', name: 'handMesh', parent: 'leftArm',
        mesh: {
          vertices: [{ x: 110, y: 0 }, { x: 120, y: 0 }],
          boneWeights: [1, 1],     // saturated by computeSkinWeights past elbow blend zone
          jointBoneId: 'leftElbow', // differs from structural parent 'leftArm'
        },
        opacity: 1,
      },
    ],
  };
  const meshParts = [{ ...project.nodes[2], mesh: project.nodes[2].mesh }];
  const groups = [project.nodes[0], project.nodes[1]];
  const { meshBindingPlan, meshKeyformCount } = buildMeshBindingPlan({
    meshParts, groups, rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90],
    backdropTagsSet: new Set(),
    project,
  });

  const plan = meshBindingPlan[0];
  assert(plan.paramId === 'ParamRotation_leftElbow',
    `Test 2: bone-routing preserved → ParamRotation_leftElbow (got ${plan.paramId})`);
  assert(plan.keys.length === 5,
    `Test 2: 5 baked keyform angles (got ${plan.keys.length})`);
  assert(meshKeyformCount[0] === 5,
    `Test 2: meshKeyformCount[0] = 5 (got ${meshKeyformCount[0]})`);
  assert(plan.perVertexPositions !== null
    && plan.perVertexPositions.length === 5,
    'Test 2: perVertexPositions populated for true bone-baked');
}

// ── Test 3: backwards-compat — without `project`, raw mesh fields read ──

{
  // When `project` is omitted (test/legacy callers), the helper reads
  // mesh.boneWeights/jointBoneId raw — preserving the pre-fix code path
  // for callers that don't carry a project handle.
  const project = {
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', name: 'leftArm', parent: null,
        transform: { pivotX: 0, pivotY: 0 } },
      { id: 'shirt', type: 'part', name: 'shirt', parent: 'leftArm',
        mesh: {
          vertices: [{ x: 50, y: 50 }],
          boneWeights: [1],
          jointBoneId: 'leftArm',
        },
        opacity: 1,
      },
    ],
  };
  const meshParts = [{ ...project.nodes[1], mesh: project.nodes[1].mesh }];
  const groups = [project.nodes[0]];
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts, groups, rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90],
    backdropTagsSet: new Set(),
    // NO project field — test the fallback raw-read.
  });
  const plan = meshBindingPlan[0];
  assert(plan.paramId === 'ParamRotation_leftArm',
    `Test 3: no-project fallback → raw bone-baked (got ${plan.paramId})`);
  assert(plan.keys.length === 5,
    `Test 3: 5 keyforms in fallback (got ${plan.keys.length})`);
}

// ── Test 4: non-skinned part stays at 1-keyform default ─────────────

{
  // No boneWeights at all. Should hit default branch regardless of
  // project field presence.
  const project = {
    nodes: [
      { id: 'static', type: 'part', name: 'static', parent: null,
        mesh: { vertices: [{ x: 0, y: 0 }] },
        opacity: 1,
      },
    ],
  };
  const meshParts = [{ ...project.nodes[0], mesh: project.nodes[0].mesh }];
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts, groups: [], rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90],
    backdropTagsSet: new Set(),
    project,
  });
  const plan = meshBindingPlan[0];
  assert(plan.paramId === 'ParamOpacity',
    `Test 4: no boneWeights → ParamOpacity (got ${plan.paramId})`);
  assert(plan.keys.length === 1,
    `Test 4: 1 default keyform (got ${plan.keys.length})`);
}

console.log(`\nmeshBindingPlan rigid-strip: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
