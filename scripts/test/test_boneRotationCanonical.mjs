// Unit tests for the bone-mirror layer in paramValuesStore.
//
// Plan: docs/plans/BONE_ROTATION_CANONICAL.md.
//
// Verifies the contract:
//   1. setParamValue on a registered ParamRotation_<bone> writes BOTH
//      values map AND bone.pose.rotation in one go.
//   2. setMany fans out atomically.
//   3. syncFromProject pulls bone.pose.rotation into values map after
//      a direct bone mutation (e.g., applyPoseAsRest, project load).
//   4. Non-mirror params (ParamAngleZ, etc.) still write only to values.
//   5. Registry replacement via setBoneMirrorRegistry is atomic.
//   6. Reset clears the mirror registry too.
//
// Run: node scripts/test/test_boneRotationCanonical.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useParamValuesStore } from '../../src/store/paramValuesStore.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function getProj() { return useProjectStore.getState().project; }
function getBone(id) { return getProj().nodes.find((n) => n.id === id); }
function getValues() { return useParamValuesStore.getState().values; }

function setupProject() {
  // Two limb bones (leftElbow, rightElbow) + torso bone (no skinning),
  // and matching ParamRotation_* params for the limb bones only.
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 17,
      canvas: { width: 1024, height: 1024 },
      textures: [],
      parameters: [
        { id: 'ParamRotation_leftElbow', name: 'Rotation leftElbow', min: -90, max: 90, default: 0 },
        { id: 'ParamRotation_rightElbow', name: 'Rotation rightElbow', min: -90, max: 90, default: 0 },
        { id: 'ParamAngleZ', name: 'Head Angle Z', min: -30, max: 30, default: 0 },
      ],
      nodes: [
        { id: 'b-torso', type: 'group', boneRole: 'torso', name: 'torso',
          parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 800 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        { id: 'b-leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow',
          parent: 'b-torso',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 600 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        { id: 'b-rightElbow', type: 'group', boneRole: 'rightElbow', name: 'rightElbow',
          parent: 'b-torso',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 600, pivotY: 600 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
      ],
      versionControl: { geometryVersion: 0 },
    },
    hasUnsavedChanges: false,
  });
  // Register the mirror.
  useParamValuesStore.getState().reset();
  useParamValuesStore.getState().setBoneMirrorRegistry([
    { paramId: 'ParamRotation_leftElbow', boneId: 'b-leftElbow' },
    { paramId: 'ParamRotation_rightElbow', boneId: 'b-rightElbow' },
  ]);
}

// ── 1. setParamValue fans out to bone.pose.rotation ────────────────────

{
  setupProject();
  useParamValuesStore.getState().setParamValue('ParamRotation_leftElbow', 15);
  assert(getValues()['ParamRotation_leftElbow'] === 15,
    'setParamValue: values map updated');
  assert(getBone('b-leftElbow').pose.rotation === 15,
    'setParamValue: bone.pose.rotation updated');
}

// ── 2. setMany fan-out is atomic across multiple bones ─────────────────

{
  setupProject();
  useParamValuesStore.getState().setMany({
    'ParamRotation_leftElbow': 10,
    'ParamRotation_rightElbow': -10,
    'ParamAngleZ': 5,
  });
  assert(getValues()['ParamRotation_leftElbow'] === 10
      && getValues()['ParamRotation_rightElbow'] === -10
      && getValues()['ParamAngleZ'] === 5,
    'setMany: all values updated');
  assert(getBone('b-leftElbow').pose.rotation === 10,
    'setMany: leftElbow bone fan-out');
  assert(getBone('b-rightElbow').pose.rotation === -10,
    'setMany: rightElbow bone fan-out');
}

// ── 3. Non-mirror params don't touch bones ────────────────────────────

{
  setupProject();
  useParamValuesStore.getState().setParamValue('ParamAngleZ', 25);
  assert(getValues()['ParamAngleZ'] === 25, 'setParamValue (non-mirror): values updated');
  // No bone has a mirror entry for ParamAngleZ; b-torso pose stays untouched.
  assert(getBone('b-torso').pose.rotation === 0,
    'setParamValue (non-mirror): bones untouched');
}

// ── 4. syncFromProject pulls bone.pose.rotation into values ────────────

{
  setupProject();
  // Direct bone mutation, bypassing the intercept (simulates applyPoseAsRest
  // mid-bake or a saved-project load before sync).
  useProjectStore.getState().updateProject((proj) => {
    const bone = proj.nodes.find((n) => n.id === 'b-leftElbow');
    bone.pose.rotation = 42;
  }, { skipHistory: true });
  // Before sync: values map is stale at 0.
  assert((getValues()['ParamRotation_leftElbow'] ?? 0) === 0,
    'pre-sync: values map stale');
  useParamValuesStore.getState().syncFromProject();
  assert(getValues()['ParamRotation_leftElbow'] === 42,
    'syncFromProject: pulled bone rotation into values');
}

// ── 5. setBoneMirrorRegistry replaces atomically ───────────────────────

{
  setupProject();
  useParamValuesStore.getState().setBoneMirrorRegistry([
    { paramId: 'ParamRotation_leftElbow', boneId: 'b-leftElbow' },
    // rightElbow dropped from registry
  ]);
  // Now writing to ParamRotation_rightElbow should NOT touch the bone.
  useParamValuesStore.getState().setParamValue('ParamRotation_rightElbow', 99);
  assert(getValues()['ParamRotation_rightElbow'] === 99,
    'replaced registry: values updated for dropped param');
  assert(getBone('b-rightElbow').pose.rotation === 0,
    'replaced registry: dropped bone NOT mutated');
  // leftElbow still in registry — fan-out works.
  useParamValuesStore.getState().setParamValue('ParamRotation_leftElbow', 7);
  assert(getBone('b-leftElbow').pose.rotation === 7,
    'replaced registry: surviving entry still fan-outs');
}

// ── 6. reset() clears the registry too ────────────────────────────────

{
  setupProject();
  useParamValuesStore.getState().setParamValue('ParamRotation_leftElbow', 50);
  assert(getBone('b-leftElbow').pose.rotation === 50, 'pre-reset: bone updated');
  useParamValuesStore.getState().reset();
  // After reset, the registry is empty. setParamValue for the same paramId
  // no longer fan-outs.
  useParamValuesStore.getState().setParamValue('ParamRotation_leftElbow', 80);
  assert(getValues()['ParamRotation_leftElbow'] === 80,
    'post-reset: values map updates');
  assert(getBone('b-leftElbow').pose.rotation === 50,
    'post-reset: registry cleared, bone unchanged');
}

// ── 7. skipBoneMirror flag bypasses fan-out (physics + animation playback) ─

{
  setupProject();
  // Physics tick or animation eval calls setMany with skipBoneMirror:true
  // so the per-frame output doesn't mutate projectStore. Values map
  // updates as usual; bone stays put.
  useParamValuesStore.getState().setMany(
    { 'ParamRotation_leftElbow': 18 },
    { skipBoneMirror: true },
  );
  assert(getValues()['ParamRotation_leftElbow'] === 18,
    'setMany skipBoneMirror: values map updated');
  assert(getBone('b-leftElbow').pose.rotation === 0,
    'setMany skipBoneMirror: bone NOT mutated (per-frame churn avoided)');

  // Same for setParamValue
  setupProject();
  useParamValuesStore.getState().setParamValue('ParamRotation_leftElbow', 22, { skipBoneMirror: true });
  assert(getValues()['ParamRotation_leftElbow'] === 22,
    'setParamValue skipBoneMirror: values map updated');
  assert(getBone('b-leftElbow').pose.rotation === 0,
    'setParamValue skipBoneMirror: bone NOT mutated');

  // Default (no opts) STILL fans out — user authoring path.
  useParamValuesStore.getState().setParamValue('ParamRotation_leftElbow', 33);
  assert(getBone('b-leftElbow').pose.rotation === 33,
    'setParamValue default: bone fan-out still works');
}

// ── 8. applyPoseAsRest zeroes mirror values via internal sync ─────────
//   The store's applyPoseAsRest action must call syncFromProject after
//   the bake so the values map reflects the zeroed bone poses.

{
  setupProject();
  useParamValuesStore.getState().setParamValue('ParamRotation_leftElbow', 25);
  useParamValuesStore.getState().setParamValue('ParamRotation_rightElbow', -25);
  // Sanity: pre-bake state.
  assert(getValues()['ParamRotation_leftElbow'] === 25
      && getValues()['ParamRotation_rightElbow'] === -25,
    'pre-bake: mirror values match bones');
  // Bake.
  useProjectStore.getState().applyPoseAsRest();
  // Post-bake: bones zeroed AND values reflect this without manual sync.
  assert(getBone('b-leftElbow').pose.rotation === 0,
    'applyPoseAsRest: leftElbow bone zeroed');
  assert(getBone('b-rightElbow').pose.rotation === 0,
    'applyPoseAsRest: rightElbow bone zeroed');
  assert(getValues()['ParamRotation_leftElbow'] === 0,
    'applyPoseAsRest: leftElbow mirror value zeroed (auto-sync)');
  assert(getValues()['ParamRotation_rightElbow'] === 0,
    'applyPoseAsRest: rightElbow mirror value zeroed (auto-sync)');
}

console.log(`bone-rotation canonical: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
}
process.exit(failed > 0 ? 1 : 0);
