#!/usr/bin/env node
// Phase 2b Stage 1 — Slope vs FD-probed J⁻¹ measurement.
//
// For each rotation deformer with a warp parent, computes:
//   - the cascaded-normaliser slope today's chainEval bakes into the
//     rotation matrix as `diag(slopeX, slopeY)`
//   - the actual inverse Jacobian J⁻¹ of the parent warp's bilerp at
//     the rotation's pivot, FD-probed via cache.evalChainAtPoint
//   - the elementwise + Frobenius difference between the two
//
// Runs across the three plan-mandated fixtures:
//   default               — rest pose; if slope ≠ J⁻¹ here ⇒ P1
//   AngleZ_pos30          — current 9.45 px PARAM signal
//   BodyAngleX_pos10      — yesterday's regression victim (P3 indicator)
//
// Output is a structured table per fixture per rotation, one block of
// numbers per rotation, easy to compare with text tools.

if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = class StubBlob {
    constructor(parts, opts) { this.parts = parts; this.type = opts?.type ?? ''; }
  };
}
if (typeof globalThis.URL === 'undefined' || !globalThis.URL.createObjectURL) {
  if (!globalThis.URL) globalThis.URL = {};
  globalThis.URL.createObjectURL = () => 'stub://harness';
  globalThis.URL.revokeObjectURL = () => {};
}

import fs from 'node:fs';
import path from 'node:path';
import { importCmo3 } from '../../src/io/live2d/cmo3Import.js';
import { initializeRigFromProject } from '../../src/io/live2d/rig/initRig.js';
import { DeformerStateCache } from '../../src/io/live2d/runtime/evaluator/chainEval.js';
import { evalRotation } from '../../src/io/live2d/runtime/evaluator/rotationEval.js';
import { cellSelect } from '../../src/io/live2d/runtime/evaluator/cellSelect.js';

const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const SNAPSHOTS_DIR = path.join(REPO_ROOT, 'scripts/cubism_oracle/snapshots/shelby_runtime');
const CMO3_PATH = path.join(REPO_ROOT, 'shelby.cmo3');
const FIXTURES = ['default', 'AngleZ_pos30', 'AngleZ_neg30', 'BodyAngleX_pos10', 'BodyAngleX_neg10'];

const FD_EPS = 0.01; // matches FD_PROBE_EPS in chainEval.js

function findFixturePath(name) {
  const files = fs.readdirSync(SNAPSHOTS_DIR);
  const match = files.find(f => f === `${name}.json` || f.startsWith(`${name}__`));
  return match ? path.join(SNAPSHOTS_DIR, match) : null;
}

function fmt(n, w = 10, p = 6) {
  if (!Number.isFinite(n)) return String(n).padStart(w);
  return n.toFixed(p).padStart(w);
}

function inv2(m) {
  const a = m[0], b = m[1], c = m[2], d = m[3];
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return null;
  const inv = 1 / det;
  return [d * inv, -b * inv, -c * inv, a * inv];
}

function frobeniusDiff(m1, m2) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const d = m1[i] - m2[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function frobeniusNorm(m) {
  let s = 0;
  for (let i = 0; i < 4; i++) s += m[i] * m[i];
  return Math.sqrt(s);
}

async function main() {
  if (!fs.existsSync(CMO3_PATH)) {
    console.error(`[error] cmo3 not found at ${CMO3_PATH}`);
    process.exit(1);
  }
  const bytes = fs.readFileSync(CMO3_PATH);
  const result = await importCmo3(bytes);
  const project = result.project;
  const harvest = await initializeRigFromProject(project, new Map());
  const rigSpec = harvest.rigSpec;

  // Filter rotation deformers that have a warp parent (the only ones
  // that hit the slope conversion in chainEval's getState).
  const warpRotations = (rigSpec.rotationDeformers ?? []).filter(r => r.parent?.type === 'warp');
  if (warpRotations.length === 0) {
    console.error('[error] shelby has no warp-parented rotations — measurement is moot');
    process.exit(1);
  }

  console.log('# Stage 1 — Slope vs FD-probed J⁻¹ (warp-parented rotations)');
  console.log(`#   cmo3:     ${path.relative(REPO_ROOT, CMO3_PATH)}`);
  console.log(`#   FD eps:   ${FD_EPS} (in warp's 0..1 frame)`);
  console.log(`#   warp-parented rotations: ${warpRotations.map(r => r.id).join(', ')}`);
  console.log();

  for (const fixture of FIXTURES) {
    const fpath = findFixturePath(fixture);
    if (!fpath) {
      console.log(`## ${fixture}  <NOT FOUND in ${SNAPSHOTS_DIR}>`);
      console.log();
      continue;
    }
    const oracle = JSON.parse(fs.readFileSync(fpath, 'utf8'));
    const paramValues = { ...(oracle.applied_parameters ?? {}) };

    // Build a cache for this fixture's params.
    const cache = new DeformerStateCache(rigSpec, paramValues);

    console.log(`## ${fixture}`);
    console.log(`   params: ${JSON.stringify(paramValues) || '(rest)'}`);
    console.log(`   cache slopeX=${fmt(cache._warpSlopeX, 10)}  slopeY=${fmt(cache._warpSlopeY, 10)}`);
    console.log();

    for (const rspec of warpRotations) {
      // Get the rotation's evaluated origin (which is what chainEval
      // bakes into the matrix translation). Origin is in warp's 0..1
      // frame for warp-parented rotations.
      const cell = cellSelect(rspec.bindings ?? [], paramValues);
      const r = evalRotation(rspec, cell);
      if (!r) continue;
      const ox = r.originX ?? 0;
      const oy = r.originY ?? 0;

      // FD probe via the WARP parent (which uses lifted-grid bilerp,
      // producing canvas-px output). Step in warp's 0..1 frame.
      const warpRef = { type: 'warp', id: rspec.parent.id };
      const p0 = cache.evalChainAtPoint(warpRef, ox, oy);
      const p0x = p0[0], p0y = p0[1];
      const px = cache.evalChainAtPoint(warpRef, ox + FD_EPS, oy);
      const pxx = px[0], pxy = px[1];
      const py = cache.evalChainAtPoint(warpRef, ox, oy + FD_EPS);
      const pyx = py[0], pyy = py[1];

      // J = ∂(canvas-px) / ∂(warp 0..1).  Column-major:
      //   J[:,0] = (px - p0)/ε    (∂P/∂warpX)
      //   J[:,1] = (py - p0)/ε    (∂P/∂warpY)
      // Stored as [J00, J01, J10, J11] (row-major, M[i*2+j] = ∂P_i/∂w_j).
      const J = [
        (pxx - p0x) / FD_EPS, (pyx - p0x) / FD_EPS,
        (pxy - p0y) / FD_EPS, (pyy - p0y) / FD_EPS,
      ];
      const Jinv = inv2(J);
      const slopeMat = [cache._warpSlopeX, 0, 0, cache._warpSlopeY];

      console.log(`  ${rspec.id}  parent=warp/${rspec.parent.id}`);
      console.log(`    pivot (warp 0..1):     (${fmt(ox, 10)}, ${fmt(oy, 10)})`);
      console.log(`    pivot canvas-px:       (${fmt(p0x, 10, 2)}, ${fmt(p0y, 10, 2)})`);
      console.log(`    J  (warp Δ → canvas Δ):`);
      console.log(`      [ ${fmt(J[0], 10, 1)} ${fmt(J[1], 10, 1)} ]`);
      console.log(`      [ ${fmt(J[2], 10, 1)} ${fmt(J[3], 10, 1)} ]`);
      if (Jinv) {
        console.log(`    J⁻¹ (canvas Δ → warp Δ):`);
        console.log(`      [ ${fmt(Jinv[0], 12, 8)} ${fmt(Jinv[1], 12, 8)} ]`);
        console.log(`      [ ${fmt(Jinv[2], 12, 8)} ${fmt(Jinv[3], 12, 8)} ]`);
        console.log(`    diag(slope) used today:`);
        console.log(`      [ ${fmt(slopeMat[0], 12, 8)} ${fmt(slopeMat[1], 12, 8)} ]`);
        console.log(`      [ ${fmt(slopeMat[2], 12, 8)} ${fmt(slopeMat[3], 12, 8)} ]`);
        const diff = frobeniusDiff(Jinv, slopeMat);
        const norm = frobeniusNorm(Jinv);
        const relErr = norm > 1e-30 ? diff / norm : NaN;
        console.log(`    Frobenius( J⁻¹ - diag(slope) ) = ${fmt(diff, 10, 8)}  (${(relErr * 100).toFixed(1)}% of |J⁻¹|)`);
        // Per-element ratios for the diagonal.
        const ratX = Math.abs(slopeMat[0]) > 1e-30 ? Jinv[0] / slopeMat[0] : NaN;
        const ratY = Math.abs(slopeMat[3]) > 1e-30 ? Jinv[3] / slopeMat[3] : NaN;
        console.log(`    diag ratio: J⁻¹[0,0]/slopeX=${fmt(ratX, 8, 4)}  J⁻¹[1,1]/slopeY=${fmt(ratY, 8, 4)}`);
        // Off-diagonal (should be 0 for diag-approx; non-zero ⇒ rotation/shear in J⁻¹).
        const offMag = Math.hypot(Jinv[1], Jinv[2]);
        const onMag  = Math.hypot(Jinv[0], Jinv[3]);
        console.log(`    off-diagonal magnitude in J⁻¹: ${fmt(offMag, 12, 8)}  (${onMag > 1e-30 ? (offMag / onMag * 100).toFixed(1) : 'NaN'}% of diagonal)`);
      } else {
        console.log(`    J is singular — cannot invert`);
      }
      console.log();
    }
  }
}

main().catch(err => {
  console.error('[measure_jacobian] failed:', err);
  process.exit(1);
});
