// PHASE 0 GATE — Warp export spec-contract oracle.
//
// Part of the "Warps as first-class Lattice/Grid-Mesh Objects" refactor
// (docs/plans/WARP_AS_LATTICE_OBJECT_REFACTOR_PLAN.md). The refactor changes
// HOW warp specs are DERIVED (warp deformer node -> migrated grid-mesh object
// + per-part lattice modifier), but the Cubism WIRE FORMAT must not change.
//
// The moc3 warp sections (keyformAndDeformerSections.js) and the cmo3
// CWarpDeformerSource emission consume `rigSpec.warpDeformers` (the warpSpecs)
// produced by selectRigSpec. Those EMITTERS are not being refactored. So if
// the post-refactor pipeline (schema migration -> grid object -> refactored
// selectRigSpec) reproduces byte-identical `warpDeformers` for the same input
// model, the exported bytes are identical BY CONSTRUCTION.
//
// This oracle therefore pins the SPEC CONTRACT: a canonical serialization of
// selectRigSpec(project).warpDeformers + the body-warp normaliser closures
// (canvasToInnermostX/Y, derived from baseGrid bbox -- the localFrame /
// lifted-rest relocation is the migration's silent-corruption hazard).
//
// HOW TO USE ACROSS THE REFACTOR:
//   - BEFORE Phase 1: this captures the baseline hash (pinned below).
//   - AFTER each phase: the SAME model, expressed in whatever the current
//     schema is, must still hash identically. Phase 1 migration will rewrite
//     ORACLE_PROJECT into grid objects; update the BUILDER to emit the new
//     shape, but the EXPECTED_HASH must NOT change. A changed hash = a wire
//     format regression -> halt.
//
// Run: node scripts/test/test_warpExportOracle.mjs

import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';
import { migrateLatticeSubstrate } from '../../src/store/migrations/v43_lattice_substrate.js';
import { fnv1aHashBuffer } from '../byteFidelity/byteFidelityHarness.mjs';

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// ── Representative warp model ─────────────────────────────────────────
//
// Exercises every warp facet the refactor + migration must preserve:
//   - a 2-deep warp chain (BodyZ -> BodyY) to pin parent resolution
//   - non-trivial baseGrid values (catches grid<->mesh-vert reordering)
//   - all three localFrame values (canvas-px / normalized-0to1 /
//     pivot-relative) -- the relocation flagged as the silent-corruption risk
//   - a 2D keyform grid (keyTuple length 2) with several keyforms
//   - per-mesh rigWarp metadata (targetPartId + canvasBbox)
//   - an explicit gridSize that is NOT the 5x5 default (4x6)

const GRID_ROWS = 4;
const GRID_COLS = 6;
const GRID_PTS = (GRID_ROWS + 1) * (GRID_COLS + 1); // 35 points -> 70 floats

// Deterministic, spread-out baseGrid so a bbox is well-defined (not all-zero).
function makeBaseGrid(seed) {
  const out = new Array(GRID_PTS * 2);
  let r = 0;
  let c = 0;
  for (let i = 0; i < GRID_PTS; i++) {
    out[i * 2] = (c / GRID_COLS) * 400 + seed;          // x in [seed, 400+seed]
    out[i * 2 + 1] = (r / GRID_ROWS) * 300 + seed * 2;  // y in [2seed, 300+2seed]
    c++;
    if (c > GRID_COLS) { c = 0; r++; }
  }
  return out;
}
function makeKeyformPositions(scale) {
  const out = new Array(GRID_PTS * 2);
  for (let i = 0; i < GRID_PTS * 2; i++) out[i] = (i % 7) * scale - 3 * scale;
  return out;
}

function buildOracleProject() {
  return {
    schemaVersion: 28,
    canvas: { width: 1200, height: 1600 },
    parameters: [
      { id: 'ParamBodyAngleZ', min: -30, max: 30, defaultValue: 0 },
      { id: 'ParamBodyAngleY', min: -30, max: 30, defaultValue: 0 },
      { id: 'ParamBodyAngleX', min: -30, max: 30, defaultValue: 0 },
    ],
    nodes: [
      {
        id: 'BodyWarpZ', type: 'deformer', deformerKind: 'warp',
        name: 'Body Warp Z', parent: null, visible: true,
        gridSize: { rows: GRID_ROWS, cols: GRID_COLS },
        baseGrid: makeBaseGrid(50),
        localFrame: 'canvas-px',
        bindings: [{ parameterId: 'ParamBodyAngleZ', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
        keyforms: [
          { keyTuple: [-30], positions: makeKeyformPositions(2), opacity: 1 },
          { keyTuple: [0], positions: makeBaseGrid(50), opacity: 1 },
          { keyTuple: [30], positions: makeKeyformPositions(-2), opacity: 1 },
        ],
      },
      {
        id: 'BodyWarpY', type: 'deformer', deformerKind: 'warp',
        name: 'Body Warp Y', parent: 'BodyWarpZ', visible: true,
        gridSize: { rows: GRID_ROWS, cols: GRID_COLS },
        baseGrid: makeBaseGrid(10),
        localFrame: 'normalized-0to1',
        // 2D keyform grid (BodyAngleY x BodyAngleX).
        bindings: [
          { parameterId: 'ParamBodyAngleY', keys: [-30, 30], interpolation: 'LINEAR' },
          { parameterId: 'ParamBodyAngleX', keys: [-30, 30], interpolation: 'LINEAR' },
        ],
        keyforms: [
          { keyTuple: [-30, -30], positions: makeKeyformPositions(1), opacity: 1 },
          { keyTuple: [-30, 30], positions: makeKeyformPositions(1.5), opacity: 0.9 },
          { keyTuple: [30, -30], positions: makeKeyformPositions(-1), opacity: 1 },
          { keyTuple: [30, 30], positions: makeKeyformPositions(-1.5), opacity: 0.8 },
        ],
      },
      {
        // Per-mesh rigWarp with targetPartId + canvasBbox + pivot-relative frame.
        id: 'EyeRigWarp', type: 'deformer', deformerKind: 'warp',
        name: 'Eye Rig Warp', parent: 'BodyWarpY', visible: true,
        gridSize: { rows: 2, cols: 2 },
        baseGrid: new Array((2 + 1) * (2 + 1) * 2).fill(0).map((_, i) => i * 1.5 - 4),
        localFrame: 'pivot-relative',
        bindings: [{ parameterId: 'ParamBodyAngleX', keys: [-30, 30], interpolation: 'LINEAR' }],
        keyforms: [
          { keyTuple: [-30], positions: new Array(18).fill(0).map((_, i) => i - 9), opacity: 1 },
          { keyTuple: [30], positions: new Array(18).fill(0).map((_, i) => 9 - i), opacity: 1 },
        ],
        targetPartId: 'eyeballPart',
        canvasBbox: { minX: 100, minY: 200, maxX: 340, maxY: 380 },
      },
    ],
  };
}

// ── Canonical serialization ───────────────────────────────────────────
//
// Stable key order + Float64Array -> rounded-number-array so floating noise
// never flips the hash but a real value change does. 9 decimals is well below
// the 1e-4px parity tolerance the eval phase uses, so it can't mask drift.

function round9(x) {
  return Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : null;
}
function arr(a) {
  if (a == null) return null;
  const src = ArrayBuffer.isView(a) ? Array.from(a) : a;
  return src.map(round9);
}
function canonWarp(w) {
  return {
    id: w.id,
    name: w.name,
    parent: w.parent,
    gridSize: { rows: w.gridSize.rows, cols: w.gridSize.cols },
    localFrame: w.localFrame,
    isFloat64: w.baseGrid instanceof Float64Array,
    baseGrid: arr(w.baseGrid),
    bindings: (w.bindings ?? []).map((b) => ({
      parameterId: b.parameterId,
      keys: arr(b.keys),
      interpolation: b.interpolation,
    })),
    keyforms: (w.keyforms ?? []).map((k) => ({
      keyTuple: arr(k.keyTuple),
      kfFloat64: k.positions instanceof Float64Array,
      positions: arr(k.positions),
      opacity: round9(k.opacity),
    })),
    targetPartId: w.targetPartId ?? null,
    canvasBbox: w.canvasBbox ?? null,
  };
}

function canonClosure(fn, samples) {
  if (typeof fn !== 'function') return null;
  return samples.map((s) => round9(fn(s)));
}

function canonicalize(spec) {
  const samples = [0, 100, 300, 600, 1200];
  return JSON.stringify({
    warpDeformers: spec.warpDeformers.map(canonWarp),
    innermostBodyWarpId: spec.innermostBodyWarpId ?? null,
    canvasToInnermostX: canonClosure(spec.canvasToInnermostX, samples),
    canvasToInnermostY: canonClosure(spec.canvasToInnermostY, samples),
    canvas: spec.canvas,
  });
}

// ── The gate ──────────────────────────────────────────────────────────

// Exercise the Slice 1.B flip end-to-end: build the OLD warp-deformer-node
// shape, run the v43 lattice migration, then read it back through
// selectRigSpec. The hash MUST be unchanged from the pre-flip baseline —
// proof that the migration + the lattice read path are lossless.
const oracleProject = buildOracleProject();
migrateLatticeSubstrate(oracleProject);
const spec = selectRigSpec(oracleProject);

// Structural sanity (independent of the hash) so a hash mismatch can be
// triaged: is it a value drift, or did the spec shape collapse entirely?
assertEq(spec.warpDeformers.length, 3, 'oracle: 3 warps present');
assertEq(spec.warpDeformers[0].id, 'BodyWarpZ', 'oracle: warp 0 id');
assertEq(spec.warpDeformers[1].parent, { type: 'warp', id: 'BodyWarpZ' }, 'oracle: chain parent');
assertEq(spec.warpDeformers[2].parent, { type: 'warp', id: 'BodyWarpY' }, 'oracle: deep chain parent');
assert(spec.warpDeformers[0].baseGrid instanceof Float64Array, 'oracle: baseGrid is Float64Array');
assertEq(spec.warpDeformers[2].targetPartId, 'eyeballPart', 'oracle: targetPartId preserved');
assertEq(spec.warpDeformers[1].keyforms.length, 4, 'oracle: 2D keyform grid (4 keyforms)');

const canon = canonicalize(spec);
const hash = fnv1aHashBuffer(new TextEncoder().encode(canon));

// PINNED BASELINE — captured 2026-05-20 from the pre-refactor warp-node path.
// DO NOT regenerate this casually. A mismatch after the lattice refactor means
// the migrated model no longer produces the same warpSpecs => the exported
// Cubism bytes would diverge. Investigate the derivation, do not re-pin.
const EXPECTED_HASH = 'f50b6178';

if (EXPECTED_HASH === '__PENDING__') {
  console.log(`[oracle] captured canonical hash = ${hash}`);
  console.log('[oracle] paste this into EXPECTED_HASH to arm the gate.');
} else {
  assertEq(hash, EXPECTED_HASH, 'WARP EXPORT ORACLE — spec contract hash unchanged');
}

console.log(`\ntest_warpExportOracle: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
