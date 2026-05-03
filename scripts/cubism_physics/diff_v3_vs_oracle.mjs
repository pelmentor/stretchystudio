/**
 * Cubism Physics Port — Phase 0 oracle harness.
 *
 * Drives both sides on the same `physics3.json` + scripted parameter sequence
 * and reports per-frame, per-output-param divergence.
 *
 * Sides:
 *  - v3: src/io/live2d/runtime/physicsTick.js (hand-rolled verlet)
 *  - oracle: scripts/cubism_physics/oracle/cubismPhysicsOracle.mjs
 *           (hand-transcribed Cubism Web Framework CubismPhysics)
 *
 * Driver fixtures (10): isolated head/body sweeps, sustained drives, breath
 * cycle, combined drive, step input, rest. See `FIXTURES` below.
 *
 * Usage:
 *   node scripts/cubism_physics/diff_v3_vs_oracle.mjs                   # default = shelby
 *   node scripts/cubism_physics/diff_v3_vs_oracle.mjs --json=<path>     # any physics3.json
 *   node scripts/cubism_physics/diff_v3_vs_oracle.mjs --fixture=<name>  # single fixture
 *   node scripts/cubism_physics/diff_v3_vs_oracle.mjs --verbose         # per-frame trace
 *
 * Plan: docs/live2d-export/CUBISM_PHYSICS_PORT.md
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CubismPhysicsOracle } from './oracle/cubismPhysicsOracle.mjs';
import { parsePhysics3Json } from '../../src/io/live2d/physics3jsonImport.js';
import { tickPhysics, createPhysicsState, buildParamSpecs, setPhysicsKernel, getPhysicsKernel } from '../../src/io/live2d/runtime/physicsTick.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');

// -------------------- CLI --------------------

const args = process.argv.slice(2);
function arg(name) {
  const pref = `--${name}=`;
  for (const a of args) if (a.startsWith(pref)) return a.slice(pref.length);
  return null;
}
const VERBOSE = args.includes('--verbose');
const JSON_PATH = arg('json') ?? resolve(ROOT, 'New Folder', 'shelby.physics3.json');
const KERNEL = arg('kernel');
if (KERNEL === 'v3-legacy' || KERNEL === 'cubism-port') setPhysicsKernel(KERNEL);
console.log(`# active v3 kernel: ${getPhysicsKernel()}`);
const FIXTURE_FILTER = arg('fixture');

// -------------------- driver fixtures --------------------

const DT = 1 / 60;          // host frame dt
const SECS = 4.0;            // fixture length
const FRAMES = Math.floor(SECS / DT);

/**
 * Each fixture is a per-frame param-value generator. `paramOf(t)` returns
 * an object of {paramId: number} for that point in time.
 */
const FIXTURES = [
  { name: 'rest', driveDescription: 'all params held at default for 4s', paramOf: (t) => ({}) },

  { name: 'angleX_step',  driveDescription: 'ParamAngleX held at +30 for 4s',          paramOf: () => ({ ParamAngleX: 30 }) },
  { name: 'angleX_sweep', driveDescription: 'ParamAngleX 0→30→0→-30→0 over 4s',         paramOf: (t) => ({ ParamAngleX: triangleWave(t, 4.0, 30) }) },

  { name: 'bodyAngleX_step',  driveDescription: 'ParamBodyAngleX held at +10 for 4s', paramOf: () => ({ ParamBodyAngleX: 10 }) },
  { name: 'bodyAngleZ_sweep', driveDescription: 'ParamBodyAngleZ 0→10→0→-10→0 over 4s', paramOf: (t) => ({ ParamBodyAngleZ: triangleWave(t, 4.0, 10) }) },
  { name: 'bodyAngleY_sustained', driveDescription: 'ParamBodyAngleY = 10 sustained',  paramOf: () => ({ ParamBodyAngleY: 10 }) },

  { name: 'breath_cycle', driveDescription: 'ParamBreath sin(2πt/2.5) ∈ [0..1]',
    paramOf: (t) => ({ ParamBreath: 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 2.5) }) },

  { name: 'combined_head_body', driveDescription: 'ParamAngleX triangle ±30 + ParamBodyAngleZ ramp',
    paramOf: (t) => ({ ParamAngleX: triangleWave(t, 4.0, 30), ParamBodyAngleZ: 10 * (t / SECS) }) },

  { name: 'angle_step_jump', driveDescription: 'ParamAngleX = 0 for 1s, then +30 step, hold for 3s',
    paramOf: (t) => ({ ParamAngleX: t < 1.0 ? 0 : 30 }) },

  { name: 'extreme_drive', driveDescription: 'ParamAngleX = ±30 (full range) at 2 Hz',
    paramOf: (t) => ({ ParamAngleX: 30 * Math.sign(Math.sin(2 * Math.PI * 2 * t)) }) },
];

function triangleWave(t, period, amp) {
  const phase = (t / period) * 4;
  if (phase < 1) return amp * phase;
  if (phase < 3) return amp * (2 - phase);
  return amp * (phase - 4);
}

// -------------------- shared setup --------------------

console.log(`# Cubism Physics Oracle Harness`);
console.log(`# physics3.json: ${JSON_PATH}`);
const jsonText = readFileSync(JSON_PATH, 'utf8');
const json = JSON.parse(jsonText);

// 1. Parse rules into v3 shape via the existing importer.
const { rules: v3Rules, warnings } = parsePhysics3Json(jsonText);
if (warnings.length > 0) {
  console.log('# physics3.json importer warnings:');
  for (const w of warnings) console.log('#   ' + w);
}
console.log(`# rules parsed: ${v3Rules.length}`);

// 2. Collect all input + output param ids across all rules so we can build a
//    shared parameter pool for both sides.
const paramIdSet = new Set();
for (const r of v3Rules) {
  for (const inp of r.inputs) paramIdSet.add(inp.paramId);
  for (const out of r.outputs) paramIdSet.add(out.paramId);
}
const paramIds = Array.from(paramIdSet);
console.log(`# parameters: ${paramIds.length} (${paramIds.slice(0, 6).join(', ')}${paramIds.length > 6 ? ', …' : ''})`);

// Per-param spec (min/max/default). Use sensible Cubism defaults if not
// authored. Real physics3.json doesn't carry param specs, so this is the
// same gap on both sides.
const paramSpecs = new Map();
const SPEC_OVERRIDES = {
  ParamAngleX: { min: -30, max: 30, default: 0 },
  ParamAngleY: { min: -30, max: 30, default: 0 },
  ParamAngleZ: { min: -30, max: 30, default: 0 },
  ParamBodyAngleX: { min: -10, max: 10, default: 0 },
  ParamBodyAngleY: { min: -10, max: 10, default: 0 },
  ParamBodyAngleZ: { min: -10, max: 10, default: 0 },
  ParamBreath: { min: 0, max: 1, default: 0 },
};
for (const id of paramIds) {
  paramSpecs.set(id, SPEC_OVERRIDES[id] ?? { min: -1, max: 1, default: 0 });
}

// -------------------- per-fixture run --------------------

const results = [];
for (const fix of FIXTURES) {
  if (FIXTURE_FILTER && fix.name !== FIXTURE_FILTER) continue;

  // --- v3 side ---
  const v3State = createPhysicsState(v3Rules);
  const v3ParamValues = {};
  for (const id of paramIds) v3ParamValues[id] = paramSpecs.get(id).default;

  // --- oracle side ---
  const oracle = new CubismPhysicsOracle();
  oracle.setRig(json);
  // Build pool in stable order.
  const poolValues = new Float32Array(paramIds.length);
  const poolMin    = new Float32Array(paramIds.length);
  const poolMax    = new Float32Array(paramIds.length);
  const poolDef    = new Float32Array(paramIds.length);
  for (let i = 0; i < paramIds.length; i++) {
    const sp = paramSpecs.get(paramIds[i]);
    poolValues[i] = sp.default;
    poolMin[i] = sp.min;
    poolMax[i] = sp.max;
    poolDef[i] = sp.default;
  }
  oracle.setParameterPool({ ids: paramIds, values: poolValues, minimumValues: poolMin, maximumValues: poolMax, defaultValues: poolDef });

  // --- per-frame stepping ---
  const outputIds = new Set();
  for (const r of v3Rules) for (const o of r.outputs) outputIds.add(o.paramId);

  // Per-output divergence accumulators
  const divPerOut = {};
  for (const id of outputIds) divPerOut[id] = { max: 0, sum: 0, n: 0, lastV3: 0, lastOracle: 0 };

  let traceFrames = [];
  for (let f = 0; f < FRAMES; f++) {
    const t = f * DT;
    const drive = fix.paramOf(t);

    // Set drive params on both sides.
    for (const k of Object.keys(drive)) {
      v3ParamValues[k] = drive[k];
      const idx = paramIds.indexOf(k);
      if (idx !== -1) poolValues[idx] = drive[k];
    }

    // Step v3.
    tickPhysics(v3State, v3Rules, v3ParamValues, paramSpecs, DT);
    // Step oracle.
    oracle.evaluate(DT);

    // Compare outputs.
    for (const id of outputIds) {
      const v3v = v3ParamValues[id] ?? 0;
      const idx = paramIds.indexOf(id);
      const orv = idx === -1 ? 0 : poolValues[idx];
      const d = Math.abs(v3v - orv);
      const acc = divPerOut[id];
      acc.max = Math.max(acc.max, d);
      acc.sum += d;
      acc.n += 1;
      acc.lastV3 = v3v;
      acc.lastOracle = orv;
    }

    if (VERBOSE && (f % 30 === 0 || f === FRAMES - 1)) {
      const driveStr = Object.entries(drive).map(([k, v]) => `${k}=${(+v).toFixed(2)}`).join(' ');
      const outsStr = Array.from(outputIds).slice(0, 3).map(id => {
        const v3v = v3ParamValues[id] ?? 0;
        const idx = paramIds.indexOf(id);
        const orv = idx === -1 ? 0 : poolValues[idx];
        return `${id}: v3=${v3v.toFixed(4)} or=${orv.toFixed(4)} Δ=${(v3v - orv).toFixed(4)}`;
      }).join('  ');
      traceFrames.push(`    t=${t.toFixed(2)}s [${driveStr}]  ${outsStr}`);
    }
  }

  results.push({ fixture: fix, divPerOut, traceFrames });
}

// -------------------- report --------------------

console.log('');
console.log('=== Per-fixture, per-output divergence (|v3 - oracle|) ===');
console.log('');
console.log('fixture                       output                            max         mean       finalV3      finalOr');
console.log('------------------------------------------------------------------------------------------------------------');
let worstMax = 0;
let worstRow = null;
for (const r of results) {
  for (const [id, acc] of Object.entries(r.divPerOut)) {
    const meanDiv = acc.n > 0 ? acc.sum / acc.n : 0;
    const row = [
      r.fixture.name.padEnd(30),
      id.padEnd(33),
      acc.max.toFixed(6).padStart(11),
      meanDiv.toFixed(6).padStart(11),
      acc.lastV3.toFixed(6).padStart(11),
      acc.lastOracle.toFixed(6).padStart(11),
    ].join(' ');
    console.log(row);
    if (acc.max > worstMax) {
      worstMax = acc.max;
      worstRow = `${r.fixture.name} / ${id}`;
    }
  }
}
console.log('');
console.log(`Worst divergence: ${worstMax.toFixed(6)} (${worstRow})`);
console.log(`Threshold for "match": < 1e-4`);
console.log('');
if (worstMax < 1e-4) {
  console.log('VERDICT: v3 ≈ oracle within float32 noise floor. Phase 1 port is unnecessary.');
} else if (worstMax < 1e-2) {
  console.log('VERDICT: small divergence. Needs investigation; a real port is probably overkill.');
} else if (worstMax < 1.0) {
  console.log('VERDICT: meaningful divergence. Phase 1 port is justified.');
} else {
  console.log('VERDICT: large divergence. Phase 1 port is required.');
}

if (VERBOSE) {
  console.log('');
  console.log('=== Per-fixture traces ===');
  for (const r of results) {
    console.log(`\n  ${r.fixture.name} — ${r.fixture.driveDescription}`);
    for (const line of r.traceFrames) console.log(line);
  }
}
