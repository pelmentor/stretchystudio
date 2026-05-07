// BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.B — synthesise deformer-node
// tree from `Object.modifiers[]` for export-pipeline consumption.
//
// Tests:
//   1. A part with a 3-warp stack synthesises 3 deformer nodes with
//      correct parent chain.
//   2. Multiple parts sharing ancestors don't duplicate nodes.
//   3. Rotation modifier produces deformerKind: 'rotation'.
//   4. Orphan deformer nodes (not in any stack) are included by
//      default; opt out via { includeOrphans: false }.
//   5. Modifiers without `data` are skipped.
//   6. Output equivalence: synth vs. node-filter on a fully-migrated
//      project produces structurally identical sets (by id + parent +
//      key fields).
//   7. Defensive — empty / null / no nodes survive.
//
// Run: node scripts/test/test_synthesizeDeformerNodesForExport.mjs

import { synthesizeDeformerNodesForExport } from '../../src/io/live2d/rig/synthesizeDeformerNodesForExport.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function findById(arr, id) {
  return arr.find((n) => n?.id === id) ?? null;
}

// ---- 1. Single part, 3-warp stack ----
{
  const project = {
    nodes: [
      {
        id: 'face', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'RigWarp_face',
            data: { name: 'RigWarp_face', gridSize: { rows: 3, cols: 3 } } },
          { type: 'warp', deformerId: 'BodyXWarp',
            data: { name: 'BodyXWarp', gridSize: { rows: 5, cols: 5 } } },
          { type: 'warp', deformerId: 'BreathWarp',
            data: { name: 'BreathWarp', gridSize: { rows: 5, cols: 5 } } },
        ],
      },
    ],
  };
  const synth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  assert(synth.length === 3, '3 deformer nodes synthesised');
  const leaf = findById(synth, 'RigWarp_face');
  const middle = findById(synth, 'BodyXWarp');
  const root = findById(synth, 'BreathWarp');
  assert(leaf?.parent === 'BodyXWarp',
    'leaf parent = next modifier in stack');
  assert(middle?.parent === 'BreathWarp',
    'middle parent = next modifier in stack');
  assert(root?.parent === null, 'outermost parent = null');
  assert(leaf?.deformerKind === 'warp', 'deformerKind preserved');
  assert(leaf?.name === 'RigWarp_face', 'name copied from data');
  assert(leaf?.gridSize?.rows === 3, 'gridSize copied from data');
}

// ---- 2. Shared ancestor: two parts with overlapping chains ----
{
  const project = {
    nodes: [
      {
        id: 'face', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'RigWarp_face',
            data: { name: 'RigWarp_face' } },
          { type: 'warp', deformerId: 'BodyXWarp',
            data: { name: 'BodyXWarp' } },
        ],
      },
      {
        id: 'topwear', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'RigWarp_topwear',
            data: { name: 'RigWarp_topwear' } },
          { type: 'warp', deformerId: 'BodyXWarp',
            data: { name: 'BodyXWarp' } },
        ],
      },
    ],
  };
  const synth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  // BodyXWarp shared, so total = 3 (face's leaf + topwear's leaf + shared).
  assert(synth.length === 3, '3 unique deformers, BodyXWarp not duplicated');
  const shared = findById(synth, 'BodyXWarp');
  assert(!!shared, 'shared deformer present');
  assert(shared?.parent === null, 'shared parent = null (outermost in both stacks)');
}

// ---- 3. Rotation modifier ----
{
  const project = {
    nodes: [
      {
        id: 'arm', type: 'part',
        modifiers: [
          { type: 'rotation', deformerId: 'Rotation_leftElbow',
            data: { name: 'Rotation_leftElbow', baseAngle: 0 } },
        ],
      },
    ],
  };
  const synth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  assert(synth.length === 1, '1 rotation node');
  assert(synth[0].deformerKind === 'rotation', 'deformerKind = rotation');
  assert(synth[0].baseAngle === 0, 'rotation field preserved');
}

// ---- 4. Orphan deformer (default-included) ----
{
  const project = {
    nodes: [
      {
        id: 'face', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'RigWarp_face',
            data: { name: 'RigWarp_face' } },
        ],
      },
      // Orphan — no part references it.
      { id: 'OrphanWarp', type: 'deformer', deformerKind: 'warp',
        name: 'OrphanWarp', parent: null },
    ],
  };
  const withOrphans = synthesizeDeformerNodesForExport(project);
  assert(withOrphans.length === 2, 'orphan included by default');
  assert(!!findById(withOrphans, 'OrphanWarp'), 'orphan present');
  const withoutOrphans = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  assert(withoutOrphans.length === 1, 'orphan excluded with opt-out');
}

// ---- 5. Modifier without `data` is skipped (Phase 3.A pre-migration) ----
{
  const project = {
    nodes: [
      {
        id: 'p1', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'no_data_yet' /* no data field */ },
        ],
      },
    ],
  };
  const synth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  assert(synth.length === 0,
    'modifier without data is skipped (no source to copy from)');
}

// ---- 6. Equivalence vs. node-filter on a fully-migrated project ----
{
  // Construct a project where deformer nodes AND modifier.data both
  // exist (the Phase 3.A dual-write state). Synth should produce a
  // tree structurally equivalent to the node-filter, modulo field
  // ordering.
  const dW = {
    type: 'deformer', deformerKind: 'warp', id: 'W', name: 'W',
    parent: null, gridSize: { rows: 5, cols: 5 },
    bindings: [], keyforms: [],
  };
  const project = {
    nodes: [
      dW,
      {
        id: 'p1', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'W',
            data: { name: 'W', gridSize: { rows: 5, cols: 5 },
                     bindings: [], keyforms: [] } },
        ],
      },
    ],
  };
  const synth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  const synthW = findById(synth, 'W');
  assert(!!synthW, 'synth has W');
  assert(synthW.parent === null, 'synth parent matches node parent');
  assert(synthW.gridSize?.rows === 5, 'synth gridSize matches node');
  assert(synthW.deformerKind === 'warp', 'synth deformerKind matches node');
}

// ---- 7. Defensive ----
{
  assert(Array.isArray(synthesizeDeformerNodesForExport(null)) &&
    synthesizeDeformerNodesForExport(null).length === 0,
    'null project → []');
  assert(synthesizeDeformerNodesForExport({}).length === 0, '{} → []');
  assert(synthesizeDeformerNodesForExport({ nodes: [] }).length === 0, 'no nodes → []');
}

console.log(`synthesizeDeformerNodesForExport: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
