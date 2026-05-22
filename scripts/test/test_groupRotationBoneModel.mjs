// Slices B + C of the RotationDeformer → armature-bone refactor (RULE №4).
//   B: isGroupRotationBoneNode seam predicate (warpLatticeAccess).
//   C: synthesizeGroupRotationDeformers — bone → transient rotation deformer,
//      byte-identical to what the legacy seeder persisted (so the eval
//      characterization oracle stays green across the storage flip).
//
// Run: node scripts/test/test_groupRotationBoneModel.mjs

import { isGroupRotationBoneNode } from '../../src/store/warpLatticeAccess.js';
import { synthesizeGroupRotationDeformers } from '../../src/io/live2d/rig/synthesizeGroupRotationDeformers.js';
import { buildGroupRotationSpec } from '../../src/io/live2d/rig/rotationDeformers.js';
import { rotationSpecToDeformerNode } from '../../src/store/deformerNodeSync.js';

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
}

// ── B: isGroupRotationBoneNode ──
{
  assert(isGroupRotationBoneNode({ type: 'group', boneRole: 'groupRotation_grp' }), 'B: group + groupRotation_ role → true');
  assert(!isGroupRotationBoneNode({ type: 'group', boneRole: 'leftElbow' }), 'B: regular bone → false');
  assert(!isGroupRotationBoneNode({ type: 'group' }), 'B: group, no boneRole → false');
  assert(!isGroupRotationBoneNode({ type: 'deformer', deformerKind: 'rotation', id: 'GroupRotation_grp' }), 'B: legacy rotation deformer → false');
  assert(!isGroupRotationBoneNode(null), 'B: null → false');
}

// ── C: synth reproduces the legacy deformer node byte-for-byte ──
{
  const project = {
    nodes: [
      { id: 'grp', type: 'group', boneRole: 'groupRotation_grp', name: 'grp',
        parent: null, transform: { pivotX: 400, pivotY: 300 } },
    ],
  };
  const synth = synthesizeGroupRotationDeformers(project);
  assert(synth.length === 1, 'C: one deformer synthesised from one bone');
  const node = synth[0];

  // The expected node = exactly what the legacy seeder built+converted.
  const { spec } = buildGroupRotationSpec({
    id: 'GroupRotation_grp', name: 'GroupRotation_grp', paramId: 'ParamRotation_grp',
    pivotCanvas: { x: 400, y: 300 }, paramKeys: [-30, 0, 30], angles: [-30, 0, 30],
  });
  const expected = rotationSpecToDeformerNode(spec);
  expected.parent = null; // root parent (no warp ancestor)

  assertEq(node, expected, 'C: synth node === rotationSpecToDeformerNode(buildGroupRotationSpec(...))');
  assertEq(node.id, 'GroupRotation_grp', 'C: deformer id');
  assertEq(node.deformerKind, 'rotation', 'C: deformerKind rotation');
  assertEq(node.bindings[0].parameterId, 'ParamRotation_grp', 'C: param binding');
  assertEq(node.keyforms.map((k) => k.originX), [400, 400, 400], 'C: pivot.x baked into every keyform originX');
}

// ── C: parent resolves to the innermost warp ancestor ──
{
  const project = {
    nodes: [
      { id: 'BodyXWarp', type: 'object', objectKind: 'lattice', parent: null, dataId: 'BodyXWarp__cage' },
      { id: 'grp', type: 'group', boneRole: 'groupRotation_grp', name: 'grp',
        parent: 'BodyXWarp', transform: { pivotX: 100, pivotY: 200 } },
    ],
  };
  const synth = synthesizeGroupRotationDeformers(project);
  assertEq(synth[0].parent, 'BodyXWarp', 'C: rotation parent walks up to the warp ancestor');
}

// ── C: no bones → no synth ──
{
  const project = { nodes: [{ id: 'leftElbow', type: 'group', boneRole: 'leftElbow' }] };
  assertEq(synthesizeGroupRotationDeformers(project).length, 0, 'C: non-groupRotation bones produce nothing');
}

console.log(`groupRotationBoneModel: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
