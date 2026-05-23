// Tests for the Phase 3 storage flip: per-part modifier stack
// derivation (`synthesizeModifierStacks` in `src/store/deformerNodeSync.js`).
//
// The Blender modifier stack is a per-Object ordered list
// (`Object.modifiers` ↔ `ListBase<ModifierData>` in DNA). SS today
// encodes the equivalent chain implicitly via `part.rigParent` →
// `deformer.parent` → ... up to root. This derivation walks that chain
// and materialises an explicit `part.modifiers[]` stack so future
// readers can iterate without re-walking.
//
// Run: node scripts/test/test_modifierStacks.mjs

import {
  synthesizeModifierStacks,
  synthesizeDeformerParents,
} from '../../src/store/deformerNodeSync.js';
import { getModifiers } from '../../src/store/objectDataAccess.js';
import { CURRENT_SCHEMA_VERSION, migrateProject } from '../../src/store/projectMigrations.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${e}\n  actual:   ${a}`);
}

function makeBodyChainProject() {
  // BodyZ → BodyY → Breath → BodyX → RigWarp_partA chain. Part-A is
  // pointed at the leaf via rigParent. Part-B has no rigParent (no
  // rigWarp coverage).
  return {
    nodes: [
      // Body warp chain: parent links climb from leaf to root.
      { id: 'BodyZWarp',  type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'BodyYWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BodyZWarp' },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyYWarp' },
      { id: 'BodyXWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BreathWarp' },
      // Per-part rigWarp.
      { id: 'RigWarp_partA', type: 'deformer', deformerKind: 'warp', parent: 'BodyXWarp', targetPartId: 'partA' },
      // Parts.
      { id: 'partA', type: 'part', rigParent: 'RigWarp_partA' },
      { id: 'partB', type: 'part' },
      // Non-deformer nodes the walker should ignore.
      { id: 'group-folder', type: 'group' },
      { id: 'partA__data', type: 'meshData', vertices: [] },
    ],
  };
}

// ── Basic chain derivation ──
{
  const project = makeBodyChainProject();
  synthesizeModifierStacks(project);
  const partA = project.nodes.find((n) => n.id === 'partA');
  const partB = project.nodes.find((n) => n.id === 'partB');

  assert(Array.isArray(partA.modifiers), 'partA: modifiers populated');
  assertEq(partA.modifiers.length, 5, 'partA: stack has 5 entries (leaf + 4 ancestors)');
  assertEq(partA.modifiers[0].deformerId, 'RigWarp_partA',
    'partA: stack[0] is leaf (closest to mesh)');
  assertEq(partA.modifiers[1].deformerId, 'BodyXWarp', 'partA: stack[1] is BodyXWarp');
  assertEq(partA.modifiers[2].deformerId, 'BreathWarp', 'partA: stack[2] is BreathWarp');
  assertEq(partA.modifiers[3].deformerId, 'BodyYWarp', 'partA: stack[3] is BodyYWarp');
  assertEq(partA.modifiers[4].deformerId, 'BodyZWarp',
    'partA: stack[4] is BodyZWarp (root)');

  for (const m of partA.modifiers) {
    assertEq(m.type, 'warp', 'partA: every modifier has type=warp');
    assertEq(m.enabled, true, 'partA: every modifier enabled');
  }

  assert(!('modifiers' in partB), 'partB: no modifiers field (no rigParent)');
}

// ── Bone-baked / body-only part: stack derived from mesh.runtime.parent ──
// A part with NO rigParent but a deformer chain cached in
// `mesh.runtime.parent` (e.g. legwear riding the body warp) must honestly
// surface the body-warp Lattice modifiers (+ Armature), not an empty stack.
// Uses the v43 lattice-object shape.
{
  const project = {
    nodes: [
      { id: 'BodyXWarp', type: 'object', objectKind: 'lattice', parent: null,
        dataId: 'BodyXWarp__cage' },
      { id: 'BodyXWarp__cage', type: 'meshData', isLatticeCage: true, vertices: [] },
      { id: 'RigWarp_legwear', type: 'object', objectKind: 'lattice', parent: 'BodyXWarp',
        dataId: 'RigWarp_legwear__cage', targetPartId: 'legwear' },
      { id: 'RigWarp_legwear__cage', type: 'meshData', isLatticeCage: true, vertices: [] },
      { id: 'leftKnee', type: 'group', boneRole: 'leftKnee', parent: null },
      { id: 'legwear', type: 'part',
        // No rigParent — bone-baked; chain leaf cached in runtime.parent.
        mesh: {
          vertices: [], jointBoneId: 'leftKnee', boneWeights: [1],
          runtime: { parent: { type: 'warp', id: 'RigWarp_legwear' }, keyforms: [] },
        } },
    ],
  };
  synthesizeModifierStacks(project);
  const legwear = project.nodes.find((n) => n.id === 'legwear');
  assert(Array.isArray(legwear.modifiers),
    'legwear: modifiers populated from runtime.parent (no rigParent)');
  assertEq(legwear.modifiers[0].type, 'lattice', 'legwear[0] is a lattice modifier');
  assertEq(legwear.modifiers[0].objectId, 'RigWarp_legwear', 'legwear[0] = RigWarp_legwear (leaf)');
  assertEq(legwear.modifiers[1].type, 'lattice', 'legwear[1] is a lattice modifier');
  assertEq(legwear.modifiers[1].objectId, 'BodyXWarp',
    'legwear[1] = BodyXWarp — the body warp is now VISIBLE in the stack');
  assertEq(legwear.modifiers[legwear.modifiers.length - 1].type, 'armature',
    'legwear last entry = Armature (bone skin)');
}

// ── Empty stack drops the field entirely ──
{
  const project = makeBodyChainProject();
  // Pre-populate partB with a stale modifiers list to verify the
  // synthesis clears it.
  const partB = project.nodes.find((n) => n.id === 'partB');
  partB.modifiers = [{ type: 'warp', deformerId: 'stale', enabled: true }];

  synthesizeModifierStacks(project);
  assert(!('modifiers' in partB),
    'empty-derivation drops stale modifiers field');
}

// ── Idempotence ──
{
  const project = makeBodyChainProject();
  synthesizeModifierStacks(project);
  const before = JSON.stringify(project.nodes);
  synthesizeModifierStacks(project);
  const after = JSON.stringify(project.nodes);
  assertEq(after, before, 'idempotent: second pass produces identical state');
}

// ── Cycle defence: a self-referential parent loop terminates ──
{
  const project = {
    nodes: [
      { id: 'A', type: 'deformer', deformerKind: 'warp', parent: 'B' },
      { id: 'B', type: 'deformer', deformerKind: 'warp', parent: 'A' },
      { id: 'p', type: 'part', rigParent: 'A' },
    ],
  };
  synthesizeModifierStacks(project);
  const part = project.nodes.find((n) => n.id === 'p');
  // Walk halts as soon as we revisit any id. Both A and B are reachable
  // before the cycle is detected.
  assertEq(part.modifiers.length, 2, 'cycle: walker terminates after seeing both nodes');
  assertEq(part.modifiers[0].deformerId, 'A', 'cycle: first entry is rigParent (A)');
  assertEq(part.modifiers[1].deformerId, 'B', 'cycle: second entry is parent (B)');
}

// ── Non-deformer parent breaks the chain cleanly ──
{
  const project = {
    nodes: [
      { id: 'group-X', type: 'group' },
      { id: 'WarpY', type: 'deformer', deformerKind: 'warp', parent: 'group-X' },
      { id: 'p', type: 'part', rigParent: 'WarpY' },
    ],
  };
  synthesizeModifierStacks(project);
  const part = project.nodes.find((n) => n.id === 'p');
  assertEq(part.modifiers.length, 1,
    'non-deformer parent: stack stops at the last deformer');
  assertEq(part.modifiers[0].deformerId, 'WarpY', 'stack[0] is the lone deformer');
}

// ── Mixed warp + rotation kinds ──
{
  const project = {
    nodes: [
      { id: 'FaceRotation', type: 'deformer', deformerKind: 'rotation', parent: null },
      { id: 'FaceParallaxWarp', type: 'deformer', deformerKind: 'warp', parent: 'FaceRotation' },
      { id: 'p', type: 'part', rigParent: 'FaceParallaxWarp' },
    ],
  };
  synthesizeModifierStacks(project);
  const part = project.nodes.find((n) => n.id === 'p');
  assertEq(part.modifiers[0].type, 'warp', 'mixed-kind: leaf type=warp');
  assertEq(part.modifiers[1].type, 'rotation', 'mixed-kind: ancestor type=rotation');
}

// ── getModifiers helper reads the synthesized stack ──
{
  const project = makeBodyChainProject();
  synthesizeModifierStacks(project);
  const partA = project.nodes.find((n) => n.id === 'partA');
  const stack = getModifiers(partA);
  assertEq(stack.length, 5, 'getModifiers reads synthesised stack');
  assertEq(stack[0].deformerId, 'RigWarp_partA', 'getModifiers preserves order');
}

// ── v20 migration produces stacks for all eligible parts ──
{
  const project = {
    schemaVersion: 19,
    canvas: { width: 800, height: 600 },
    nodes: makeBodyChainProject().nodes.slice(),
  };
  migrateProject(project);
  assertEq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    'v20: schemaVersion bumped');
  const partA = project.nodes.find((n) => n.id === 'partA');
  assert(Array.isArray(partA.modifiers), 'v20: partA modifiers populated by migration');
  assertEq(partA.modifiers.length, 5, 'v20: partA stack length');
}

// ── Empty project: v20 migration is a no-op (scene node is added by v37) ──
{
  const project = { schemaVersion: 19, canvas: { width: 800, height: 600 }, nodes: [] };
  migrateProject(project);
  // v37 adds the `__scene__` synthetic Object on every project; a v19 project
  // upgraded to current contains exactly that one synthetic. v20 itself adds
  // nothing — modifier stacks only synthesise for parts with rigParent links.
  assertEq(project.nodes.length, 1, 'v19→current: only the v37 __scene__ synthetic appears');
  assertEq(project.nodes[0].id, '__scene__', 'v19→current: the lone node is __scene__');
}

// ── User display flags (enabled / mode / showInEditor) survive rebuild ──
// The stack is re-derived from parent links on every re-rig (seedAllRig),
// but the eye/camera/✓ toggles live ONLY on the modifier records. A blind
// rebuild silently reset them, re-enabling modifiers the user disabled.
{
  const project = makeBodyChainProject();
  synthesizeModifierStacks(project);
  const partA = project.nodes.find((n) => n.id === 'partA');
  assertEq(partA.modifiers[1].deformerId, 'BodyXWarp', 'flags: stack[1] is BodyXWarp');

  // User disables BodyXWarp's viewport display (mode bit) + ✓ on the leaf.
  partA.modifiers[1].mode = 2; // RENDER only — REALTIME (eye) cleared
  partA.modifiers[0].enabled = false; // ✓ off on the leaf RigWarp

  // A re-rig re-derives the stack from parent links.
  synthesizeModifierStacks(project);
  const after = project.nodes.find((n) => n.id === 'partA');
  assertEq(after.modifiers[1].mode, 2,
    'flags: BodyXWarp eye-off (mode) survives rebuild');
  assertEq(after.modifiers[0].enabled, false,
    'flags: RigWarp ✓-off (enabled) survives rebuild');
  // Untouched entries keep their defaults.
  assertEq(after.modifiers[2].enabled, true, 'flags: untouched entry stays enabled');
}

// ── M1 (RULE-№4 modifier-stack flip, 2026-05-23): modifiers[0] is the
// authoring source-of-truth; rigParent is a migration-bootstrap fallback ──
{
  // Authoring writes go to `part.modifiers[0]`. The synth must read the
  // leaf from there even when rigParent points at a DIFFERENT id.
  const project = makeBodyChainProject();
  const partA = project.nodes.find((n) => n.id === 'partA');
  partA.modifiers = [{ type: 'warp', deformerId: 'RigWarp_partA', enabled: true }];
  partA.rigParent = 'BodyXWarp';  // stale / divergent — modifiers[0] must win.
  synthesizeModifierStacks(project);
  assertEq(partA.modifiers.length, 5,
    'M1: modifiers[0] wins over divergent rigParent — full 5-entry stack walked from leaf');
  assertEq(partA.modifiers[0].deformerId, 'RigWarp_partA',
    'M1: leaf preserved from modifiers[0], not rigParent');
}

{
  // Pure modifiers[0]-only authoring: NO rigParent at all. Synth picks up
  // the leaf from modifiers[0] and walks the deformer chain.
  const project = makeBodyChainProject();
  const partA = project.nodes.find((n) => n.id === 'partA');
  partA.rigParent = undefined;
  partA.modifiers = [{
    type: 'warp', deformerId: 'RigWarp_partA',
    enabled: true, mode: 3, showInEditor: true,
  }];
  synthesizeModifierStacks(project);
  assertEq(partA.modifiers.length, 5,
    'M1: modifiers[0] alone (no rigParent) seeds the chain walk');
  assertEq(partA.modifiers[0].deformerId, 'RigWarp_partA',
    'M1: leaf from modifiers[0]');
  assertEq(partA.modifiers[4].deformerId, 'BodyZWarp',
    'M1: chain walks to BodyZWarp root');
}

{
  // Empty modifiers stack must clear stale rigParent via inverse synth —
  // M1 invariant that lets `clearRigWarps` rely on `delete n.modifiers`.
  const project = {
    nodes: [
      { id: 'Stale', type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'p', type: 'part', rigParent: 'Stale' /* stale */ },
    ],
  };
  synthesizeDeformerParents(project);
  const p = project.nodes.find((n) => n.id === 'p');
  assert(p.rigParent === null,
    'M1 inverse: empty/missing modifiers clears stale rigParent mirror');
}

{
  // Armature-only stack (no deformer leaf) also clears stale rigParent.
  const project = {
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm' },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm' },
      { id: 'WarpZombie', type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'p', type: 'part', rigParent: 'WarpZombie' /* stale */,
        modifiers: [
          { type: 'armature', deformerId: 'leftElbow', enabled: true, mode: 3,
            data: { jointBoneId: 'leftElbow', parentBoneId: 'leftArm' } },
        ],
        mesh: { vertices: [{ x: 0, y: 0 }], boneWeights: [1], jointBoneId: 'leftElbow' } },
    ],
  };
  synthesizeDeformerParents(project);
  const p = project.nodes.find((n) => n.id === 'p');
  assert(p.rigParent === null,
    'M1 inverse: armature-only stack clears stale rigParent mirror');
}

console.log(`modifierStacks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
