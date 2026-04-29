// v3 Phase 1C - tests for src/io/live2d/runtime/evaluator/chainDiagnose.js
//
// Run: node scripts/test/test_chainDiagnose.mjs

import {
  diagnoseRigChains,
  summarizeDiagnoses,
} from '../../src/io/live2d/runtime/evaluator/chainDiagnose.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Empty / invalid input ───────────────────────────────────────────

{
  assert(diagnoseRigChains(null).length === 0, 'null rigSpec → []');
  assert(diagnoseRigChains(undefined).length === 0, 'undefined rigSpec → []');
  assert(diagnoseRigChains({}).length === 0, 'empty rigSpec → []');
  assert(diagnoseRigChains({ artMeshes: [] }).length === 0, 'empty artMeshes → []');
}

// ── Clean termination at root ──────────────────────────────────────

{
  // mesh → warp1 → root
  const rigSpec = {
    warpDeformers: [
      { id: 'w1', parent: { type: 'root' } },
    ],
    rotationDeformers: [],
    artMeshes: [
      { id: 'mesh1', parent: { type: 'warp', id: 'w1' } },
    ],
  };
  const [d] = diagnoseRigChains(rigSpec);
  assert(d.partId === 'mesh1',                'partId carried');
  assert(d.terminationKind === 'root',        'clean termination at root');
  assert(d.chainLength === 1,                 'one parent walked');
  assert(d.finalFrame === 'canvas-px',        'final frame canvas-px when terminated at root');
  assert(d.chainPath[0].kind === 'warp',      'chain step recorded');
}

// ── Multi-step clean chain ──────────────────────────────────────────

{
  // mesh → warp1 → rotation1 → root
  const rigSpec = {
    warpDeformers: [{ id: 'w1', parent: { type: 'rotation', id: 'r1' } }],
    rotationDeformers: [{ id: 'r1', parent: { type: 'root' } }],
    artMeshes: [{ id: 'mesh', parent: { type: 'warp', id: 'w1' } }],
  };
  const [d] = diagnoseRigChains(rigSpec);
  assert(d.terminationKind === 'root', 'multi-step terminated at root');
  assert(d.chainLength === 2, 'two parents walked');
  assert(d.finalFrame === 'canvas-px', 'multi-step final frame canvas-px');
  assert(d.chainPath[0].id === 'w1', 'first step is mesh-direct parent');
  assert(d.chainPath[1].id === 'r1', 'second step is grandparent');
}

// ── Broken chain: parent id not in index ────────────────────────────

{
  // mesh → warp1 → ?missing? — last step's parent points to a deformer
  // that's not in the rig (silent failure path).
  const rigSpec = {
    warpDeformers: [
      { id: 'w1', parent: { type: 'warp', id: 'w_missing' } },
      // w_missing is intentionally absent
    ],
    rotationDeformers: [],
    artMeshes: [{ id: 'mesh', parent: { type: 'warp', id: 'w1' } }],
  };
  const [d] = diagnoseRigChains(rigSpec);
  assert(d.terminationKind === 'unknown_parent',
    'broken chain → unknown_parent');
  assert(d.finalFrame === 'normalized-0to1',
    'broken-after-warp → normalized-0to1 (THE silent-failure frame)');
  assert(d.chainPath.some(s => s.kind === 'unknown'),
    'chainPath records the unknown step');
}

{
  // Same shape, but last successful step is a rotation deformer.
  const rigSpec = {
    warpDeformers: [],
    rotationDeformers: [
      { id: 'r1', parent: { type: 'rotation', id: 'r_missing' } },
    ],
    artMeshes: [{ id: 'mesh', parent: { type: 'rotation', id: 'r1' } }],
  };
  const [d] = diagnoseRigChains(rigSpec);
  assert(d.terminationKind === 'unknown_parent', 'broken-after-rotation: kind');
  assert(d.finalFrame === 'pivot-relative',
    'broken-after-rotation → pivot-relative');
}

// ── Mesh has no parent at all ───────────────────────────────────────

{
  const rigSpec = {
    warpDeformers: [],
    rotationDeformers: [],
    artMeshes: [{ id: 'mesh' /* no parent */ }],
  };
  const [d] = diagnoseRigChains(rigSpec);
  assert(d.terminationKind === 'no_parent', 'no_parent termination');
  assert(d.chainLength === 0, 'no_parent → chain length 0');
  assert(d.finalFrame === 'unknown', 'no_parent → unknown frame');
}

// ── Mesh parent points directly at root (no deformer hops) ──────────

{
  const rigSpec = {
    warpDeformers: [],
    rotationDeformers: [],
    artMeshes: [{ id: 'mesh', parent: { type: 'root' } }],
  };
  const [d] = diagnoseRigChains(rigSpec);
  assert(d.terminationKind === 'root', 'direct-to-root: clean');
  assert(d.chainLength === 0, 'direct-to-root: 0 hops');
  assert(d.finalFrame === 'canvas-px', 'direct-to-root: canvas-px');
}

// ── Cycle detection ─────────────────────────────────────────────────

{
  // w1 → w2 → w1 — circular
  const rigSpec = {
    warpDeformers: [
      { id: 'w1', parent: { type: 'warp', id: 'w2' } },
      { id: 'w2', parent: { type: 'warp', id: 'w1' } },
    ],
    rotationDeformers: [],
    artMeshes: [{ id: 'mesh', parent: { type: 'warp', id: 'w1' } }],
  };
  const [d] = diagnoseRigChains(rigSpec);
  assert(d.terminationKind === 'cycle_or_deep',
    'cycle: terminates with cycle_or_deep');
  // safety hits 0 after 32 hops, all of which are valid warps
  assert(d.finalFrame === 'normalized-0to1',
    'cycle inside warps → normalized-0to1');
}

// ── Multiple meshes — order preserved ───────────────────────────────

{
  const rigSpec = {
    warpDeformers: [{ id: 'w1', parent: { type: 'root' } }],
    rotationDeformers: [],
    artMeshes: [
      { id: 'a', parent: { type: 'warp', id: 'w1' } },
      { id: 'b', parent: { type: 'warp', id: 'w_missing' } },
      { id: 'c', parent: { type: 'warp', id: 'w1' } },
    ],
  };
  const ds = diagnoseRigChains(rigSpec);
  assert(ds.length === 3, 'three diagnoses');
  assert(ds[0].partId === 'a' && ds[0].terminationKind === 'root', 'a clean');
  assert(ds[1].partId === 'b' && ds[1].terminationKind === 'unknown_parent', 'b broken');
  assert(ds[2].partId === 'c' && ds[2].terminationKind === 'root', 'c clean');
}

// ── Malformed mesh entries dropped ──────────────────────────────────

{
  const rigSpec = {
    warpDeformers: [],
    rotationDeformers: [],
    artMeshes: [
      null,
      { /* no id */ parent: { type: 'root' } },
      { id: '', parent: { type: 'root' } },     // empty id is dropped (truthy check)
      { id: 'good', parent: { type: 'root' } },
    ],
  };
  const ds = diagnoseRigChains(rigSpec);
  assert(ds.length === 1 && ds[0].partId === 'good', 'malformed dropped');
}

// ── summarizeDiagnoses ──────────────────────────────────────────────

{
  const rigSpec = {
    warpDeformers: [
      { id: 'w_clean', parent: { type: 'root' } },
      { id: 'w_broken', parent: { type: 'warp', id: 'missing' } },
    ],
    rotationDeformers: [],
    artMeshes: [
      { id: 'a', parent: { type: 'warp', id: 'w_clean' } },
      { id: 'b', parent: { type: 'warp', id: 'w_broken' } },
      { id: 'c', parent: { type: 'warp', id: 'w_clean' } },
      { id: 'd' /* no parent */ },
    ],
  };
  const sum = summarizeDiagnoses(diagnoseRigChains(rigSpec));
  assert(sum.total === 4,    'summary total');
  assert(sum.clean === 2,    'summary clean');
  assert(sum.broken === 1,   'summary broken');
  assert(sum.noParent === 1, 'summary noParent');
  assert(sum.cycle === 0,    'summary cycle 0');
  assert(JSON.stringify(sum.brokenIds) === '["b"]', 'broken ids list');
}

// ── Output ──────────────────────────────────────────────────────────

console.log(`chainDiagnose: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
