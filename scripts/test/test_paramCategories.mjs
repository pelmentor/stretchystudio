// v3 Phase 6 - tests for src/io/live2d/cmo3/paramCategories.js
// Run: node scripts/test/test_paramCategories.mjs

import { CATEGORY_DEFS, categorizeParam } from '../../src/io/live2d/cmo3/paramCategories.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── CATEGORY_DEFS shape ────────────────────────────────────────────

{
  assert(Array.isArray(CATEGORY_DEFS), 'CATEGORY_DEFS is array');
  assert(CATEGORY_DEFS.length === 10, 'CATEGORY_DEFS has 10 entries');
  // Order matters — defines the Random Pose dialog folder order.
  const expectedKeys = ['face','eye','eyeball','brow','mouth','body','hair','clothing','bone','custom'];
  for (let i = 0; i < expectedKeys.length; i++) {
    assert(CATEGORY_DEFS[i].key === expectedKeys[i],
      `CATEGORY_DEFS[${i}].key = ${expectedKeys[i]}`);
  }
  for (const cd of CATEGORY_DEFS) {
    assert(typeof cd.name === 'string' && cd.name.length > 0,
      `CATEGORY_DEFS.${cd.key}: has name`);
    assert(typeof cd.idstr === 'string' && /^ParamGroup/.test(cd.idstr),
      `CATEGORY_DEFS.${cd.key}: idstr starts with ParamGroup`);
  }
  // Frozen — protects against accidental mutation.
  assert(Object.isFrozen(CATEGORY_DEFS), 'CATEGORY_DEFS is frozen');
}

// ── categorizeParam: face ──────────────────────────────────────────

{
  assert(categorizeParam('ParamAngleX') === 'face', 'ParamAngleX → face');
  assert(categorizeParam('ParamAngleY') === 'face', 'ParamAngleY → face');
  assert(categorizeParam('ParamAngleZ') === 'face', 'ParamAngleZ → face');
  assert(categorizeParam('ParamCheek')  === 'face', 'ParamCheek → face');
  // BodyAngle is body, NOT face — disambiguates the regex
  assert(categorizeParam('ParamBodyAngleX') === 'body', 'ParamBodyAngleX → body (not face)');
}

// ── categorizeParam: eye / eyeball / brow / mouth ───────────────────

{
  assert(categorizeParam('ParamEyeLOpen')  === 'eye',     'ParamEyeLOpen → eye');
  assert(categorizeParam('ParamEyeROpen')  === 'eye',     'ParamEyeROpen → eye');
  assert(categorizeParam('ParamEyeLSmile') === 'eye',     'ParamEyeLSmile → eye');
  assert(categorizeParam('ParamEyeRSmile') === 'eye',     'ParamEyeRSmile → eye');
  // EyeBall NOT classified as eye — different folder
  assert(categorizeParam('ParamEyeBallX')  === 'eyeball', 'ParamEyeBallX → eyeball');
  assert(categorizeParam('ParamEyeBallY')  === 'eyeball', 'ParamEyeBallY → eyeball');

  assert(categorizeParam('ParamBrowLY')      === 'brow', 'ParamBrowLY → brow');
  assert(categorizeParam('ParamBrowLAngle')  === 'brow', 'ParamBrowLAngle → brow');

  assert(categorizeParam('ParamMouthOpenY') === 'mouth', 'ParamMouthOpenY → mouth');
  assert(categorizeParam('ParamMouthForm')  === 'mouth', 'ParamMouthForm → mouth');
}

// ── categorizeParam: body ──────────────────────────────────────────

{
  assert(categorizeParam('ParamBodyAngleX') === 'body', 'ParamBodyAngleX → body');
  assert(categorizeParam('ParamBodyAngleY') === 'body', 'ParamBodyAngleY → body');
  assert(categorizeParam('ParamBodyAngleZ') === 'body', 'ParamBodyAngleZ → body');
  assert(categorizeParam('ParamBreath')     === 'body', 'ParamBreath → body');
  // Sway params follow torso orientation → body folder, not bone.
  // Regex shape: ^Param(Shoulder|Elbow|Wrist)Sway — no L/R between
  // joint and "Sway". (Actual bone rotation today uses ParamRotation_*;
  // these names are reserved for a future per-joint sway pass.)
  assert(categorizeParam('ParamShoulderSway') === 'body', 'ParamShoulderSway → body');
  assert(categorizeParam('ParamElbowSway')    === 'body', 'ParamElbowSway → body');
  assert(categorizeParam('ParamWristSway')    === 'body', 'ParamWristSway → body');
}

// ── categorizeParam: hair / clothing / bone ─────────────────────────

{
  assert(categorizeParam('ParamHairFront') === 'hair', 'ParamHairFront → hair');
  assert(categorizeParam('ParamHairBack')  === 'hair', 'ParamHairBack → hair');
  assert(categorizeParam('ParamHairSide')  === 'hair', 'ParamHairSide → hair');

  assert(categorizeParam('ParamSkirt') === 'clothing', 'ParamSkirt → clothing');
  assert(categorizeParam('ParamShirt') === 'clothing', 'ParamShirt → clothing');
  assert(categorizeParam('ParamPants') === 'clothing', 'ParamPants → clothing');
  assert(categorizeParam('ParamBust')  === 'clothing', 'ParamBust → clothing');

  assert(categorizeParam('ParamRotation_torso')      === 'bone', 'ParamRotation_torso → bone');
  assert(categorizeParam('ParamRotation_leftElbow')  === 'bone', 'ParamRotation_leftElbow → bone');
  assert(categorizeParam('ParamRotation_rightKnee') === 'bone', 'ParamRotation_rightKnee → bone');
}

// ── categorizeParam: custom (catch-all) ─────────────────────────────

{
  assert(categorizeParam('ParamCustomThing') === 'custom', 'unknown → custom');
  assert(categorizeParam('SomethingElse')    === 'custom', 'non-Param prefix → custom');
  assert(categorizeParam('ParamRotationX')   === 'custom',
    'ParamRotation_<X> needs underscore — without → custom');
  assert(categorizeParam('Param.smile')      === 'custom', 'variant suffix → custom');
}

// ── categorizeParam: falsy guards ───────────────────────────────────

{
  assert(categorizeParam(null)      === 'custom', 'null → custom');
  assert(categorizeParam(undefined) === 'custom', 'undefined → custom');
  assert(categorizeParam('')        === 'custom', 'empty string → custom');
}

console.log(`paramCategories: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
