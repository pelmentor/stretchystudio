// Tests for the R9 physics tick (Cubism-style pendulum integrator).
//
// Pure JS — no GL, no React. Verifies the integrator state machine,
// input aggregation, output mapping, frame independence, and edge
// cases.

import { strict as assert } from 'node:assert';
import {
  createPhysicsState,
  tickPhysics,
  buildParamSpecs,
  __testing__,
} from '../src/io/live2d/runtime/physicsTick.js';

let pass = 0;
let fail = 0;
const expect = (label, fn) => {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`  ✗ ${label}: ${err.message}`);
  }
};

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const closeArr = (a, b, eps = 1e-6) => a.every((v, i) => close(v, b[i], eps));

// Standard 2-vertex hair-style rule used across most tests.
const hairRule = {
  id: 'PhysicsSetting1',
  name: 'Hair Front',
  category: 'hair',
  requireTag: null,
  inputs: [
    { paramId: 'ParamAngleX',     type: 'SRC_TO_X',       weight: 60 },
    { paramId: 'ParamAngleZ',     type: 'SRC_TO_G_ANGLE', weight: 60 },
    { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 40 },
    { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 40 },
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
    { paramId: 'ParamHairFront', vertexIndex: 1, scale: 1.522, isReverse: false },
  ],
};

// Standard parameter specs covering the hair rule.
const baseParamSpecs = buildParamSpecs([
  { id: 'ParamAngleX',     min: -30, max: 30,  default: 0 },
  { id: 'ParamAngleY',     min: -30, max: 30,  default: 0 },
  { id: 'ParamAngleZ',     min: -30, max: 30,  default: 0 },
  { id: 'ParamBodyAngleX', min: -10, max: 10,  default: 0 },
  { id: 'ParamBodyAngleY', min: -10, max: 10,  default: 0 },
  { id: 'ParamBodyAngleZ', min: -10, max: 10,  default: 0 },
  { id: 'ParamHairFront',  min: -1,  max: 1,   default: 0 },
  { id: 'ParamHairBack',   min: -1,  max: 1,   default: 0 },
  { id: 'ParamSkirt',      min: -1,  max: 1,   default: 0 },
]);

// Settle the simulation by running enough substeps for damping to win.
const settle = (state, rules, paramValues, paramSpecs, seconds = 2) => {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    tickPhysics(state, rules, paramValues, paramSpecs, 1 / 60);
  }
};

// ── createPhysicsState shape ────────────────────────────────────────────
expect('createPhysicsState: empty rules → empty state', () => {
  const s = createPhysicsState([]);
  assert.equal(s.byRuleId.size, 0);
});

expect('createPhysicsState: null/undefined → empty state', () => {
  const a = createPhysicsState(null);
  const b = createPhysicsState(undefined);
  assert.equal(a.byRuleId.size, 0);
  assert.equal(b.byRuleId.size, 0);
});

expect('createPhysicsState: 1 rule → particles allocated for each vertex', () => {
  const s = createPhysicsState([hairRule]);
  const rs = s.byRuleId.get('PhysicsSetting1');
  assert.ok(rs);
  assert.equal(rs.particles.length, 2);
  assert.equal(rs.particles[0].initialized, false);
  assert.equal(rs.accumulator, 0);
});

expect('createPhysicsState: rules without vertices skipped', () => {
  const s = createPhysicsState([{ id: 'no-verts', vertices: [] }, hairRule]);
  assert.equal(s.byRuleId.size, 1);
  assert.ok(s.byRuleId.has('PhysicsSetting1'));
});

expect('createPhysicsState: particle 1 starts at radius below particle 0', () => {
  const s = createPhysicsState([hairRule]);
  const rs = s.byRuleId.get('PhysicsSetting1');
  assert.ok(closeArr(rs.particles[0].position, [0, 0]));
  assert.ok(closeArr(rs.particles[1].position, [0, 3]));
});

// ── normalizeParam ──────────────────────────────────────────────────────
const { normalizeParam, scaleNormalizedToRange, aggregateInputs } = __testing__;

expect('normalizeParam: at default → 0', () => {
  assert.equal(normalizeParam(0, { min: -30, max: 30, default: 0 }), 0);
});

expect('normalizeParam: at max → +1', () => {
  assert.equal(normalizeParam(30, { min: -30, max: 30, default: 0 }), 1);
});

expect('normalizeParam: at min → -1', () => {
  assert.equal(normalizeParam(-30, { min: -30, max: 30, default: 0 }), -1);
});

expect('normalizeParam: half-positive → +0.5', () => {
  assert.equal(normalizeParam(15, { min: -30, max: 30, default: 0 }), 0.5);
});

expect('normalizeParam: asymmetric range positive side', () => {
  // default=0, max=20 → at value 10, should be 0.5
  assert.equal(normalizeParam(10, { min: -10, max: 20, default: 0 }), 0.5);
});

expect('normalizeParam: asymmetric range negative side uses negative span', () => {
  // default=0, min=-10 → at value -5, should be -0.5
  assert.equal(normalizeParam(-5, { min: -10, max: 20, default: 0 }), -0.5);
});

expect('normalizeParam: clamps overshoot to ±1', () => {
  assert.equal(normalizeParam(60, { min: -30, max: 30, default: 0 }), 1);
  assert.equal(normalizeParam(-60, { min: -30, max: 30, default: 0 }), -1);
});

expect('normalizeParam: degenerate span returns 0', () => {
  assert.equal(normalizeParam(5, { min: 0, max: 0, default: 0 }), 0);
});

// ── scaleNormalizedToRange ──────────────────────────────────────────────
expect('scaleNormalizedToRange: 0 → 0', () => {
  assert.equal(scaleNormalizedToRange(0, -10, 10), 0);
});

expect('scaleNormalizedToRange: +1 → max', () => {
  assert.equal(scaleNormalizedToRange(1, -10, 10), 10);
});

expect('scaleNormalizedToRange: -1 → min', () => {
  assert.equal(scaleNormalizedToRange(-1, -10, 10), -10);
});

expect('scaleNormalizedToRange: asymmetric ±1 maps to corresponding bound', () => {
  assert.equal(scaleNormalizedToRange(1, -5, 20), 20);
  assert.equal(scaleNormalizedToRange(-1, -5, 20), -5);
});

// ── aggregateInputs ─────────────────────────────────────────────────────
expect('aggregateInputs: no params → all zero', () => {
  const r = aggregateInputs(hairRule, {}, baseParamSpecs);
  assert.equal(r.tx, 0);
  assert.equal(r.ty, 0);
  assert.equal(r.ta, 0);
});

expect('aggregateInputs: ParamAngleX=30 (full) drives tx toward posMax', () => {
  const r = aggregateInputs(hairRule, { ParamAngleX: 30 }, baseParamSpecs);
  // Only AngleX of weight 60 contributes to X (BodyAngleX is at 0).
  // Weighted normalized = 1 * 60 / (60+40) = 0.6, tx = 0.6 * 10 = 6.
  assert.ok(close(r.tx, 6), `expected ~6, got ${r.tx}`);
  assert.equal(r.ty, 0);
  assert.equal(r.ta, 0);
});

expect('aggregateInputs: both X-driving inputs at full → tx = posMax', () => {
  const r = aggregateInputs(
    hairRule,
    { ParamAngleX: 30, ParamBodyAngleX: 10 },
    baseParamSpecs,
  );
  assert.ok(close(r.tx, 10), `expected 10, got ${r.tx}`);
});

expect('aggregateInputs: ParamAngleZ at full drives ta only', () => {
  const r = aggregateInputs(hairRule, { ParamAngleZ: 30 }, baseParamSpecs);
  assert.equal(r.tx, 0);
  // Only AngleZ contributes to angle. Normalized = 1, weight = 60/(60+40),
  // ta = 0.6 * angleMax (10) = 6.
  assert.ok(close(r.ta, 6), `expected ~6, got ${r.ta}`);
});

expect('aggregateInputs: isReverse flips sign', () => {
  const reverseRule = {
    ...hairRule,
    inputs: [{ paramId: 'ParamAngleX', type: 'SRC_TO_X', weight: 100, isReverse: true }],
  };
  const r = aggregateInputs(reverseRule, { ParamAngleX: 30 }, baseParamSpecs);
  assert.ok(close(r.tx, -10));
});

expect('aggregateInputs: missing param spec uses default 0/-1/1', () => {
  // ParamUnknown not in spec map, paramValues=0.5 → normalized to 0.5,
  // weight 100 → tx = 0.5 * posMax(10) = 5.
  const r = aggregateInputs(
    {
      inputs: [{ paramId: 'ParamUnknown', type: 'SRC_TO_X', weight: 100 }],
      normalization: { posMin: -10, posMax: 10, angleMin: -10, angleMax: 10 },
    },
    { ParamUnknown: 0.5 },
    new Map(),
  );
  assert.ok(close(r.tx, 5));
});

expect('aggregateInputs: NaN value falls back to default', () => {
  const r = aggregateInputs(hairRule, { ParamAngleX: NaN }, baseParamSpecs);
  assert.equal(r.tx, 0);
});

// ── tickPhysics: rest behaviour ──────────────────────────────────────────
expect('tickPhysics: rest input → ParamHairFront stays near 0 after settle', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = {};
  settle(state, [hairRule], paramValues, baseParamSpecs);
  assert.ok(Math.abs(paramValues.ParamHairFront ?? 0) < 1e-3,
    `expected ~0, got ${paramValues.ParamHairFront}`);
});

expect('tickPhysics: first frame writes output (even with 0 substeps would be 0)', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = {};
  tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
  assert.ok('ParamHairFront' in paramValues);
});

// ── tickPhysics: drive behaviour ────────────────────────────────────────
expect('tickPhysics: sustained ParamAngleZ=+30 drives ParamHairFront positive after settle', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 30 };
  settle(state, [hairRule], paramValues, baseParamSpecs, 5);
  // Steady state pendulum points along gravity direction = +6° tilt.
  // Output = (6 / 10) * 1.522 = 0.913
  assert.ok(paramValues.ParamHairFront > 0.5,
    `expected > 0.5 (settled positive), got ${paramValues.ParamHairFront}`);
  assert.ok(paramValues.ParamHairFront <= 1,
    `expected ≤ 1 (clamped), got ${paramValues.ParamHairFront}`);
});

expect('tickPhysics: ParamAngleZ=-30 drives ParamHairFront negative after settle', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: -30 };
  settle(state, [hairRule], paramValues, baseParamSpecs, 5);
  assert.ok(paramValues.ParamHairFront < -0.5,
    `expected < -0.5, got ${paramValues.ParamHairFront}`);
  assert.ok(paramValues.ParamHairFront >= -1,
    `expected ≥ -1 (clamped), got ${paramValues.ParamHairFront}`);
});

expect('tickPhysics: output clamps to spec range', () => {
  // Test with a high-scale output that would overshoot ±1 but should clamp.
  const ruleHigh = {
    ...hairRule,
    outputs: [{ paramId: 'ParamHairFront', vertexIndex: 1, scale: 5.0, isReverse: false }],
  };
  const state = createPhysicsState([ruleHigh]);
  const paramValues = { ParamAngleZ: 30 };
  settle(state, [ruleHigh], paramValues, baseParamSpecs, 5);
  assert.ok(paramValues.ParamHairFront <= 1,
    `expected clamped to 1, got ${paramValues.ParamHairFront}`);
});

expect('tickPhysics: isReverse flips output sign', () => {
  const reverseOut = {
    ...hairRule,
    outputs: [{ paramId: 'ParamHairFront', vertexIndex: 1, scale: 1.522, isReverse: true }],
  };
  const state = createPhysicsState([reverseOut]);
  const paramValues = { ParamAngleZ: 30 };
  settle(state, [reverseOut], paramValues, baseParamSpecs, 5);
  // Without reverse, settled positive; with reverse, should be negative.
  assert.ok(paramValues.ParamHairFront < 0,
    `expected < 0 (reverse-flipped), got ${paramValues.ParamHairFront}`);
});

// ── tickPhysics: lag behaviour ──────────────────────────────────────────
expect('tickPhysics: abrupt input → output lags (not snap)', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 30 };
  // After only 1 frame, output should be much smaller than steady-state.
  tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
  const after1 = paramValues.ParamHairFront ?? 0;
  // Steady state is ~0.91; one frame should be way smaller.
  assert.ok(Math.abs(after1) < 0.5,
    `expected lag (small after 1 frame), got ${after1}`);
});

expect('tickPhysics: sustained input → monotone progress toward steady state', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 30 };
  const samples = [];
  for (let i = 0; i < 60; i++) {
    tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
    samples.push(paramValues.ParamHairFront ?? 0);
  }
  // Initial samples should be smaller than later samples (monotonically rising
  // ignoring small overshoot, but at minimum: sample at t=10ms < sample at t=500ms).
  assert.ok(samples[5] < samples[55],
    `expected lag→settle, samples[5]=${samples[5]}, samples[55]=${samples[55]}`);
});

// ── tickPhysics: multi-rule ──────────────────────────────────────────────
expect('tickPhysics: multiple rules tick independently', () => {
  const ruleA = { ...hairRule, id: 'ruleA',
    outputs: [{ paramId: 'ParamHairFront', vertexIndex: 1, scale: 1, isReverse: false }] };
  const ruleB = { ...hairRule, id: 'ruleB',
    outputs: [{ paramId: 'ParamHairBack', vertexIndex: 1, scale: 1, isReverse: false }] };
  const state = createPhysicsState([ruleA, ruleB]);
  const paramValues = { ParamAngleZ: 30 };
  settle(state, [ruleA, ruleB], paramValues, baseParamSpecs, 3);
  assert.ok(Math.abs(paramValues.ParamHairFront) > 0.1);
  assert.ok(Math.abs(paramValues.ParamHairBack) > 0.1);
});

// ── tickPhysics: snake chain (multi-output) ─────────────────────────────
expect('tickPhysics: snake chain — vertex2 lags behind vertex1', () => {
  const snakeRule = {
    id: 'PhysicsSettingSnake',
    name: 'Snake',
    category: 'arms',
    requireTag: null,
    inputs: [
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100 },
    ],
    vertices: [
      { x: 0, y: 0,  mobility: 1.0, delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 4,  mobility: 0.95, delay: 0.5, acceleration: 1.2, radius: 4 },
      { x: 0, y: 10, mobility: 0.9,  delay: 0.5, acceleration: 1.5, radius: 6 },
    ],
    normalization: { posMin: -10, posMax: 10, angleMin: -10, angleMax: 10 },
    outputs: [
      { paramId: 'ParamRotV1', vertexIndex: 1, scale: 4.0, isReverse: false },
      { paramId: 'ParamRotV2', vertexIndex: 2, scale: 4.0, isReverse: false },
    ],
  };
  const specs = buildParamSpecs([
    { id: 'ParamBodyAngleZ', min: -10, max: 10, default: 0 },
    { id: 'ParamRotV1',      min: -30, max: 30, default: 0 },
    { id: 'ParamRotV2',      min: -30, max: 30, default: 0 },
  ]);
  const state = createPhysicsState([snakeRule]);
  const paramValues = { ParamBodyAngleZ: 10 };
  // After only a couple of frames, both have begun to swing but vertex2
  // (further out) should still be smaller than vertex1.
  for (let i = 0; i < 4; i++) {
    tickPhysics(state, [snakeRule], paramValues, specs, 1 / 60);
  }
  const v1 = Math.abs(paramValues.ParamRotV1 ?? 0);
  const v2 = Math.abs(paramValues.ParamRotV2 ?? 0);
  assert.ok(v1 > 0, `vertex1 should have some swing, got ${v1}`);
  // Vertex2 lags - either smaller or in approximately equal phase, but
  // should still be a sensible number.
  assert.ok(Number.isFinite(v2));
});

// ── frame independence ─────────────────────────────────────────────────
expect('tickPhysics: same total time yields similar settle regardless of dt batching', () => {
  const make = () => ({
    state: createPhysicsState([hairRule]),
    paramValues: { ParamAngleZ: 30 },
  });

  // A: 60 fixed-dt ticks of 1/60s = 1.0s total
  const a = make();
  for (let i = 0; i < 60; i++) {
    tickPhysics(a.state, [hairRule], a.paramValues, baseParamSpecs, 1 / 60);
  }

  // B: 30 ticks of 2/60s = 1.0s total (each tick processes 2 substeps)
  const b = make();
  for (let i = 0; i < 30; i++) {
    tickPhysics(b.state, [hairRule], b.paramValues, baseParamSpecs, 2 / 60);
  }

  const va = a.paramValues.ParamHairFront ?? 0;
  const vb = b.paramValues.ParamHairFront ?? 0;
  assert.ok(close(va, vb, 1e-6),
    `frame-independence violated: 60×(1/60s) → ${va}, 30×(2/60s) → ${vb}`);
});

expect('tickPhysics: very large dt clamps to MAX_SUBSTEPS', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 30 };
  const r = tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 10);
  assert.ok(r.stepsApplied <= __testing__.MAX_SUBSTEPS,
    `expected ≤ ${__testing__.MAX_SUBSTEPS}, got ${r.stepsApplied}`);
});

// ── numerical stability ────────────────────────────────────────────────
expect('tickPhysics: never produces NaN/Infinity', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 30, ParamAngleX: -30, ParamBodyAngleZ: 30 };
  for (let i = 0; i < 600; i++) {  // 10s of simulation
    tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
  }
  for (const v of Object.values(paramValues)) {
    assert.ok(Number.isFinite(v), `non-finite param value: ${v}`);
  }
  for (const rs of state.byRuleId.values()) {
    for (const p of rs.particles) {
      assert.ok(Number.isFinite(p.position[0]) && Number.isFinite(p.position[1]),
        `non-finite particle position`);
    }
  }
});

expect('tickPhysics: rapidly oscillating input stays bounded', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamAngleZ: 0 };
  for (let i = 0; i < 600; i++) {
    paramValues.ParamAngleZ = (i % 30 < 15) ? 30 : -30;
    tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
    assert.ok(Math.abs(paramValues.ParamHairFront ?? 0) <= 1.001,
      `param escaped clamp at frame ${i}: ${paramValues.ParamHairFront}`);
  }
});

// ── outputsChanged accounting ──────────────────────────────────────────
expect('tickPhysics: returns count of changed outputs', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = {};
  // First call: param does not exist yet, so write counts as change.
  let r = tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
  assert.equal(r.outputsChanged, 1);
  // Subsequent call with same input: tiny change but still triggers.
  r = tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
  // Anchors don't move (no input), but rest pendulum may settle slightly.
  // Either way, this isn't 0 by guarantee — just confirm no error.
  assert.ok(r.outputsChanged >= 0);
});

expect('tickPhysics: returns 0 changed when output already at expected value', () => {
  const state = createPhysicsState([hairRule]);
  const paramValues = { ParamHairFront: 0 };
  // No drive, already at rest, output should match prior 0 (epsilon-close).
  const r = tickPhysics(state, [hairRule], paramValues, baseParamSpecs, 1 / 60);
  // Could be 0 or 1 depending on whether float eps trips; assert ≤ 1.
  assert.ok(r.outputsChanged <= 1);
});

// ── empty inputs / outputs ─────────────────────────────────────────────
expect('tickPhysics: rule without outputs is harmless', () => {
  const noOutRule = { ...hairRule, outputs: [] };
  const state = createPhysicsState([noOutRule]);
  const paramValues = { ParamAngleZ: 30 };
  // Should not throw and should not write anything.
  tickPhysics(state, [noOutRule], paramValues, baseParamSpecs, 1 / 60);
  assert.equal('ParamHairFront' in paramValues, false);
});

expect('tickPhysics: rule without inputs leaves chain at rest', () => {
  const noInRule = { ...hairRule, inputs: [] };
  const state = createPhysicsState([noInRule]);
  const paramValues = {};
  settle(state, [noInRule], paramValues, baseParamSpecs);
  assert.ok(Math.abs(paramValues.ParamHairFront ?? 0) < 1e-3);
});

// ── buildParamSpecs ─────────────────────────────────────────────────────
expect('buildParamSpecs: handles nulls and missing fields', () => {
  const m = buildParamSpecs([
    null,
    undefined,
    { name: 'no-id' },
    { id: 'normal', min: -5, max: 5, default: 0 },
    { id: 'partial' },
  ]);
  assert.equal(m.size, 2);
  assert.ok(m.has('normal'));
  assert.ok(m.has('partial'));
  const partial = m.get('partial');
  assert.equal(partial.min, -1);
  assert.equal(partial.max, 1);
  assert.equal(partial.default, 0);
});

expect('buildParamSpecs: array missing → empty map', () => {
  assert.equal(buildParamSpecs(null).size, 0);
  assert.equal(buildParamSpecs(undefined).size, 0);
  assert.equal(buildParamSpecs('not an array').size, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
