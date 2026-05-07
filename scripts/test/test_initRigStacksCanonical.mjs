// Phase 0.3 verification — after seed* runs, modifier stacks are
// canonical and parent links are a derived mirror. Asserts:
//   1. After every seedXxx call, every part's stack matches what
//      synthesizeModifierStacks would produce from current parent
//      links (forward consistency).
//   2. Inverse synth from those stacks reproduces the same parent
//      links the seed* fns wrote (round-trip consistency).
// Run: node scripts/test/test_initRigStacksCanonical.mjs

import {
  synthesizeModifierStacks,
  synthesizeDeformerParents,
  warpSpecToDeformerNode,
  upsertDeformerNode,
} from '../../src/store/deformerNodeSync.js';

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

// ---- Forward consistency ----

// Helper: snapshot all (deformer.parent, part.rigParent) values.
function snapParents(project) {
  const out = {};
  for (const n of project.nodes) {
    out[n.id] = {
      parent: n.parent ?? null,
      rigParent: n.rigParent ?? null,
      modifiers: Array.isArray(n.modifiers)
        ? n.modifiers.map((m) => m.deformerId)
        : null,
    };
  }
  return out;
}

// 1. Synthetic seed pipeline that mirrors the real seed's parent-link
//    write pattern: insert deformer nodes, set part.rigParent, run
//    forward synth → inverse synth. Verify round-trip.
{
  const project = {
    nodes: [
      // FaceParallax above the rotation chain.
      warpSpecToDeformerNode({
        id: 'FaceParallaxWarp',
        name: 'FaceParallaxWarp',
        parent: { type: 'root', id: null },
        gridSize: { rows: 5, cols: 5 },
      }),
      // Body chain.
      warpSpecToDeformerNode({
        id: 'BodyWarpZ',  name: 'BodyZ',  parent: { type: 'root', id: null },
        gridSize: { rows: 5, cols: 5 },
      }),
      warpSpecToDeformerNode({
        id: 'BodyWarpY',  name: 'BodyY',  parent: { type: 'warp', id: 'BodyWarpZ' },
        gridSize: { rows: 5, cols: 5 },
      }),
      warpSpecToDeformerNode({
        id: 'BreathWarp', name: 'Breath', parent: { type: 'warp', id: 'BodyWarpY' },
        gridSize: { rows: 5, cols: 5 },
      }),
      warpSpecToDeformerNode({
        id: 'BodyXWarp',  name: 'BodyX',  parent: { type: 'warp', id: 'BreathWarp' },
        gridSize: { rows: 5, cols: 5 },
      }),
      // Per-mesh rigWarp parented under BodyXWarp.
      warpSpecToDeformerNode({
        id: 'RigWarp_face',
        name: 'RigWarp_face',
        parent: { type: 'warp', id: 'BodyXWarp' },
        targetPartId: 'face',
        gridSize: { rows: 5, cols: 5 },
      }),
      // Parts.
      { id: 'face', type: 'part', rigParent: 'RigWarp_face',
        mesh: { vertices: [], uvs: [], triangles: [] } },
      { id: 'shirt', type: 'part', rigParent: 'BodyXWarp',
        mesh: { vertices: [], uvs: [], triangles: [] } },
    ],
  };

  // Forward: derive stacks from parent links.
  synthesizeModifierStacks(project);
  const face = project.nodes.find((n) => n.id === 'face');
  const shirt = project.nodes.find((n) => n.id === 'shirt');
  assert(Array.isArray(face.modifiers) && face.modifiers.length === 5,
    'forward: face stack = 5 (RigWarp + 4 body)');
  assertEq(face.modifiers[0].deformerId, 'RigWarp_face',
    'forward: face leaf = RigWarp_face');
  assertEq(face.modifiers[4].deformerId, 'BodyWarpZ',
    'forward: face root = BodyWarpZ');
  assertEq(shirt.modifiers.length, 4, 'forward: shirt stack = 4 (4 body, no rigwarp)');
  assertEq(shirt.modifiers[0].deformerId, 'BodyXWarp',
    'forward: shirt leaf = BodyXWarp');

  // Snapshot, then corrupt parent links, then run inverse synth, then
  // verify they are identical to the snapshot.
  const before = snapParents(project);
  for (const n of project.nodes) {
    if (n.type === 'deformer') n.parent = 'CORRUPTED';
    if (n.type === 'part') n.rigParent = 'CORRUPTED';
  }
  synthesizeDeformerParents(project);
  const after = snapParents(project);

  // BodyWarpZ is the root last-modifier in both stacks; its parent IS
  // NOT restored by inverse synth (last-mod parent intentionally not
  // touched). So we assert it stayed CORRUPTED (the user-supplied corrupt
  // state is preserved as data — caller error retained, not auto-healed).
  assertEq(project.nodes.find((n) => n.id === 'BodyWarpZ').parent,
    'CORRUPTED',
    'inverse synth: root parent NOT restored (last-mod contract)');

  // All non-root deformer parents should be restored.
  assertEq(project.nodes.find((n) => n.id === 'BodyWarpY').parent, 'BodyWarpZ',
    'inverse synth: BodyY.parent restored');
  assertEq(project.nodes.find((n) => n.id === 'BreathWarp').parent, 'BodyWarpY',
    'inverse synth: Breath.parent restored');
  assertEq(project.nodes.find((n) => n.id === 'BodyXWarp').parent, 'BreathWarp',
    'inverse synth: BodyX.parent restored');
  assertEq(project.nodes.find((n) => n.id === 'RigWarp_face').parent, 'BodyXWarp',
    'inverse synth: RigWarp.parent restored');
  // Both part rigParents restored from their stacks' leaf entries.
  assertEq(project.nodes.find((n) => n.id === 'face').rigParent, 'RigWarp_face',
    'inverse synth: face.rigParent restored');
  assertEq(project.nodes.find((n) => n.id === 'shirt').rigParent, 'BodyXWarp',
    'inverse synth: shirt.rigParent restored');
}

// ---- Idempotency: forward → inverse → forward → no churn ----

{
  const project = {
    nodes: [
      warpSpecToDeformerNode({
        id: 'A', name: 'A', parent: { type: 'root', id: null }, gridSize: { rows: 5, cols: 5 },
      }),
      warpSpecToDeformerNode({
        id: 'B', name: 'B', parent: { type: 'warp', id: 'A' }, gridSize: { rows: 5, cols: 5 },
      }),
      { id: 'p', type: 'part', rigParent: 'B' },
    ],
  };
  synthesizeModifierStacks(project);
  const stacks1 = JSON.parse(JSON.stringify(project.nodes.find((n) => n.id === 'p').modifiers));
  synthesizeDeformerParents(project);
  synthesizeModifierStacks(project);
  const stacks2 = JSON.parse(JSON.stringify(project.nodes.find((n) => n.id === 'p').modifiers));
  assertEq(stacks1, stacks2,
    'idempotency: forward → inverse → forward leaves stacks unchanged');
}

// ---- Result ----

console.log(`initRigStacksCanonical: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
