// Tests for synthesizeDeformerParents (Phase 0.2 of Blender Parity V2).
// Run: node scripts/test/test_synthesizeDeformerParents.mjs
// Exits non-zero on first failure.

import {
  synthesizeModifierStacks,
  synthesizeDeformerParents,
} from '../../src/store/deformerNodeSync.js';
import { migrateModifierModeFlags } from '../../src/store/migrations/v21_modifier_mode_flags.js';

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

function makeBodyChainProject() {
  return {
    nodes: [
      { id: 'BodyWarpZ',  type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'BodyWarpY',  type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpZ' },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpY' },
      { id: 'BodyXWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BreathWarp' },
      { id: 'face', type: 'part', rigParent: 'BodyXWarp',
        mesh: { vertices: [], uvs: [], triangles: [] } },
    ],
  };
}

function snapshotParents(project) {
  const out = {};
  for (const n of project.nodes) {
    out[n.id] = {
      parent: n.parent ?? null,
      rigParent: n.rigParent ?? null,
    };
  }
  return out;
}

// ----- 1. Round-trip on the canonical body chain -----

{
  const project = makeBodyChainProject();
  const before = snapshotParents(project);
  synthesizeModifierStacks(project);
  // After synth, deformer parents are unchanged (synth only WRITES stacks).
  // Now corrupt the parent links so we can detect the inverse synth restoring them.
  for (const n of project.nodes) {
    if (n.type === 'deformer') n.parent = 'CORRUPTED';
  }
  synthesizeDeformerParents(project);
  // BodyXWarp should now point at BreathWarp (next in stack).
  assertEq(project.nodes.find((n) => n.id === 'BodyXWarp').parent,
    'BreathWarp',
    'inverse synth: BodyXWarp.parent restored to BreathWarp');
  assertEq(project.nodes.find((n) => n.id === 'BreathWarp').parent,
    'BodyWarpY',
    'inverse synth: BreathWarp.parent restored to BodyWarpY');
  assertEq(project.nodes.find((n) => n.id === 'BodyWarpY').parent,
    'BodyWarpZ',
    'inverse synth: BodyWarpY.parent restored to BodyWarpZ');
  // BodyWarpZ is the LAST modifier — its parent is NOT touched by inverse synth.
  assertEq(project.nodes.find((n) => n.id === 'BodyWarpZ').parent,
    'CORRUPTED',
    'inverse synth: last modifier parent NOT touched (was CORRUPTED, stays)');
  // Part rigParent restored.
  assertEq(project.nodes.find((n) => n.id === 'face').rigParent,
    'BodyXWarp',
    'inverse synth: part.rigParent restored to leaf');
}

// ----- 2. Full round-trip preserves parent links (when last-modifier parent is null) -----

{
  const project = makeBodyChainProject();
  const before = snapshotParents(project);
  synthesizeModifierStacks(project);
  synthesizeDeformerParents(project);
  const after = snapshotParents(project);
  assertEq(after, before,
    'round-trip: deformer parents + part rigParent identical (BodyZ root parent = null both before/after)');
}

// ----- 3. Empty stack → no-op -----

{
  const project = {
    nodes: [
      { id: 'OrphanWarp', type: 'deformer', deformerKind: 'warp', parent: 'SomeGroup' },
      { id: 'rogue', type: 'part', rigParent: null,
        mesh: { vertices: [], uvs: [], triangles: [] } },
    ],
  };
  const before = snapshotParents(project);
  synthesizeDeformerParents(project);
  const after = snapshotParents(project);
  assertEq(after, before,
    'empty stack: rigParent + deformer parents unchanged');
}

// ----- 4. Single-modifier (synthetic) stack writes rigParent only -----

{
  const project = {
    nodes: [
      { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp', parent: 'BreathWarp' },
      { id: 'shirt', type: 'part', rigParent: null,
        mesh: { vertices: [], uvs: [], triangles: [] },
        modifiers: [{ type: 'warp', deformerId: 'BodyXWarp', enabled: true, synthetic: true }] },
    ],
  };
  synthesizeDeformerParents(project);
  const shirt = project.nodes.find((n) => n.id === 'shirt');
  const bodyX = project.nodes.find((n) => n.id === 'BodyXWarp');
  assertEq(shirt.rigParent, 'BodyXWarp',
    'synthetic single-mod: shirt.rigParent set from leaf');
  assertEq(bodyX.parent, 'BreathWarp',
    'synthetic single-mod: BodyXWarp.parent untouched (was BreathWarp, stays)');
}

// ----- 5. Multi-deformer stack with non-deformer ancestor -----

// Setup: BodyXWarp.parent = 'SomeGroup' (a non-deformer). When we call
// synthesizeModifierStacks, the stack walk breaks at SomeGroup. Round-tripping
// should preserve that — the last modifier's parent stays SomeGroup.

{
  const project = {
    nodes: [
      { id: 'SomeGroup', type: 'group' },
      { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp', parent: 'SomeGroup' },
      { id: 'shirt', type: 'part', rigParent: 'BodyXWarp',
        mesh: { vertices: [], uvs: [], triangles: [] } },
    ],
  };
  synthesizeModifierStacks(project);
  // Stack should be 1 entry (BodyXWarp); SomeGroup is not a deformer.
  const stack = project.nodes.find((n) => n.id === 'shirt').modifiers;
  assertEq(stack.length, 1, 'non-deformer ancestor: stack length 1 (SomeGroup excluded)');
  // Now corrupt and inverse synth.
  project.nodes.find((n) => n.id === 'BodyXWarp').parent = 'CORRUPTED';
  synthesizeDeformerParents(project);
  // BodyXWarp is the LAST modifier — parent NOT restored to SomeGroup; stays CORRUPTED.
  // (The inverse synth can't reconstruct a non-deformer ancestor from the stack.)
  assertEq(project.nodes.find((n) => n.id === 'BodyXWarp').parent,
    'CORRUPTED',
    'non-deformer ancestor: last-modifier parent intentionally not restored from stack');
  assertEq(project.nodes.find((n) => n.id === 'shirt').rigParent,
    'BodyXWarp',
    'non-deformer ancestor: rigParent still derives from stack[0]');
}

// ----- 6. Two parts sharing a leaf both wire same chain -----

{
  const project = {
    nodes: [
      { id: 'BodyXWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BreathWarp' },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'shirt', type: 'part', rigParent: 'BodyXWarp',
        mesh: { vertices: [], uvs: [], triangles: [] } },
      { id: 'pants', type: 'part', rigParent: 'BodyXWarp',
        mesh: { vertices: [], uvs: [], triangles: [] } },
    ],
  };
  synthesizeModifierStacks(project);
  // Now corrupt + inverse synth.
  project.nodes.find((n) => n.id === 'BodyXWarp').parent = 'CORRUPTED';
  synthesizeDeformerParents(project);
  assertEq(project.nodes.find((n) => n.id === 'BodyXWarp').parent,
    'BreathWarp',
    'shared-leaf: deformer parent restored consistently across both stacks');
}

// ----- 7. Round-trip after v21 migration (synthetic body-warp insert is preserved) -----

{
  const project = {
    nodes: [
      { id: 'BodyWarpZ',  type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'BodyWarpY',  type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpZ' },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpY' },
      { id: 'BodyXWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BreathWarp' },
      { id: 'shirt', type: 'part', rigParent: null,
        mesh: { vertices: [], uvs: [], triangles: [] } },
    ],
  };
  // v21 inserts synthetic modifier on shirt (no rigParent).
  migrateModifierModeFlags(project);
  const shirtBeforeRT = project.nodes.find((n) => n.id === 'shirt');
  assert(Array.isArray(shirtBeforeRT.modifiers) && shirtBeforeRT.modifiers.length === 1,
    'v21+inverse: shirt got synthetic body-warp');
  // Now invoke inverse synth — should set shirt.rigParent = BodyXWarp.
  synthesizeDeformerParents(project);
  assertEq(shirtBeforeRT.rigParent, 'BodyXWarp',
    'v21+inverse: synthetic stack lifts rigParent from null → BodyXWarp');
  // Body chain parents unaffected — they were already correct, single-mod synthetic
  // doesn't touch BodyXWarp.parent.
  assertEq(project.nodes.find((n) => n.id === 'BodyXWarp').parent,
    'BreathWarp',
    'v21+inverse: BodyXWarp.parent preserved');
}

// ----- 8. Stack with bogus deformerId is silently skipped -----

{
  const project = {
    nodes: [
      { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'shirt', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'BodyXWarp', enabled: true },
          { type: 'warp', deformerId: 'NonExistent', enabled: true },
        ] },
    ],
  };
  // Should not throw; only the BodyXWarp→NonExistent edge is written, but
  // BodyXWarp itself is real so its parent gets set to 'NonExistent' (the
  // user supplied that pairing in the stack — we honour it).
  synthesizeDeformerParents(project);
  assertEq(project.nodes.find((n) => n.id === 'BodyXWarp').parent,
    'NonExistent',
    'bogus next-id: parent set to whatever is in the stack (caller error preserved as data)');
}

// ----- Result -----

console.log(`synthesizeDeformerParents: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
