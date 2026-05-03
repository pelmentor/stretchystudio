/**
 * Auto-rig defaults audit — magnitude comparison v3-legacy vs cubism-port.
 *
 * The auto-rig defaults at `src/io/live2d/cmo3/physics.js:PHYSICS_RULES` were
 * tuned for v3's legacy verlet kernel. After the Cubism Physics Port (Phases
 * 0/1/2 shipped 2026-05-03), the same `outputScale` field semantically means
 * different things in each kernel:
 *
 *   - v3-legacy:    output = (pendulum_angle_degrees / angleMax) * scale
 *   - cubism-port:  output = pendulum_angle_radians * scale
 *
 * Same pendulum tilt → ~5.7× smaller magnitude under cubism-port for
 * SRC_TO_G_ANGLE outputs (the dominant case in the defaults).
 *
 * This script runs each default rule under BOTH kernels with a representative
 * drive and reports the steady-state magnitude difference, so the user can
 * decide if defaults need re-tuning during the Phase 3 visual sweep with
 * Cubism Viewer side-by-side.
 *
 * Usage:
 *   node scripts/cubism_physics/compare_defaults.mjs
 *   npm run audit:physics-defaults
 */

import { PHYSICS_RULES } from '../../src/io/live2d/cmo3/physics.js';
import {
  createPhysicsState, tickPhysics, buildParamSpecs,
  setPhysicsKernel, getPhysicsKernel,
} from '../../src/io/live2d/runtime/physicsTick.js';

// -------------------- rule resolution --------------------

/**
 * Resolve `outputParamId + outputScale` (legacy single-output) and `boneOutputs`
 * (multi-output via bone roles) into flat `outputs[]`. Mirrors
 * `physicsConfig.resolveRuleOutputs` but synthesises standard bone names
 * directly so we don't need a real project.
 */
function resolveRule(rule) {
  const outputs = [];
  if (rule.outputs && rule.outputs.length > 0) {
    for (const o of rule.outputs) {
      outputs.push({ paramId: o.paramId, vertexIndex: o.vertexIndex, scale: o.scale, isReverse: !!o.isReverse });
    }
  } else if (rule.outputParamId) {
    outputs.push({
      paramId: rule.outputParamId,
      vertexIndex: rule.vertices.length - 1,
      scale: rule.outputScale,
      isReverse: false,
    });
  }
  if (rule.boneOutputs) {
    for (const b of rule.boneOutputs) {
      // Synthesise canonical bone names — this is what
      // `sanitisePartName(group.name)` produces for the standard rig.
      const sanitized = b.boneRole === 'leftElbow' ? 'leftElbow' : b.boneRole === 'rightElbow' ? 'rightElbow' : b.boneRole;
      outputs.push({
        paramId: `ParamRotation_${sanitized}`,
        vertexIndex: b.vertexIndex,
        scale: b.scale,
        isReverse: !!b.isReverse,
      });
    }
  }
  return {
    id: rule.id,
    name: rule.name,
    category: rule.category,
    inputs: rule.inputs.map(i => ({ ...i })),
    vertices: rule.vertices.map(v => ({ ...v })),
    normalization: { ...rule.normalization },
    outputs,
  };
}

// -------------------- spec map --------------------

const SPEC_DEFAULTS = {
  ParamAngleX: { min: -30, max: 30, default: 0 },
  ParamAngleY: { min: -30, max: 30, default: 0 },
  ParamAngleZ: { min: -30, max: 30, default: 0 },
  ParamBodyAngleX: { min: -10, max: 10, default: 0 },
  ParamBodyAngleY: { min: -10, max: 10, default: 0 },
  ParamBodyAngleZ: { min: -10, max: 10, default: 0 },
};
const OUTPUT_SPEC = { min: -1, max: 1, default: 0 };
const ROTATION_SPEC = { min: -30, max: 30, default: 0 };

function buildSpecs(rules) {
  const all = new Set();
  for (const r of rules) {
    for (const i of r.inputs) all.add(i.paramId);
    for (const o of r.outputs) all.add(o.paramId);
  }
  const list = [];
  for (const id of all) {
    if (id in SPEC_DEFAULTS) list.push({ id, ...SPEC_DEFAULTS[id] });
    else if (id.startsWith('ParamRotation_')) list.push({ id, ...ROTATION_SPEC });
    else list.push({ id, ...OUTPUT_SPEC });
  }
  return buildParamSpecs(list);
}

// -------------------- per-rule drive --------------------

/**
 * Pick the most-weighted input for a rule and drive it to its spec maximum.
 * That's the closest thing to a "representative" steady-state stress test.
 */
function pickDriver(rule) {
  let best = null;
  for (const inp of rule.inputs) {
    if (best === null || inp.weight > best.weight) best = inp;
  }
  return best;
}

const DT = 1 / 60;
const SETTLE_SECONDS = 5;

function runOneStatic(rule, kernel, paramSpecs) {
  setPhysicsKernel(kernel);
  const state = createPhysicsState([rule]);
  const driver = pickDriver(rule);
  const driveSpec = SPEC_DEFAULTS[driver.paramId] ?? { min: -10, max: 10, default: 0 };
  const driveValue = driveSpec.max;
  const paramValues = { [driver.paramId]: driveValue };

  for (let i = 0; i < Math.ceil(SETTLE_SECONDS / DT); i++) {
    tickPhysics(state, [rule], paramValues, paramSpecs, DT);
  }

  const result = { driver: driver.paramId, driveValue, outputs: {} };
  for (const out of rule.outputs) {
    result.outputs[out.paramId] = paramValues[out.paramId] ?? 0;
  }
  return result;
}

/**
 * Dynamic drive: sin wave on the highest-weighted driver at 0.5 Hz, 4s,
 * captures peak magnitude (most representative of real character motion).
 */
function runOneDynamic(rule, kernel, paramSpecs) {
  setPhysicsKernel(kernel);
  const state = createPhysicsState([rule]);
  const driver = pickDriver(rule);
  const driveSpec = SPEC_DEFAULTS[driver.paramId] ?? { min: -10, max: 10, default: 0 };
  const peakDrive = driveSpec.max;
  const paramValues = { [driver.paramId]: 0 };

  const peaks = {};
  for (const out of rule.outputs) peaks[out.paramId] = 0;

  const FRAMES = Math.ceil(4.0 / DT);
  for (let i = 0; i < FRAMES; i++) {
    const t = i * DT;
    paramValues[driver.paramId] = peakDrive * Math.sin(2 * Math.PI * 0.5 * t);
    tickPhysics(state, [rule], paramValues, paramSpecs, DT);
    for (const out of rule.outputs) {
      const v = paramValues[out.paramId] ?? 0;
      if (Math.abs(v) > Math.abs(peaks[out.paramId])) peaks[out.paramId] = v;
    }
  }
  return { driver: driver.paramId, driveValue: peakDrive, outputs: peaks };
}

// -------------------- main --------------------

const resolvedRules = PHYSICS_RULES.map(resolveRule);
const paramSpecs = buildSpecs(resolvedRules);

console.log('Auto-rig defaults — magnitude under v3-legacy vs cubism-port');
console.log('');
console.log('STATIC: highest-weighted input held at spec.max for 5s; reports settled value.');
console.log('DYNAMIC: same input as a 0.5 Hz sine ±spec.max for 4s; reports peak magnitude.');
console.log('');
console.log('rule                   driver               output                          static-legacy  static-port  dyn-legacy   dyn-port  legacy/port');
console.log('--------------------------------------------------------------------------------------------------------------------------------');

const summary = [];
for (const rule of resolvedRules) {
  const sLegacy = runOneStatic(rule, 'v3-legacy', paramSpecs);
  const sPort   = runOneStatic(rule, 'cubism-port', paramSpecs);
  const dLegacy = runOneDynamic(rule, 'v3-legacy', paramSpecs);
  const dPort   = runOneDynamic(rule, 'cubism-port', paramSpecs);

  for (const outputParamId of Object.keys(sLegacy.outputs)) {
    const slv = sLegacy.outputs[outputParamId];
    const spv = sPort.outputs[outputParamId];
    const dlv = dLegacy.outputs[outputParamId];
    const dpv = dPort.outputs[outputParamId];
    // The dynamic peak is the meaningful "how much swing does the user see"
    // metric. Use it for the ratio.
    const ratio = Math.abs(dpv) > 1e-6 ? dlv / dpv : Infinity;
    const ratioStr = isFinite(ratio) ? ratio.toFixed(2).padStart(6) + 'x' : '   ∞ x';
    console.log([
      rule.name.padEnd(22),
      sLegacy.driver.padEnd(20),
      outputParamId.padEnd(28),
      slv.toFixed(4).padStart(13),
      spv.toFixed(4).padStart(13),
      dlv.toFixed(4).padStart(11),
      dpv.toFixed(4).padStart(11),
      '  ',
      ratioStr,
    ].join(' '));
    summary.push({ rule: rule.name, output: outputParamId, sLegacy: slv, sPort: spv, dLegacy: dlv, dPort: dpv, ratio });
  }
}

// -------------------- summary --------------------

console.log('');
console.log('Summary (using DYNAMIC peaks — most representative of real character motion):');
const ratios = summary.filter(s => isFinite(s.ratio) && s.ratio !== 0).map(s => Math.abs(s.ratio));
if (ratios.length > 0) {
  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  console.log(`  |legacy/port| ratio across ${ratios.length} outputs: min=${min.toFixed(2)}× max=${max.toFixed(2)}× mean=${mean.toFixed(2)}×`);
}

const clamped = summary.filter(s => Math.abs(s.dLegacy) >= 0.999);
if (clamped.length > 0) {
  console.log(`  legacy hit dynamic clamp (±1) on ${clamped.length}/${summary.length} outputs (true ratio is larger than measured):`);
  for (const c of clamped) console.log(`    - ${c.rule} / ${c.output}: legacy peak=${c.dLegacy.toFixed(4)} port peak=${c.dPort.toFixed(4)}`);
}

const sameSign = summary.filter(s => Math.sign(s.dLegacy) === Math.sign(s.dPort) || s.dLegacy === 0 || s.dPort === 0).length;
console.log(`  dynamic peaks have same sign on ${sameSign}/${summary.length} outputs.`);

console.log('');
console.log('Interpretation:');
console.log('  STATIC column shows steady-state. Cubism\'s algorithm correctly converges to');
console.log('    "chain hangs straight under gravity → angular delta = 0" for many cases.');
console.log('    v3-legacy verlet never fully damps and keeps showing residual values.');
console.log('  DYNAMIC column shows peak magnitude under realistic continuous drive.');
console.log('    This is what the user sees in the viewport.');
console.log('');
console.log('  Phase 3 visual sweep guidance:');
console.log('  - If Cubism Viewer matches the DYNAMIC-PORT peaks → defaults are correct as-is.');
console.log('  - If Cubism Viewer shows DYNAMIC-LEGACY-like peaks → multiply outputScale by ~ratio.');
console.log('  - The arm-sway defaults (ArmSnake → ParamRotation_*Elbow) need close inspection:');
console.log('    legacy hits ±4° easily; cubism-port produces tiny rotation.');
