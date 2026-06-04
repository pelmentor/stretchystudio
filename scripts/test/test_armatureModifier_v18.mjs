// 2026-06-04 — applyArmatureModifier / bindArmatureModifier must resolve
// geometry via getMesh so v18 (Object/ObjectData split) parts get baked +
// bound. Pre-fix the service read `part.mesh` directly; for any post-v18
// part `mesh` was null → `applyArmatureModifier` returned
// `{baked:false, reason:'no-mesh-vertices'}` even when the rig was healthy,
// and `bindArmatureModifier` missed the persisted `jointBoneId` re-bind
// shortcut.
//
// Also locks down the PARENT-C fail-loud contract: the updateProject
// callback now tracks `bakeOk` / `bindOk` and returns `{baked:false,
// reason:'...callback-aborted...'}` when the recipe couldn't write —
// pre-fix the outer return reported `{baked:true}` regardless.
//
// Run: node scripts/test/test_armatureModifier_v18.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { applyArmatureModifier, bindArmatureModifier } from '../../src/services/ArmatureModifierService.js';
import { getMesh } from '../../src/store/objectDataAccess.js';
import { synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-3) { return Math.abs(a - b) <= eps; }

const PART_ID = 'handwear-l';
const DATA_ID = `${PART_ID}__data`;

function setupV18Armed() {
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 49,
      canvas: { width: 1280, height: 1280 },
      textures: [],
      meshSignatures: {},
      nodes: [
        {
          id: 'leftArm', type: 'group', boneRole: 'leftArm', name: 'leftArm',
          parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow',
          parent: 'leftArm',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 0 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        // v18 PART shell — NO inline `mesh`, geometry on sibling meshData node.
        {
          id: PART_ID, type: 'part', name: PART_ID, parent: 'leftArm',
          dataId: DATA_ID,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
          modifiers: [
            {
              type: 'armature',
              deformerId: 'leftElbow',
              enabled: true,
              mode: 3,
              data: {
                jointBoneId: 'leftElbow',
                jointBoneRole: 'leftElbow',
                parentBoneId: 'leftArm',
                parentBoneRole: 'leftArm',
              },
            },
          ],
        },
        // Sibling meshData node — geometry payload.
        {
          id: DATA_ID, type: 'meshData',
          vertices: [{ x: 200, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 50 }],
          uvs: [0, 0, 1, 0, 0.5, 1],
          triangles: [[0, 1, 2]],
          boneWeights: [1, 1, 1],
          jointBoneId: 'leftElbow',
        },
      ],
      parameters: [], deformers: [], actions: [], lastInitRigCompletedAt: 0,
    },
  });
}

// 1 — applyArmatureModifier resolves v18 mesh and bakes successfully.
{
  setupV18Armed();
  const result = applyArmatureModifier(PART_ID);
  assert(result.baked === true,
    `v18 apply: baked=true (pre-fix would be false, reason="no-mesh-vertices"); got ${JSON.stringify(result)}`);
  assert(result.vertCount === 3, `v18 apply: vertCount=3 (got ${result.vertCount})`);

  const project = useProjectStore.getState().project;
  const part = project.nodes.find((n) => n.id === PART_ID);
  // Armature modifier removed from stack post-Apply (modifiers slot
  // deleted when array empties).
  assert(part.modifiers === undefined,
    'v18 apply: empty modifiers[] deleted post-Apply');
  // Mesh data on the meshData node — verts mutated, runtime rebuilt.
  const mesh = getMesh(part, project);
  assert(mesh != null, 'v18 apply: getMesh still resolves post-Apply');
  assert(mesh.runtime != null, 'v18 apply: runtime rebuilt (Apply bake convention)');
  assert(Array.isArray(mesh.runtime.keyforms)
         && mesh.runtime.keyforms.length === 1,
    'v18 apply: runtime has single rest keyform post-Apply');
  // boneWeights + jointBoneId STAY on the meshData node (Blender semantic).
  assert(Array.isArray(mesh.boneWeights) && mesh.boneWeights.length === 3,
    'v18 apply: boneWeights preserved on meshData node');
  assert(mesh.jointBoneId === 'leftElbow',
    'v18 apply: jointBoneId preserved');
}

// 2 — Apply on a v18 part with NO mesh data → reports failure loudly (PARENT-C).
{
  setupV18Armed();
  // Drop the meshData node — part now points at a missing dataId.
  useProjectStore.getState().updateProject((proj) => {
    const idx = proj.nodes.findIndex((n) => n.id === DATA_ID);
    if (idx >= 0) proj.nodes.splice(idx, 1);
  });
  const result = applyArmatureModifier(PART_ID);
  assert(result.baked === false,
    `v18 apply (missing meshData): baked=false (got ${JSON.stringify(result)})`);
  assert(typeof result.reason === 'string' && result.reason.length > 0,
    `v18 apply (missing meshData): reason populated (got ${result.reason})`);
}

// 3 — synthesizeModifierStacks appends the Armature modifier for a v18
//     bone-weighted part (boneWeights live on the meshData node). Pre-fix
//     it read part.mesh directly → never matched → stack had no Armature.
{
  const projectV18 = {
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm',
        transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm',
        transform: { pivotX: 100, pivotY: 0 }, pose: {} },
      { id: 'handwear-l', type: 'part', name: 'handwear-l', parent: 'leftArm',
        dataId: 'handwear-l__data' },
      { id: 'handwear-l__data', type: 'meshData',
        vertices: [{ x: 100, y: 0 }, { x: 110, y: 5 }],
        boneWeights: [1, 1],
        jointBoneId: 'leftElbow' },
    ],
  };
  synthesizeModifierStacks(projectV18);
  const part = projectV18.nodes.find((n) => n.id === 'handwear-l');
  const stack = part.modifiers ?? [];
  assert(stack.length === 1,
    `v18 synth: bone-baked part gets Armature appended (stack.length=${stack.length})`);
  assert(stack.some((m) => m?.type === 'armature'),
    'v18 synth: stack contains type:armature entry');
}

// 4 — bindArmatureModifier resolves v18 mesh's jointBoneId fast path.
{
  setupV18Armed();
  // Drop the existing armature modifier so bind has work to do.
  useProjectStore.getState().updateProject((proj) => {
    const part = proj.nodes.find((n) => n.id === PART_ID);
    part.modifiers = [];
  });
  const result = bindArmatureModifier(PART_ID);
  assert(result.bound === true,
    `v18 bind: bound=true (got ${JSON.stringify(result)})`);
  assert(result.jointBoneId === 'leftElbow',
    'v18 bind: jointBoneId resolved via meshData node, not ancestor walk');
  const project = useProjectStore.getState().project;
  const part = project.nodes.find((n) => n.id === PART_ID);
  assert(Array.isArray(part.modifiers) && part.modifiers.length === 1
         && part.modifiers[0].type === 'armature',
    'v18 bind: armature modifier pushed onto stack');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
