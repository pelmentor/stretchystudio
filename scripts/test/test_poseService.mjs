// PoseService unit tests (BUG-004 / BUG-008 / BUG-010 root-cause fix).
//
// PoseService is the single source of truth for "reset pose" semantics.
// Two functions, two semantics:
//
//   - resetPoseDraft()  — clear draftPose + reset paramValues only
//   - resetToRestPose() — same as above + zero every bone-tagged
//                         group's transform.{rotation,x,y,scaleX,scaleY}
//                         (pivotX/pivotY preserved)
//
// Run: node scripts/test/test_poseService.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useAnimationStore } from '../../src/store/animationStore.js';
import { useParamValuesStore } from '../../src/store/paramValuesStore.js';
import { resetPoseDraft, resetToRestPose } from '../../src/services/PoseService.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

/** Reset all stores to a known state for a fresh test. */
function setupProject({ withBoneRotations = true, withParamValues = true, withDraftPose = true } = {}) {
  // Project: 2 bone groups + 2 parts (one is non-bone), with parameters.
  useProjectStore.setState({
    project: {
      version: '0.1',
      schemaVersion: 13,
      canvas: { width: 800, height: 600 },
      textures: [],
      nodes: [
        {
          id: 'bone-arm-l', type: 'group', name: 'arm-l', parent: null,
          boneRole: 'leftElbow',
          transform: withBoneRotations
            ? { x: 10, y: 5, rotation: 45, scaleX: 1.2, scaleY: 0.9, pivotX: 200, pivotY: 300 }
            : { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 200, pivotY: 300 },
        },
        {
          id: 'bone-leg-r', type: 'group', name: 'leg-r', parent: null,
          boneRole: 'rightKnee',
          transform: withBoneRotations
            ? { x: -3, y: 2, rotation: -20, scaleX: 1, scaleY: 1.1, pivotX: 400, pivotY: 500 }
            : { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 500 },
        },
        {
          id: 'group-no-bone', type: 'group', name: 'face', parent: null,
          // No boneRole → should NOT be reset
          transform: { x: 50, y: 60, rotation: 12, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 100 },
        },
        {
          id: 'part-hat', type: 'part', name: 'hat', parent: null,
          // Part transforms are user layout, NOT pose — should NOT be reset
          transform: { x: 25, y: -10, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
          opacity: 1, visible: true,
          mesh: null,
        },
      ],
      parameters: [
        { id: 'ParamAngleX', name: 'Angle X', default: 0, min: -30, max: 30 },
        { id: 'ParamEyeLOpen', name: 'Eye L Open', default: 1, min: 0, max: 1 },
      ],
      animations: [],
      versionControl: { geometryVersion: 0 },
    },
    hasUnsavedChanges: false,
  });

  if (withParamValues) {
    useParamValuesStore.getState().setMany({
      ParamAngleX: 25,    // user-tweaked
      ParamEyeLOpen: 0.4,  // user-tweaked away from default 1
    });
  } else {
    useParamValuesStore.getState().reset();
  }

  if (withDraftPose) {
    const an = useAnimationStore.getState();
    an.setDraftPose('bone-arm-l', { rotation: 45 });
    an.setDraftPose('bone-leg-r', { rotation: -20 });
  } else {
    useAnimationStore.getState().clearDraftPose();
  }
}

// ── resetPoseDraft: clears draft + resets paramValues, no node mutation ──
{
  setupProject();
  resetPoseDraft();

  // draftPose cleared
  const draft = useAnimationStore.getState().draftPose;
  assert(draft.size === 0, 'resetPoseDraft: draftPose cleared');

  // paramValues reset to defaults
  const v = useParamValuesStore.getState().values;
  assert(nearlyEq(v.ParamAngleX, 0), 'resetPoseDraft: ParamAngleX → 0 (default)');
  assert(nearlyEq(v.ParamEyeLOpen, 1), 'resetPoseDraft: ParamEyeLOpen → 1 (default)');

  // Bone-group transforms NOT touched (animation-mode semantics)
  const proj = useProjectStore.getState().project;
  const armL = proj.nodes.find(n => n.id === 'bone-arm-l');
  assert(armL.transform.rotation === 45, 'resetPoseDraft: bone-arm-l rotation preserved (animation mode)');
  assert(armL.transform.x === 10,         'resetPoseDraft: bone-arm-l x preserved');
}

// ── resetToRestPose: above PLUS bone-group transforms zeroed ──────────
{
  setupProject();
  resetToRestPose();

  const draft = useAnimationStore.getState().draftPose;
  assert(draft.size === 0, 'resetToRestPose: draftPose cleared');

  const v = useParamValuesStore.getState().values;
  assert(nearlyEq(v.ParamAngleX, 0),    'resetToRestPose: ParamAngleX → 0');
  assert(nearlyEq(v.ParamEyeLOpen, 1),  'resetToRestPose: ParamEyeLOpen → 1');

  const proj = useProjectStore.getState().project;
  const armL = proj.nodes.find(n => n.id === 'bone-arm-l');
  assert(armL.transform.rotation === 0, 'resetToRestPose: bone-arm-l rotation → 0');
  assert(armL.transform.x === 0,        'resetToRestPose: bone-arm-l x → 0');
  assert(armL.transform.y === 0,        'resetToRestPose: bone-arm-l y → 0');
  assert(armL.transform.scaleX === 1,   'resetToRestPose: bone-arm-l scaleX → 1');
  assert(armL.transform.scaleY === 1,   'resetToRestPose: bone-arm-l scaleY → 1');
  // Pivots preserved
  assert(armL.transform.pivotX === 200, 'resetToRestPose: bone-arm-l pivotX preserved');
  assert(armL.transform.pivotY === 300, 'resetToRestPose: bone-arm-l pivotY preserved');

  const legR = proj.nodes.find(n => n.id === 'bone-leg-r');
  assert(legR.transform.rotation === 0, 'resetToRestPose: bone-leg-r rotation → 0');
  assert(legR.transform.scaleY === 1,   'resetToRestPose: bone-leg-r scaleY → 1');
  assert(legR.transform.pivotX === 400, 'resetToRestPose: bone-leg-r pivotX preserved');

  // Non-bone group should NOT be reset
  const face = proj.nodes.find(n => n.id === 'group-no-bone');
  assert(face.transform.rotation === 12, 'resetToRestPose: non-bone group rotation preserved');
  assert(face.transform.x === 50,        'resetToRestPose: non-bone group x preserved');

  // Part should NOT be reset (user layout)
  const hat = proj.nodes.find(n => n.id === 'part-hat');
  assert(hat.transform.x === 25,         'resetToRestPose: part-hat x preserved (user layout)');
}

// ── No-op when there's nothing to reset ──────────────────────────────
{
  setupProject({ withBoneRotations: false, withParamValues: false, withDraftPose: false });
  resetToRestPose();

  const proj = useProjectStore.getState().project;
  const armL = proj.nodes.find(n => n.id === 'bone-arm-l');
  assert(armL.transform.rotation === 0,  'noop: bone-arm-l rotation already 0');
  assert(armL.transform.pivotX === 200,  'noop: bone-arm-l pivotX still 200');

  const draft = useAnimationStore.getState().draftPose;
  assert(draft.size === 0, 'noop: draftPose still empty');
}

// ── Empty parameters array: paramValues reset still safe ─────────────
{
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 13,
      canvas: { width: 800, height: 600 },
      textures: [],
      nodes: [],
      parameters: [], // empty
      animations: [],
      versionControl: { geometryVersion: 0 },
    },
    hasUnsavedChanges: false,
  });
  useParamValuesStore.getState().setMany({ ParamX: 10 });
  resetPoseDraft();
  const v = useParamValuesStore.getState().values;
  assert(Object.keys(v).length === 0, 'empty params: paramValues fully cleared');
}

// ── Group missing transform: skip without error ──────────────────────
{
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 13,
      canvas: { width: 800, height: 600 },
      textures: [],
      nodes: [
        { id: 'bone-no-transform', type: 'group', name: 'limb', parent: null, boneRole: 'leftElbow' },
        // No transform field — should be skipped without throwing
      ],
      parameters: [],
      animations: [],
      versionControl: { geometryVersion: 0 },
    },
    hasUnsavedChanges: false,
  });
  let threw = false;
  try { resetToRestPose(); } catch (_e) { threw = true; }
  assert(!threw, 'group without transform: no throw');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
