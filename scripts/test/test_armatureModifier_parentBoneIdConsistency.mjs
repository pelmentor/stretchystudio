// Audit Issue 9 (CUBISM_ADAPTER_PATTERN.md §11) regression — both
// `synthesizeModifierStacks` (init-rig path) and `bindArmatureModifier`
// (one-click rebind path) compute `armatureModifier.data.parentBoneId`
// independently. They must agree, or future drift will cause a byte-
// diff between freshly-rigged and rebound projects.
//
// Both paths are supposed to walk the part's `node.parent` chain to the
// nearest `isBoneGroup` ancestor of the JOINT BONE itself (i.e., one
// step deeper than the part's structural parent walk). This test pins
// the agreement on a multi-bone fixture.
//
// Run: node scripts/test/test_armatureModifier_parentBoneIdConsistency.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';
import { bindArmatureModifier } from '../../src/services/ArmatureModifierService.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function findArmatureModifier(part) {
  if (!Array.isArray(part?.modifiers)) return null;
  return part.modifiers.find((m) => m?.type === 'armature') ?? null;
}

// ── Test 1: simple 2-bone chain (torso → leftArm) ──────────────────────

{
  // Set up a project where handwear is bone-weighted to leftElbow (the
  // joint), with leftArm as the structural parent of the part. The
  // synth path AND the bind path should both produce parentBoneId=
  // leftArm (joint bone's nearest bone ancestor).
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 31,
      canvas: { width: 1280, height: 1280 },
      textures: [],
      nodes: [
        {
          id: 'torso', type: 'group', boneRole: 'torso', name: 'torso',
          parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 640, pivotY: 800 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'leftArm', type: 'group', boneRole: 'leftArm', name: 'leftArm',
          parent: 'torso',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 600 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow',
          parent: 'leftArm',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 500 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'handwear-l', type: 'part', name: 'handwear-l', parent: 'leftArm',
          mesh: {
            vertices: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }],
            triangles: [],
            boneWeights: [0.0, 0.5, 1.0],   // per-vertex skinning (limb)
            jointBoneId: 'leftElbow',
          },
        },
      ],
      versionControl: { geometryVersion: 0 },
    },
  });

  // Path A: synth (the way Init Rig populates).
  const projA = useProjectStore.getState().project;
  // Use updateProject so synth runs in-place + we can read back.
  useProjectStore.setState({
    project: structuredClone(projA),
  });
  useProjectStore.getState().updateProject((p) => {
    synthesizeModifierStacks(p);
  });
  const synthArmature = findArmatureModifier(
    useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l'),
  );
  assert(!!synthArmature, 'Test 1: synth produced an Armature modifier');
  const synthParentBoneId = synthArmature?.data?.parentBoneId ?? null;

  // Path B: bind (the way "Add Modifier → Armature" populates).
  // Reset to no-modifier state first.
  useProjectStore.getState().updateProject((p) => {
    const part = p.nodes.find((n) => n.id === 'handwear-l');
    delete part.modifiers;
  });
  bindArmatureModifier('handwear-l');
  const bindArmature = findArmatureModifier(
    useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l'),
  );
  assert(!!bindArmature, 'Test 1: bind produced an Armature modifier');
  const bindParentBoneId = bindArmature?.data?.parentBoneId ?? null;

  // BOTH paths should produce the same parentBoneId. The joint bone is
  // 'leftElbow'; its nearest bone ancestor (walking node.parent) is
  // 'leftArm'.
  assert(synthParentBoneId === bindParentBoneId,
    `Test 1: synth.parentBoneId === bind.parentBoneId (synth=${synthParentBoneId}, bind=${bindParentBoneId})`);
  assert(synthParentBoneId === 'leftArm',
    `Test 1: synth.parentBoneId === 'leftArm' (got ${synthParentBoneId})`);
}

// ── Test 2: joint bone is a root bone (no bone ancestor) ──────────────

{
  // When the joint bone has no bone-group ancestor, both paths must
  // produce parentBoneId=null (not undefined, not '', not the canvas
  // root).
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 31,
      canvas: { width: 1280, height: 1280 },
      textures: [],
      nodes: [
        {
          id: 'torso', type: 'group', boneRole: 'torso', name: 'torso',
          parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 640, pivotY: 800 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'topwear', type: 'part', name: 'topwear', parent: 'torso',
          mesh: {
            vertices: [{ x: 100, y: 0 }, { x: 200, y: 0 }],
            triangles: [],
            boneWeights: [1.0, 1.0],
            jointBoneId: 'torso',  // joint IS the root bone
          },
        },
      ],
      versionControl: { geometryVersion: 0 },
    },
  });

  // Path A: synth.
  useProjectStore.getState().updateProject((p) => {
    synthesizeModifierStacks(p);
  });
  const synthArmature = findArmatureModifier(
    useProjectStore.getState().project.nodes.find((n) => n.id === 'topwear'),
  );
  const synthParentBoneId = synthArmature?.data?.parentBoneId ?? null;

  // Path B: bind.
  useProjectStore.getState().updateProject((p) => {
    const part = p.nodes.find((n) => n.id === 'topwear');
    delete part.modifiers;
  });
  bindArmatureModifier('topwear');
  const bindArmature = findArmatureModifier(
    useProjectStore.getState().project.nodes.find((n) => n.id === 'topwear'),
  );
  const bindParentBoneId = bindArmature?.data?.parentBoneId ?? null;

  assert(synthParentBoneId === bindParentBoneId,
    `Test 2: synth.parentBoneId === bind.parentBoneId (synth=${synthParentBoneId}, bind=${bindParentBoneId})`);
  assert(synthParentBoneId === null,
    `Test 2: parentBoneId === null when joint is root bone (got ${synthParentBoneId})`);
}

// ── Test 3: plain group between bones — both paths skip past it ──────

{
  // A plain (non-bone) group sitting between two bones. Both walks
  // must skip past it and find the next true bone ancestor.
  //
  //   torso (bone)
  //     └─ folder (plain group, no boneRole)
  //          └─ leftArm (bone)
  //               └─ leftElbow (bone) ← joint
  //                    └─ handwear-l (part)
  //
  // joint=leftElbow → nearest bone ancestor walking node.parent =
  // leftArm (skipping... wait, leftArm IS a bone, no folder above it
  // in this fixture). Let me re-fix the structure.
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 31,
      canvas: { width: 1280, height: 1280 },
      textures: [],
      nodes: [
        {
          id: 'torso', type: 'group', boneRole: 'torso', name: 'torso',
          parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 640, pivotY: 800 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          // PLAIN group — no boneRole. Both walks must skip past it.
          id: 'folder', type: 'group', name: 'folder', parent: 'torso',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        },
        {
          id: 'leftArm', type: 'group', boneRole: 'leftArm', name: 'leftArm',
          parent: 'folder',          // plain-group parent
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 600 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow',
          parent: 'leftArm',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 500 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'handwear-l', type: 'part', name: 'handwear-l', parent: 'leftElbow',
          mesh: {
            vertices: [{ x: 100, y: 0 }, { x: 200, y: 0 }],
            triangles: [],
            boneWeights: [1.0, 1.0],
            jointBoneId: 'leftElbow',
          },
        },
      ],
      versionControl: { geometryVersion: 0 },
    },
  });

  // Path A: synth.
  useProjectStore.getState().updateProject((p) => {
    synthesizeModifierStacks(p);
  });
  const synthArmature = findArmatureModifier(
    useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l'),
  );
  const synthParentBoneId = synthArmature?.data?.parentBoneId ?? null;

  // Path B: bind.
  useProjectStore.getState().updateProject((p) => {
    const part = p.nodes.find((n) => n.id === 'handwear-l');
    delete part.modifiers;
  });
  bindArmatureModifier('handwear-l');
  const bindArmature = findArmatureModifier(
    useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l'),
  );
  const bindParentBoneId = bindArmature?.data?.parentBoneId ?? null;

  // Both paths must walk the joint bone's chain (leftElbow.parent=
  // leftArm — directly bone, no plain-group skip needed for the joint
  // itself). parentBoneId = leftArm in both cases.
  assert(synthParentBoneId === bindParentBoneId,
    `Test 3: synth.parentBoneId === bind.parentBoneId (synth=${synthParentBoneId}, bind=${bindParentBoneId})`);
  assert(synthParentBoneId === 'leftArm',
    `Test 3: nearest-bone-ancestor walk picks 'leftArm' (got ${synthParentBoneId})`);
}

console.log(`\narmatureModifier_parentBoneIdConsistency: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
