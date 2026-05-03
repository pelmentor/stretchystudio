// Tests for the Cubism-port physics kernel (production default).
//
// Pinned to byte-faithful Cubism Web Framework semantics:
//   - radian-output * scale (not degrees-normalised * scale)
//   - Reflect=false negates input contribution (the `result * -1` flip @
//     cubismphysics.ts:1347)
//   - frame-rate-decoupled previous-frame interpolation when fps==0
//
// The full algorithm-level pin is the oracle harness at
// `scripts/cubism_physics/diff_v3_vs_oracle.mjs` which compares this kernel
// against a hand-transcribed JS oracle of `cubismphysics.ts`. This file unit-
// tests the public physicsTick.js surface under the cubism-port kernel.

import { strict as assert } from 'node:assert';
import {
  createPhysicsState,
  tickPhysics,
  buildParamSpecs,
  setPhysicsKernel,
  getPhysicsKernel,
} from '../../src/io/live2d/runtime/physicsTick.js';

setPhysicsKernel('cubism-port');

let pass = 0;
let fail = 0;
const expect = (label, fn) => {
  try { fn(); pass += 1; }
  catch (err) { fail += 1; console.error(`  ✗ ${label}: ${err.message}`); }
};
const close = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

// Standard 2-vertex hair-style rule. Same shape as the legacy test file but
// with a Cubism-meaningful scale (radian-output × scale, where pendulum at
// steady-state hangs ~0.105 rad off-vertical for 6° tilt → output = scale * 0.105).
const hairRule = {
  id: 'PhysicsSetting1',
  name: 'Hair Front',
  category: 'hair',
  inputs: [
    { paramId: 'ParamAngleX',     type: 'SRC_TO_X',       weight: 60, isReverse: false },
    { paramId: 'ParamAngleZ',     type: 'SRC_TO_G_ANGLE', weight: 60, isReverse: false },
    { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 40, isReverse: false },
    { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 40, isReverse: false },
  ],
  vertices: [
    { x: 0, y: 0, mobility: 1.0, delay: 1.0, acceleration: 1.0, radius: 0 },
    { x: 0, y: 3, mobility: 0.95, delay: 0.9, acceleration: 1.5, radius: 3 },
  ],
  normalization: {
    posMin: -10, posDef: 0, posMax: 10,
    angleMin: -10, angleDef: 0, angleMax: 10,
  },
  outputs: [
    { paramId: 'ParamHairFront', vertexIndex: 1, scale: 5.0, isReverse: false },
  ],
};

const baseParamSpecs = buildParamSpecs([
  { id: 'ParamAngleX',     min: -30, max: 30,  default: 0 },
  { id: 'ParamAngleZ',     min: -30, max: 30,  default: 0 },
  { id: 'ParamBodyAngleX', min: -10, max: 10,  default: 0 },
  { id: 'ParamBodyAngleZ', min: -10, max: 10,  default: 0 },
  { id: 'ParamHairFront',  min: -1,  max: 1,   default: 0 },
]);

const settle = (state, rules, paramValues, paramSpecs, seconds = 3) => {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    tickPhysics(state, rules, paramValues, paramSpecs, 1 / 60);
  }
};

// ── default kernel ─────────────────────────────────────────────────────
expect('default kernel is cubism-port', () => {
  // setPhysicsKernel('cubism-port') was called above; verify still active.
  assert.equal(getPhysicsKernel(), 'cubism-port');
});

expect('createPhysicsState returns kernel-bearing state under cubism-port', () => {
  const s = createPhysicsState([hairRule]);
  assert.ok(s && typeof s === 'object');
  assert.ok(s.kernel, 'state.kernel should exist under cubism-port');
  assert.ok(s.kernel.rig, 'state.kernel.rig should be the flat Cubism rig');
  assert.equal(s.kernel.rig.subRigCount, 1);
  assert.equal(s.kernel.rig.particles.length, 2);
  assert.equal(s.kernel.rig.inputs.length, 4);
  assert.equal(s.kernel.rig.outputs.length, 1);
});

expect('createPhysicsState: empty rules → kernel with no settings', () => {
  const s = createPhysicsState([]);
  assert.equal(s.kernel.rig.subRigCount, 0);
});

expect('createPhysicsState: rules without enough vertices skipped', () => {
  const s = createPhysicsState([{ id: 'no-verts', vertices: [] }, { id: 'one-vert', vertices: [{x:0,y:0}] }, hairRule]);
  assert.equal(s.kernel.rig.subRigCount, 1);
  assert.equal(s.kernel.rig.settings[0].ruleId, 'PhysicsSetting1');
});

// ── rest behaviour ─────────────────────────────────────────────────────
expect('rest input → ParamHairFront stays near 0 after settle', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = {};
  settle(state, [hairRule], paramValues, baseParamSpecs);
  assert.ok(close(paramValues.ParamHairFront ?? 0, 0, 1e-3),
    `expected ~0 at rest, got ${paramValues.ParamHairFront}`);
});

// ── drive behaviour: Cubism semantics ───────────────────────────────────
expect('ParamAngleZ=+30 drives ParamHairFront positive (angle-input case)', () => {
  // With Cubism Reflect=false the normaliser flips sign and the gravity
  // direction tilts to the OPPOSITE side from the +input. But when the
  // pendulum settles on that opposite side, `directionToRadian(parentGravity,
  // translation)` returns a +δ rad (same magnitude but the geometry of the
  // delta-from-vertical preserves the sign of the input angle). Net: same
  // sign as input for SRC_TO_G_ANGLE drives, by construction.
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 30 };
  settle(state, [hairRule], paramValues, baseParamSpecs, 5);
  assert.ok(paramValues.ParamHairFront > 0.1,
    `expected positive settle, got ${paramValues.ParamHairFront}`);
});

expect('ParamAngleZ=-30 drives ParamHairFront negative', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: -30 };
  settle(state, [hairRule], paramValues, baseParamSpecs, 5);
  assert.ok(paramValues.ParamHairFront < -0.1,
    `expected negative settle, got ${paramValues.ParamHairFront}`);
});

expect('output isReverse flips sign relative to default', () => {
  const baseRule = {
    ...hairRule,
    outputs: [{ paramId: 'ParamHairFront', vertexIndex: 1, scale: 5.0, isReverse: false }],
  };
  const reverseOut = {
    ...hairRule,
    outputs: [{ paramId: 'ParamHairFront', vertexIndex: 1, scale: 5.0, isReverse: true }],
  };
  const stateA = createPhysicsState([baseRule]);
  const pvA = { ParamAngleZ: 30 };
  settle(stateA, [baseRule], pvA, baseParamSpecs, 5);

  const stateB = createPhysicsState([reverseOut]);
  const pvB = { ParamAngleZ: 30 };
  settle(stateB, [reverseOut], pvB, baseParamSpecs, 5);

  assert.ok(Math.sign(pvA.ParamHairFront) !== Math.sign(pvB.ParamHairFront),
    `expected opposite signs (base ${pvA.ParamHairFront} vs reversed ${pvB.ParamHairFront})`);
});

expect('input isReverse on the only angle input flips output sign', () => {
  const baseRule = {
    ...hairRule,
    inputs: [{ paramId: 'ParamAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100, isReverse: false }],
    outputs: [{ paramId: 'ParamHairFront', vertexIndex: 1, scale: 5.0, isReverse: false }],
  };
  const reverseInput = {
    ...baseRule,
    inputs: [{ paramId: 'ParamAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100, isReverse: true }],
  };
  const stateA = createPhysicsState([baseRule]);
  const pvA = { ParamAngleZ: 30 };
  settle(stateA, [baseRule], pvA, baseParamSpecs, 5);

  const stateB = createPhysicsState([reverseInput]);
  const pvB = { ParamAngleZ: 30 };
  settle(stateB, [reverseInput], pvB, baseParamSpecs, 5);

  assert.ok(Math.sign(pvA.ParamHairFront) !== Math.sign(pvB.ParamHairFront),
    `expected opposite signs (base ${pvA.ParamHairFront} vs input-reverse ${pvB.ParamHairFront})`);
});

// ── lag behaviour ──────────────────────────────────────────────────────
expect('abrupt input → first-frame output is 0 (previous-frame interpolation, fps=0)', () => {
  // Cubism's previous-frame interpolation when no Fps is authored writes the
  // PRIOR frame's pendulum output (=0 at frame 0) to the parameter.
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 30 };
  tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
  assert.ok(close(paramValues.ParamHairFront ?? 0, 0, 1e-3),
    `expected ~0 on first frame, got ${paramValues.ParamHairFront}`);
});

expect('after several frames, output reaches steady state magnitude', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 30 };
  const samples = [];
  for (let i = 0; i < 60; i++) {
    tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
    samples.push(paramValues.ParamHairFront ?? 0);
  }
  // Cubism's algorithm converges quickly; first frame is 0 (previous-frame
  // interpolation), and within ~30 frames the pendulum has settled.
  assert.ok(samples[0] === 0 || Math.abs(samples[0]) < Math.abs(samples[55]),
    `expected initial lag (samples[0]=${samples[0]}, samples[55]=${samples[55]})`);
  assert.ok(Math.abs(samples[55]) > 0.1,
    `expected non-trivial steady-state magnitude, got ${samples[55]}`);
});

// ── multi-rule independence ─────────────────────────────────────────────
expect('multiple rules tick independently', () => {
  const ruleA = { ...hairRule, id: 'ruleA',
    outputs: [{ paramId: 'ParamHairFront', vertexIndex: 1, scale: 5.0, isReverse: false }] };
  const specs = buildParamSpecs([
    { id: 'ParamAngleZ',     min: -30, max: 30, default: 0 },
    { id: 'ParamHairFront',  min: -1,  max: 1,  default: 0 },
    { id: 'ParamHairBack',   min: -1,  max: 1,  default: 0 },
  ]);
  const ruleB = { ...hairRule, id: 'ruleB',
    outputs: [{ paramId: 'ParamHairBack', vertexIndex: 1, scale: 5.0, isReverse: false }] };
  const state = createPhysicsState([ruleA, ruleB]);
  const paramValues = { ParamAngleZ: 30 };
  settle(state, [ruleA, ruleB], paramValues, specs, 3);
  assert.ok(Math.abs(paramValues.ParamHairFront) > 0.05);
  assert.ok(Math.abs(paramValues.ParamHairBack) > 0.05);
});

// ── numerical stability ───────────────────────────────────────────────
expect('never produces NaN/Infinity over long simulation', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 30, ParamAngleX: -30, ParamBodyAngleZ: 30 };
  for (let i = 0; i < 600; i++) {
    tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
  }
  for (const v of Object.values(paramValues)) {
    assert.ok(Number.isFinite(v), `non-finite param value: ${v}`);
  }
});

expect('rapidly oscillating input stays bounded', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 0 };
  for (let i = 0; i < 600; i++) {
    paramValues.ParamAngleZ = (i % 30 < 15) ? 30 : -30;
    tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
    assert.ok(Math.abs(paramValues.ParamHairFront ?? 0) <= 1.001,
      `param escaped clamp at frame ${i}: ${paramValues.ParamHairFront}`);
  }
});

// ── kernel switching ───────────────────────────────────────────────────
expect('switching to v3-legacy + back preserves cubism-port output magnitude', () => {
  const state1 = createPhysicsState([hairRule]);
  const pv1 = { ParamAngleZ: 30 };
  settle(state1, [hairRule], pv1, baseParamSpecs, 3);
  const cubismResult = pv1.ParamHairFront;

  setPhysicsKernel('v3-legacy');
  const state2 = createPhysicsState([hairRule]);
  const pv2 = { ParamAngleZ: 30 };
  settle(state2, [hairRule], pv2, baseParamSpecs, 3);
  const legacyResult = pv2.ParamHairFront;

  setPhysicsKernel('cubism-port');
  const state3 = createPhysicsState([hairRule]);
  const pv3 = { ParamAngleZ: 30 };
  settle(state3, [hairRule], pv3, baseParamSpecs, 3);
  const cubismAgain = pv3.ParamHairFront;

  assert.ok(close(cubismResult, cubismAgain, 1e-6),
    `cubism-port deterministic across kernel switches (${cubismResult} vs ${cubismAgain})`);
  // Both kernels should produce same-sign output for SRC_TO_G_ANGLE drives;
  // magnitudes differ (legacy uses degrees-normalised, port uses radians*scale).
  assert.equal(Math.sign(legacyResult), Math.sign(cubismResult),
    `same sign across kernels for angle-input case (legacy=${legacyResult}, port=${cubismResult})`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
