// Regression guard for the fresh-Init-Rig ordering bug (2026-05-21).
//
// `projectStore.seedAllRig` must run `persistArtMeshRuntime` BEFORE
// `synthesizeModifierStacks`. Bone-baked parts (legwear etc.) carry no
// `rigParent`; their deformer chain is only discoverable via
// `mesh.runtime.parent`, which `persistArtMeshRuntime` writes from the
// harvest. If the stacks are synthesised first, that field doesn't exist
// yet and the part surfaces only its Armature modifier — the "legwear has
// no warp/lattice modifier" discoverability gap the user hit on a fresh
// PSD import + Init Rig.
//
// This test replicates the seedAllRig peer-call sequence with the real
// functions (no zustand store) and pins both the correct order (chain
// visible) and the buggy order (chain hidden) so a future reorder fails.
//
// Run: node scripts/test/test_seedAllRigOrdering.mjs

import { synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';
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

// A bone-baked legwear part rides BodyXWarp (a v43 lattice object) but has
// NO rigParent — exactly the shelby/anime-girl shape. The harvest reports
// its parent so persistArtMeshRuntime can cache it on mesh.runtime.parent.
function makeProject() {
  return {
    nodes: [
      { id: 'BodyXWarp', type: 'object', objectKind: 'lattice', parent: null,
        dataId: 'BodyXWarp__cage' },
      { id: 'BodyXWarp__cage', type: 'meshData', isLatticeCage: true, vertices: [] },
      { id: 'leftKnee', type: 'group', boneRole: 'leftKnee', parent: null },
      { id: 'legwear', type: 'part',
        mesh: { vertices: [], jointBoneId: 'leftKnee', boneWeights: [1] } },
    ],
  };
}

// The harvest's rigSpec — legwear's art mesh declares BodyXWarp as parent.
const harvestRigSpec = {
  artMeshes: [
    { id: 'legwear', bindings: [], keyforms: [],
      parent: { type: 'warp', id: 'BodyXWarp' } },
  ],
};

// ── Correct order: persist runtime FIRST, then synthesise stacks ──
{
  const project = makeProject();
  persistArtMeshRuntime(project, harvestRigSpec, 'replace');
  synthesizeModifierStacks(project);
  const legwear = project.nodes.find((n) => n.id === 'legwear');

  assert(Array.isArray(legwear.modifiers), 'correct-order: legwear has a modifier stack');
  assertEq(legwear.modifiers[0].type, 'lattice',
    'correct-order: stack[0] is the BodyXWarp lattice modifier (VISIBLE to the user)');
  assertEq(legwear.modifiers[0].objectId, 'BodyXWarp',
    'correct-order: stack[0].objectId = BodyXWarp');
  assertEq(legwear.modifiers[legwear.modifiers.length - 1].type, 'armature',
    'correct-order: Armature appended last');
}

// ── Buggy order (regression pin): synthesise BEFORE persisting runtime ──
// Documents WHY the order matters: with no runtime.parent yet, the
// bone-baked fallback finds nothing and only the Armature shows. If a
// future edit makes this order produce the lattice modifier too, great —
// but today it must not, proving persist-first is load-bearing.
{
  const project = makeProject();
  synthesizeModifierStacks(project); // runtime.parent not written yet
  const legwear = project.nodes.find((n) => n.id === 'legwear');
  assertEq(legwear.modifiers.length, 1,
    'buggy-order: only the Armature modifier (the bug the reorder fixes)');
  assertEq(legwear.modifiers[0].type, 'armature',
    'buggy-order: lone entry is Armature — body warp hidden');
}

console.log(`seedAllRigOrdering: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
