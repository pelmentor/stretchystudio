#!/usr/bin/env node
// Phase 2b — kernel probe. Walks shelby's chain at a chosen fixture and
// prints per-deformer intermediate state: rotation matrices,
// lifted-grid bboxes at each warp, FD-probed Jacobians at the
// rotation→warp boundary, and the per-vertex chain walk for a chosen
// artmesh. Stage 0's diagnostic surface — Stage 1 reads its output to
// pick P1/P2/P3.
//
// Usage:
//   node scripts/cubism_oracle/probe_kernel.mjs [fixture-name] [--kernel=v3-legacy|cubism-setup] [--mesh=<artmesh-id>] [--cmo3=<path>]
//
// Defaults:
//   fixture: AngleZ_pos30        (the BUG-003 signal — current 9.45 px PARAM)
//   kernel:  v3-legacy
//   mesh:    first artmesh in rigSpec.artMeshes
//   cmo3:    <repo>/shelby.cmo3
//
// Output is a structured dump on stdout, easy to diff between kernels
// or between fixtures with normal text tools.

// ── Browser-API stubs for Node ───────────────────────────────────────
// Same stubs as diff_v3_vs_oracle — cmo3Import constructs Blob + URL.
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
import { evalRig, TraceCollector } from '../../src/io/live2d/runtime/evaluator/chainEval.js';

const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const SNAPSHOTS_DIR = path.join(REPO_ROOT, 'scripts/cubism_oracle/snapshots/shelby_runtime');
const args = process.argv.slice(2);

function findFlag(name, fallback) {
  const f = args.find(a => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : fallback;
}

const FIXTURE_NAME = (args.find(a => !a.startsWith('--')) ?? 'AngleZ_pos30').replace(/\.json$/, '');
const KERNEL = findFlag('kernel', 'v3-legacy');
const MESH_ID_OVERRIDE = findFlag('mesh', null);
const CMO3_PATH = findFlag('cmo3', path.join(REPO_ROOT, 'shelby.cmo3'));

if (KERNEL !== 'v3-legacy' && KERNEL !== 'cubism-setup') {
  console.error(`[error] --kernel must be 'v3-legacy' or 'cubism-setup'`);
  process.exit(1);
}

function findFixturePath(name) {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return null;
  const files = fs.readdirSync(SNAPSHOTS_DIR);
  // Prefer exact-prefix match (snapshot files are <name>__<paramSig>.json).
  const match = files.find(f => f === `${name}.json` || f.startsWith(`${name}__`));
  return match ? path.join(SNAPSHOTS_DIR, match) : null;
}

function fmt(n, w = 8, p = 4) {
  if (!Number.isFinite(n)) return String(n).padStart(w);
  return n.toFixed(p).padStart(w);
}

function fmtMat3(m) {
  if (!m) return '<null>';
  return [
    `[ ${fmt(m[0])} ${fmt(m[1])} | ${fmt(m[2])} ]`,
    `[ ${fmt(m[3])} ${fmt(m[4])} | ${fmt(m[5])} ]`,
  ].join('\n          ');
}

async function main() {
  // ── Load + import shelby.cmo3 ───────────────────────────────────────
  if (!fs.existsSync(CMO3_PATH)) {
    console.error(`[error] cmo3 not found at ${CMO3_PATH}`);
    process.exit(1);
  }
  const bytes = fs.readFileSync(CMO3_PATH);
  const result = await importCmo3(bytes);
  const project = result.project;
  const harvest = await initializeRigFromProject(project, new Map());
  const rigSpec = harvest.rigSpec;
  if (!rigSpec) {
    console.error('[error] no rigSpec produced');
    process.exit(1);
  }

  // ── Load fixture's applied params ──────────────────────────────────
  const fixturePath = findFixturePath(FIXTURE_NAME);
  if (!fixturePath) {
    console.error(`[error] fixture '${FIXTURE_NAME}' not found in ${SNAPSHOTS_DIR}`);
    process.exit(1);
  }
  const oracle = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const paramValues = { ...(oracle.applied_parameters ?? {}) };

  console.log('# probe_kernel');
  console.log(`#   fixture:  ${path.basename(fixturePath)}`);
  console.log(`#   kernel:   ${KERNEL}`);
  console.log(`#   params:   ${JSON.stringify(paramValues)}`);
  console.log(`#   canvas:   ${rigSpec.canvas?.w}×${rigSpec.canvas?.h}`);
  console.log();

  // ── Run evalRig with a trace collector ─────────────────────────────
  const trace = new TraceCollector();
  const frames = evalRig(rigSpec, paramValues, { kernel: KERNEL, trace });

  // ── Section 1: rotation deformers ──────────────────────────────────
  console.log('## rotation deformers');
  const rotations = (rigSpec.rotationDeformers ?? []).map(r => trace.deformerStates.get(r.id)).filter(Boolean);
  for (const r of rotations) {
    console.log(`  ${r.id}`);
    console.log(`    parent:   ${r.parentType}/${r.parentId ?? '<root>'}`);
    if (r.parentType === 'warp') {
      console.log(`    slopeX:   ${fmt(r.slopeX)}    slopeY: ${fmt(r.slopeY)}`);
    }
    console.log(`    mat:      ${fmtMat3(r.mat)}`);
  }
  console.log();

  // ── Section 2: warp deformers (lifted bboxes) ──────────────────────
  console.log('## warp deformers (lifted bboxes, canvas-px)');
  for (const w of rigSpec.warpDeformers ?? []) {
    const bbox = trace.liftedBboxes.get(w.id);
    const ds = trace.deformerStates.get(w.id);
    if (!bbox) {
      console.log(`  ${w.id}  (gridSize ${ds?.gridSize?.rows ?? '?'}×${ds?.gridSize?.cols ?? '?'})  <unlifted>`);
      continue;
    }
    const { x, y } = bbox;
    console.log(
      `  ${w.id}  ` +
      `(gridSize ${ds?.gridSize?.rows ?? '?'}×${ds?.gridSize?.cols ?? '?'})  ` +
      `x=[${fmt(x[0], 8, 1)}, ${fmt(x[1], 8, 1)}]  y=[${fmt(y[0], 8, 1)}, ${fmt(y[1], 8, 1)}]`,
    );
  }
  console.log();

  // ── Section 3: chosen artmesh chain walk + final frame ─────────────
  const artMeshes = rigSpec.artMeshes ?? [];
  const meshSpec = MESH_ID_OVERRIDE
    ? artMeshes.find(m => m.id === MESH_ID_OVERRIDE)
    : artMeshes[0];
  if (!meshSpec) {
    console.error(`[error] artmesh '${MESH_ID_OVERRIDE ?? '<first>'}' not found`);
    process.exit(1);
  }
  const meshFrame = frames.find(f => f.id === meshSpec.id);
  console.log(`## artmesh ${meshSpec.id}`);
  let chainStr = '';
  let cur = meshSpec.parent;
  let safety = 32;
  while (cur && cur.type !== 'root' && safety-- > 0) {
    chainStr += `${cur.type}/${cur.id ?? '?'} → `;
    const idx = (rigSpec.warpDeformers ?? []).find(w => w.id === cur.id)
      ?? (rigSpec.rotationDeformers ?? []).find(r => r.id === cur.id);
    if (!idx) { chainStr += '<missing>'; break; }
    cur = idx.parent;
  }
  chainStr += 'root';
  console.log(`  chain:    ${chainStr}`);
  console.log(`  verts:    ${meshFrame ? meshFrame.vertexPositions.length / 2 : '<no frame>'}`);
  if (meshFrame) {
    const vp = meshFrame.vertexPositions;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < vp.length; i += 2) {
      if (vp[i] < minX) minX = vp[i];
      if (vp[i] > maxX) maxX = vp[i];
      if (vp[i + 1] < minY) minY = vp[i + 1];
      if (vp[i + 1] > maxY) maxY = vp[i + 1];
    }
    console.log(`  bbox:     x=[${fmt(minX, 8, 1)}, ${fmt(maxX, 8, 1)}]  y=[${fmt(minY, 8, 1)}, ${fmt(maxY, 8, 1)}]`);
    // Sample first 3 verts.
    console.log(`  sample:   [${fmt(vp[0], 8, 2)}, ${fmt(vp[1], 8, 2)}]  [${fmt(vp[2], 8, 2)}, ${fmt(vp[3], 8, 2)}]  [${fmt(vp[4], 8, 2)}, ${fmt(vp[5], 8, 2)}]`);
  }
  console.log();
}

main().catch(err => {
  console.error('[probe_kernel] failed:', err);
  process.exit(1);
});
