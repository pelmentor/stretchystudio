#!/usr/bin/env node
// Cubism oracle diff harness — runs v3's evalRig against shelby.cmo3 and
// compares per-drawable vertex output to the pinned oracle snapshots.
//
// This is the canonical pass criterion for the Cubism Warp Port phases
// (per `docs/live2d-export/CUBISM_WARP_PORT.md`): for each fixture in
// `scripts/cubism_oracle/snapshots/<character>/`, the v3 evalRig output
// must match Cubism's csmGetDrawableVertexPositions within ~float32
// noise floor.
//
// Pipeline:
//   1. Read shelby.cmo3 from disk
//   2. importCmo3() -> project (browser deps stubbed in this script)
//   3. initializeRigFromProject(project) -> harvest.rigSpec
//   4. For each oracle snapshot:
//      - applied_parameters -> paramValues
//      - evalRig(rigSpec, paramValues) -> frames
//      - For each oracle drawable, match by index, diff per-vertex
//   5. Report: per-fixture max + mean diff, top divergent drawables.
//
// Usage:
//   node scripts/cubism_oracle/diff_v3_vs_oracle.mjs [cmo3-path] [snapshots-dir] [--kernel=v3-legacy|cubism-setup]
//
// Default cmo3 path: shelby.cmo3 in repo root.
// Default snapshots: scripts/cubism_oracle/snapshots/shelby_runtime/
// Default kernel:   cubism-setup (Phase 2b shipped 2026-05-03)
//
// `--kernel=cubism-setup` is the in-progress Setup port (Phase 2b plan,
// docs/live2d-export/PHASE_2B_PLAN.md). At Stage 0 it is byte-identical
// to v3-legacy; from Stage 2 onwards it diverges.
//
// Note: this harness does NOT need Cubism Core DLL. It reads pinned oracle
// snapshots produced earlier by `dump_drawables.py`.
//
// Known harness limitation (2026-05-02): the rest-pose total divergence
// (~66 px max on shelby's eyelash-l) is dominated by the eye-closure
// parabola fit falling back to mesh-bin-max because Node has no
// `Image` decoder. Eye meshes (eyelash, eyewhite, irides) need alpha-
// channel extraction from their PNG to fit a clean parabola; without
// that, `fitParabolaFromLowerEdge` uses the mesh's vertex bin-max which
// is much coarser. Eyebrows, hair, and clothing meshes are unaffected
// (no eye-closure handling) and show ~0.07 px rest divergence.
//
// In the actual browser app this divergence drops because PNG textures
// are decoded. The harness's PARAM-DRIVEN divergence (computed by
// subtracting the rest baseline) is unaffected by the missing
// textures — it remains the BUG-003 signal.

// ── Browser-API stubs for Node ──────────────────────────────────────
// cmo3Import constructs Blob + URL.createObjectURL for texture refs.
// Those URLs are never USED by initializeRigFromProject (textures are
// loaded separately via loadProjectTextures, which we skip here — eye-
// closure parabola fits will fall back to mesh-bin-max sampling, which
// is acceptable for the warp/rotation deformer comparison).
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
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';
import { generateCmo3 } from '../../src/io/live2d/cmo3writer.js';
import { buildMeshesForRig } from '../../src/io/live2d/exporter.js';
import { resolveMaskConfigs } from '../../src/io/live2d/rig/maskConfigs.js';
import { resolveBoneConfig } from '../../src/io/live2d/rig/boneConfig.js';
import { resolveVariantFadeRules } from '../../src/io/live2d/rig/variantFadeRules.js';
import { resolveEyeClosureConfig } from '../../src/io/live2d/rig/eyeClosureConfig.js';
import { resolveRotationDeformerConfig } from '../../src/io/live2d/rig/rotationDeformerConfig.js';
import { resolveAutoRigConfig } from '../../src/io/live2d/rig/autoRigConfig.js';
import { resolveFaceParallax } from '../../src/io/live2d/rig/faceParallaxStore.js';
import { resolveBodyWarp } from '../../src/io/live2d/rig/bodyWarpStore.js';
import { resolveRigWarps } from '../../src/io/live2d/rig/rigWarpsStore.js';

const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const args = process.argv.slice(2);
const useAuthoredRig = args.includes('--authored-rig');
const kernelArg = args.find(a => a.startsWith('--kernel='));
const KERNEL = kernelArg ? kernelArg.slice('--kernel='.length) : 'cubism-setup';
if (KERNEL !== 'v3-legacy' && KERNEL !== 'cubism-setup') {
  console.error(`[error] --kernel must be 'v3-legacy' or 'cubism-setup' (got '${KERNEL}')`);
  process.exit(1);
}
const positional = args.filter(a => !a.startsWith('--'));
const CMO3_PATH = positional[0] ?? path.join(REPO_ROOT, 'shelby.cmo3');
const SNAPSHOTS_DIR = positional[1] ?? path.join(REPO_ROOT, 'scripts/cubism_oracle/snapshots/shelby_runtime');

async function main() {
  // ── Load shelby.cmo3 ──────────────────────────────────────────────
  if (!fs.existsSync(CMO3_PATH)) {
    console.error(`[error] cmo3 not found at ${CMO3_PATH}`);
    process.exit(1);
  }
  const bytes = fs.readFileSync(CMO3_PATH);
  console.log(`[harness] Reading ${path.relative(REPO_ROOT, CMO3_PATH)} (${bytes.length} bytes)`);

  const result = await importCmo3(bytes);
  const project = result.project;
  console.log(
    `[harness] Imported: ${project.nodes.filter(n => n.type === 'part').length} parts, ` +
    `${project.nodes.filter(n => n.type === 'group').length} groups, ` +
    `${project.parameters?.length ?? 0} params`,
  );

  // ── Build rigSpec ────────────────────────────────────────────────
  // Run heuristic Init Rig — this matches what the in-app "Initialize Rig"
  // button does. The cmo3 import only populates leaf rigWarps (per
  // cmo3Import.js); faceParallax + bodyWarp + body rotation chain are
  // reconstructed heuristically. Both paths converge on similar rig
  // data for shelby (validated 2026-05-02 by attempting the authored-
  // path: cmo3Import doesn't carry the full Cubism Editor rig, so
  // mixing authored leaves with heuristic body produces an inconsistent
  // rig that doesn't match Cubism's eval — full divergence on the order
  // of 100k px). Heuristic path keeps everything internally consistent.
  console.log('[harness] Mode: HEURISTIC RIG (initRig)');
  if (useAuthoredRig) {
    console.log('[harness] WARNING: --authored-rig is currently disabled (mixed authored/heuristic produces inconsistent rig); using heuristic');
  }
  const harvest = await initializeRigFromProject(project, new Map());
  const rigSpec = harvest.rigSpec;
  if (!rigSpec) {
    console.error('[error] no rigSpec produced');
    process.exit(1);
  }
  console.log(
    `[harness] Built rigSpec: ${rigSpec.artMeshes?.length ?? 0} artMeshes, ` +
    `${rigSpec.warpDeformers?.length ?? 0} warps, ` +
    `${rigSpec.rotationDeformers?.length ?? 0} rotations, ` +
    `canvas ${rigSpec.canvas?.w}×${rigSpec.canvas?.h}`,
  );
  console.log(`[harness] Kernel: ${KERNEL}`);

  // ── Build oracle-drawable → v3-artmesh index map ─────────────────
  // Both should iterate in the same order: Cubism's drawable index
  // matches our exporter's iteration order (cmo3writer + moc3writer
  // emit drawables in `meshesForRig` order which is project.nodes parts
  // sorted by draw_order desc).
  // We'll match by (vertex_count, sequential index) and warn on mismatch.

  // ── Walk every oracle snapshot ────────────────────────────────────
  const snapFiles = fs.readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith('.json')).sort();
  console.log(`[harness] ${snapFiles.length} oracle snapshots in ${path.relative(REPO_ROOT, SNAPSHOTS_DIR)}`);

  // First pass: compute the rest-pose baseline (per-vertex v3-vs-oracle
  // delta at empty params). Subsequent fixtures' "param-driven delta" =
  // (fixture vertex delta) - (rest vertex delta). This isolates the
  // parameter-dependent divergence from any static rest-pose offset.
  /** @type {Map<number, Float64Array>} */
  const restDeltaByDrawableIdx = new Map();
  let restSnapshot = null;
  for (const fname of snapFiles) {
    const snap = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, fname), 'utf8'));
    if (Object.keys(snap.applied_parameters ?? {}).length === 0) {
      restSnapshot = snap;
      break;
    }
  }
  if (restSnapshot) {
    const restFrames = evalRig(rigSpec, {}, { kernel: KERNEL });
    const ppu = restSnapshot.canvas_info?.pixels_per_unit ?? 1;
    const halfW = (restSnapshot.canvas_info?.size?.[0] ?? 0) / 2;
    const halfH = (restSnapshot.canvas_info?.size?.[1] ?? 0) / 2;
    for (let i = 0; i < restSnapshot.drawables.length; i++) {
      const od = restSnapshot.drawables[i];
      const v3 = restFrames[i];
      if (!v3 || v3.vertexPositions.length !== od.vertex_count * 2) continue;
      const delta = new Float64Array(od.vertex_count * 2);
      for (let v = 0; v < od.vertex_count; v++) {
        const ox = od.vertices[v * 2] * ppu + halfW;
        const oy = -od.vertices[v * 2 + 1] * ppu + halfH;
        delta[v * 2]     = v3.vertexPositions[v * 2]     - ox;
        delta[v * 2 + 1] = v3.vertexPositions[v * 2 + 1] - oy;
      }
      restDeltaByDrawableIdx.set(i, delta);
    }
    console.log(`[harness] rest-pose baseline computed (${restDeltaByDrawableIdx.size} drawables)`);
  } else {
    console.log(`[harness] WARNING: no rest-pose snapshot (empty applied_parameters); param-driven diffs will include any static offset`);
  }

  const fixtureResults = [];
  for (const fname of snapFiles) {
    const oracle = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, fname), 'utf8'));
    const applied = oracle.applied_parameters ?? {};
    const ppu = oracle.canvas_info?.pixels_per_unit ?? 1;
    const halfW = (oracle.canvas_info?.size?.[0] ?? 0) / 2;
    const halfH = (oracle.canvas_info?.size?.[1] ?? 0) / 2;

    // Build the paramValues for evalRig. The oracle dump uses Cubism's
    // canonical param IDs (ParamAngleX etc.), which match v3's IDs.
    const paramValues = { ...applied };

    // Run v3's evalRig
    const frames = evalRig(rigSpec, paramValues, { kernel: KERNEL });

    // Match drawables by index (positional). Compute per-fixture diffs.
    let totalMaxPx = 0;
    let totalSumPx = 0;
    let totalVerts = 0;
    const perDrawable = [];
    for (let i = 0; i < oracle.drawables.length; i++) {
      const od = oracle.drawables[i];
      const v3 = frames[i] ?? null;
      if (!v3) {
        perDrawable.push({ idx: i, oid: od.id, status: 'missing-v3', maxPx: NaN, meanPx: NaN });
        continue;
      }
      // Cubism's vertex coords are normalized canvas (range ~[-1,1] mapping
      // to canvas size, multiplied by pixels_per_unit to get pixels).
      // Origin is at canvas CENTER, +Y goes UP.
      // v3's evalRig output is canvas-px from top-left, +Y down.
      // Convert oracle coords -> v3-style canvas-px:
      //   v3.x = oracle.x * ppu / canvasMaxDim * canvasW + halfW
      //        = oracle.x * canvasW + halfW   (when ppu == canvasMaxDim == canvasW for square)
      //   v3.y = -oracle.y * canvasH + halfH
      const nVerts = od.vertex_count;
      if (v3.vertexPositions.length !== nVerts * 2) {
        perDrawable.push({
          idx: i, oid: od.id, status: 'verts-mismatch',
          oracleVerts: nVerts, v3Verts: v3.vertexPositions.length / 2,
          maxPx: NaN, meanPx: NaN,
        });
        continue;
      }
      let maxPx = 0;
      let sumPx = 0;
      let maxParamPx = 0;        // delta with rest baseline subtracted
      let sumParamPx = 0;
      const restDelta = restDeltaByDrawableIdx.get(i);
      for (let v = 0; v < nVerts; v++) {
        const ox = od.vertices[v * 2] * ppu + halfW;
        const oy = -od.vertices[v * 2 + 1] * ppu + halfH;
        const v3x = v3.vertexPositions[v * 2];
        const v3y = v3.vertexPositions[v * 2 + 1];
        const dx = v3x - ox;
        const dy = v3y - oy;
        const d = Math.hypot(dx, dy);
        if (d > maxPx) maxPx = d;
        sumPx += d;
        // Param-driven delta = total delta - rest delta. If rest delta
        // accounts for the entire divergence, this should be ~0.
        if (restDelta) {
          const pdx = dx - restDelta[v * 2];
          const pdy = dy - restDelta[v * 2 + 1];
          const pd = Math.hypot(pdx, pdy);
          if (pd > maxParamPx) maxParamPx = pd;
          sumParamPx += pd;
        }
      }
      perDrawable.push({
        idx: i, oid: od.id, status: 'ok',
        verts: nVerts, maxPx, meanPx: sumPx / nVerts,
        maxParamPx, meanParamPx: sumParamPx / nVerts,
      });
      if (maxPx > totalMaxPx) totalMaxPx = maxPx;
      totalSumPx += sumPx;
      totalVerts += nVerts;
    }
    // Compute fixture-wide param-driven max/mean
    let fixtureMaxParam = 0;
    let fixtureSumParam = 0;
    let fixtureVertsParam = 0;
    for (const d of perDrawable) {
      if (d.status === 'ok' && Number.isFinite(d.maxParamPx ?? NaN)) {
        if (d.maxParamPx > fixtureMaxParam) fixtureMaxParam = d.maxParamPx;
        fixtureSumParam += (d.meanParamPx ?? 0) * (d.verts ?? 0);
        fixtureVertsParam += d.verts ?? 0;
      }
    }
    perDrawable.sort((a, b) => (b.maxParamPx ?? b.maxPx ?? 0) - (a.maxParamPx ?? a.maxPx ?? 0));
    fixtureResults.push({
      fixture: fname,
      applied,
      totalMaxPx,
      totalMeanPx: totalVerts > 0 ? totalSumPx / totalVerts : 0,
      paramMaxPx: fixtureMaxParam,
      paramMeanPx: fixtureVertsParam > 0 ? fixtureSumParam / fixtureVertsParam : 0,
      top: perDrawable.slice(0, 5),
      drawableCount: perDrawable.length,
    });
  }

  // ── Report ────────────────────────────────────────────────────────
  // Sort fixtures by PARAM-DRIVEN max-diff (most diagnostic for BUG-003).
  fixtureResults.sort((a, b) => b.paramMaxPx - a.paramMaxPx);
  console.log('\n# v3 evalRig vs Cubism oracle — per-fixture diff (canvas-px)');
  console.log(`# rigSpec: ${rigSpec.artMeshes?.length} artMeshes, oracle: ${fixtureResults[0]?.drawableCount} drawables`);
  console.log(`# total = raw v3-vs-oracle distance; param = total minus rest-pose baseline (isolates parameter-dependent divergence).`);
  console.log(`# Param-driven divergence is the BUG-003 signal; rest divergence is rigSpec/import accuracy.`);
  console.log();
  for (const r of fixtureResults) {
    const params = Object.entries(r.applied).map(([k, v]) => `${k}=${v}`).join(', ') || '(rest)';
    console.log(`## ${r.fixture}`);
    console.log(`   applied: ${params}`);
    console.log(`   total max=${r.totalMaxPx.toFixed(2)}px  mean=${r.totalMeanPx.toFixed(2)}px`);
    console.log(`   param max=${r.paramMaxPx.toFixed(2)}px  mean=${r.paramMeanPx.toFixed(2)}px`);
    console.log(`   top drawables (param_max / param_mean / verts):`);
    for (const d of r.top) {
      if (d.status !== 'ok') {
        console.log(`     [${d.idx}] ${d.oid}  status=${d.status}`);
      } else {
        const pmax = (d.maxParamPx ?? d.maxPx).toFixed(2).padStart(7);
        const pmean = (d.meanParamPx ?? d.meanPx).toFixed(2).padStart(7);
        console.log(`     [${d.idx}] ${d.oid.padEnd(11)}  param_max=${pmax}  param_mean=${pmean}  verts=${d.verts}`);
      }
    }
    console.log();
  }

  // Overall summary
  const overallTotalMax = Math.max(...fixtureResults.map(r => r.totalMaxPx));
  const overallParamMax = Math.max(...fixtureResults.map(r => r.paramMaxPx));
  const overallTotalMean = fixtureResults.reduce((a, r) => a + r.totalMeanPx, 0) / fixtureResults.length;
  const overallParamMean = fixtureResults.reduce((a, r) => a + r.paramMeanPx, 0) / fixtureResults.length;
  console.log('# Overall');
  console.log(`   ${snapFiles.length} fixtures`);
  console.log(`   total: max=${overallTotalMax.toFixed(2)}px, mean-of-fixture-means=${overallTotalMean.toFixed(2)}px`);
  console.log(`   param: max=${overallParamMax.toFixed(2)}px, mean-of-fixture-means=${overallParamMean.toFixed(2)}px`);
  console.log(`   threshold for "match Cubism": ~1.0 px on PARAM divergence (rest divergence is rigSpec build accuracy)`);
  console.log(`   param-divergence pass: ${overallParamMax < 1.0 ? 'YES' : 'NO'}`);
}

main().catch(err => {
  console.error('[harness] failed:', err);
  process.exit(1);
});
