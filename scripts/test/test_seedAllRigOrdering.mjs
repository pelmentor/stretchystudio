// Regression guard for the post-RULE-№4 seedAllRig peer-call ordering.
//
// History: the original 2026-05-21 contract REQUIRED `persistArtMeshRuntime`
// to run BEFORE `synthesizeModifierStacks` because bone-baked parts (legwear
// etc.) carried NO `rigParent` — their chain leaf was discoverable only via
// `mesh.runtime.parent` (a Cubism-shaped runtime cache). If the stacks were
// synthesised first, that field wasn't populated yet and the part surfaced
// only its Armature modifier — the "legwear has no warp/lattice modifier"
// discoverability gap a user hit on a fresh PSD import + Init Rig.
//
// Post-M3.2 (RULE-№4, 2026-05-23) the synth derives the chain leaf from
// project topology via `findInnermostBodyWarpId` — a pure walk over
// `project.nodes` that does NOT consult `mesh.runtime.parent`. Post-M3.3
// the cache field is RETIRED entirely (no writer, v47 strips on load).
//
// So this test now pins the M3.3 invariant: BOTH orderings produce the
// same chain because the chain derivation is order-independent. The
// `persistArtMeshRuntime` → synth ordering in `seedAllRig` is still
// load-bearing for a DIFFERENT reason: `migrateGroupRotationDeformersToBones`
// (which runs between them) needs `mesh.runtime.keyforms` for its
// canvas-final pivot derivation — see `groupRotationToBone.js` →
// `deriveCanvasPivot` — and that ordering is asserted by
// `test_groupRotationMigrationRealRig.mjs`.
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
// NO rigParent — exactly the shelby/anime-girl shape. Post-M3.3 the harvest
// no longer needs to cache the part's parent because the chain derives from
// topology in synthesizeModifierStacks.
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
// Note: the `parent` field on the rigSpec art mesh is NOT persisted into
// `mesh.runtime` anymore (M3.3); persistArtMeshRuntime drops it. The synth's
// chain derivation comes from `findInnermostBodyWarpId(warpNodes, ...)`,
// which finds `BodyXWarp` by topology (deepest 'BodyName' warp).
const harvestRigSpec = {
  artMeshes: [
    { id: 'legwear', bindings: [], keyforms: [],
      parent: { type: 'warp', id: 'BodyXWarp' } },
  ],
};

function expectChain(legwear, label) {
  assert(Array.isArray(legwear.modifiers), `${label}: legwear has a modifier stack`);
  assertEq(legwear.modifiers[0].type, 'lattice',
    `${label}: stack[0] is the BodyXWarp lattice modifier (VISIBLE to the user)`);
  assertEq(legwear.modifiers[0].objectId, 'BodyXWarp',
    `${label}: stack[0].objectId = BodyXWarp`);
  assertEq(legwear.modifiers[legwear.modifiers.length - 1].type, 'armature',
    `${label}: Armature appended last`);
}

// ── Order A: persist runtime FIRST, then synthesise stacks ──
{
  const project = makeProject();
  persistArtMeshRuntime(project, harvestRigSpec, 'replace');
  synthesizeModifierStacks(project);
  const legwear = project.nodes.find((n) => n.id === 'legwear');
  expectChain(legwear, 'persist-then-synth');
}

// ── Order B: synth FIRST, then persist runtime ──
// Post-M3.2 this produces the same chain as order A because synth derives
// via topology, not from `mesh.runtime.parent`. Post-M3.3 there is no
// `runtime.parent` field at all — the question is moot.
{
  const project = makeProject();
  synthesizeModifierStacks(project);
  persistArtMeshRuntime(project, harvestRigSpec, 'replace');
  const legwear = project.nodes.find((n) => n.id === 'legwear');
  expectChain(legwear, 'synth-then-persist (M3.3 — order-independent)');
}

console.log(`seedAllRigOrdering: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
