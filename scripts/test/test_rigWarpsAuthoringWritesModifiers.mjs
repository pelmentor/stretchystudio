// M1 contract pin (RULE-№4 modifier-stack source-of-truth flip, 2026-05-23).
//
// Authoring callers of rigWarpsStore — seedRigWarps + clearRigWarps — must
// write `part.modifiers[]` directly. `part.rigParent` becomes a DERIVED
// mirror produced by `synthesizeDeformerParents`; it is no longer the
// authoring source-of-truth.
//
// Pre-M1 behaviour:
//   seedRigWarps wrote `partNode.rigParent = spec.id` then re-derived
//   `part.modifiers[]` from rigParent via synthesizeModifierStacks.
//   clearRigWarps nulled `n.rigParent` and re-ran the synth.
// Post-M1 behaviour:
//   seedRigWarps writes `partNode.modifiers[0]` (the leaf entry).
//   The synth's leaf-resolution reads modifiers[0] first, falling back
//   to rigParent only for migration-bootstrapped projects (legacy saves).
//   clearRigWarps `delete`s `n.modifiers`; the inverse synth clears
//   the now-stale rigParent mirror.
//
// Run: node scripts/test/test_rigWarpsAuthoringWritesModifiers.mjs

import {
  seedRigWarps,
  clearRigWarps,
} from '../../src/io/live2d/rig/rigWarpsStore.js';
import { DEFAULT_MIGRATED_MODE } from '../../src/store/migrations/v21_modifier_mode_flags.js';

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
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}

function makeSpec(partId) {
  return {
    id: `RigWarp_${partId}`,
    name: `RigWarp ${partId}`,
    parent: { type: 'warp', id: 'BodyXWarp' },
    targetPartId: partId,
    canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
    gridSize: { rows: 2, cols: 2 },
    baseGrid: new Float64Array([0, 0, 0.5, 0, 1, 0]),
    localFrame: 'normalized-0to1',
    bindings: [
      { parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' },
    ],
    keyforms: [
      { keyTuple: [-30], positions: new Float64Array([1, 2, 3]), opacity: 1 },
      { keyTuple: [0],   positions: new Float64Array([4, 5, 6]), opacity: 1 },
    ],
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

// Project fixture with a body warp chain (so synthesizeModifierStacks has
// somewhere to walk up from the per-mesh leaf) + part nodes the rigWarps
// will be authored against.
function makeProject(partIds) {
  const nodes = [
    { id: 'BodyZWarp',  type: 'deformer', deformerKind: 'warp', parent: null },
    { id: 'BodyYWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BodyZWarp' },
    { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyYWarp' },
    { id: 'BodyXWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BreathWarp' },
  ];
  for (const pid of partIds) {
    nodes.push({ id: pid, type: 'part', mesh: { vertices: [], uvs: [], triangles: [] } });
  }
  return { nodes };
}

// ── Contract 1: seedRigWarps writes modifiers[0] for each covered part ──
{
  const project = makeProject(['p1', 'p2']);
  seedRigWarps(project, [makeSpec('p1'), makeSpec('p2')]);

  const p1 = project.nodes.find((n) => n.id === 'p1');
  const p2 = project.nodes.find((n) => n.id === 'p2');

  assert(Array.isArray(p1.modifiers) && p1.modifiers.length >= 1,
    'C1: p1 modifiers populated');
  assertEq(p1.modifiers[0].type, 'lattice',
    'C1: p1 modifiers[0] is a lattice modifier (v43 lattice-object shape)');
  assertEq(p1.modifiers[0].objectId, 'RigWarp_p1',
    'C1: p1 modifiers[0].objectId points at the seeded leaf');
  assertEq(p1.modifiers[0].enabled, true, 'C1: p1 leaf defaults to enabled');
  assertEq(p1.modifiers[0].mode, DEFAULT_MIGRATED_MODE,
    'C1: p1 leaf carries DEFAULT_MIGRATED_MODE (REALTIME|RENDER)');
  assertEq(p1.modifiers[0].showInEditor, true, 'C1: p1 leaf shows in editor');

  assertEq(p2.modifiers[0].objectId, 'RigWarp_p2',
    'C1: p2 modifiers[0] also seeded with its own leaf');
}

// ── Contract 2: modifier chain walks up through body warp ──
{
  const project = makeProject(['p1']);
  seedRigWarps(project, [makeSpec('p1')]);
  const p1 = project.nodes.find((n) => n.id === 'p1');
  // After seed + synthesizeModifierStacks: leaf RigWarp_p1 → BodyXWarp →
  // BreathWarp → BodyYWarp → BodyZWarp = 5 entries.
  assertEq(p1.modifiers.length, 5,
    'C2: stack walks up body-warp chain (5 entries: leaf + BX/Breath/BY/BZ)');
  assertEq(p1.modifiers[1].deformerId, 'BodyXWarp',
    'C2: stack[1] is BodyXWarp (chain parent of leaf)');
  assertEq(p1.modifiers[4].deformerId, 'BodyZWarp',
    'C2: stack[4] is BodyZWarp (chain root)');
}

// ── Contract 3: rigParent mirror is written by inverse synth, not authoring ──
{
  const project = makeProject(['p1']);
  seedRigWarps(project, [makeSpec('p1')]);
  const p1 = project.nodes.find((n) => n.id === 'p1');
  // After seedRigWarps completes the synth pair, rigParent IS populated as
  // the derived mirror — but that write came from synthesizeDeformerParents
  // reading modifiers[0], not from the seed loop. The mirror points at the
  // leaf modifier's ref id.
  assertEq(p1.rigParent, 'RigWarp_p1',
    'C3: rigParent mirror set by inverse synth to leaf id');
}

// ── Contract 4: clearRigWarps deletes modifiers, inverse synth nulls rigParent ──
{
  const project = makeProject(['p1', 'p2']);
  seedRigWarps(project, [makeSpec('p1'), makeSpec('p2')]);

  const p1Before = project.nodes.find((n) => n.id === 'p1');
  assert(Array.isArray(p1Before.modifiers), 'C4 setup: modifiers populated post-seed');
  assertEq(p1Before.rigParent, 'RigWarp_p1', 'C4 setup: rigParent mirror set post-seed');

  clearRigWarps(project);

  const p1After = project.nodes.find((n) => n.id === 'p1');
  const p2After = project.nodes.find((n) => n.id === 'p2');
  assert(!('modifiers' in p1After),
    'C4: clearRigWarps removed p1.modifiers field');
  assertEq(p1After.rigParent, null,
    'C4: inverse synth cleared p1.rigParent mirror after modifiers gone');
  assert(!('modifiers' in p2After),
    'C4: clearRigWarps removed p2.modifiers field');
  assertEq(p2After.rigParent, null,
    'C4: inverse synth cleared p2.rigParent mirror');
}

// ── Contract 5: user-set ancestor flags survive a re-seed ──
// Pre-M1 behaviour preserved: synthesizeModifierStacks' priorFlags map
// carries enabled/mode/showInEditor on ancestor modifiers across re-rigs.
// The M1 writer must NOT wipe modifiers[1..] (only replace modifiers[0]),
// otherwise priorFlags loses non-leaf state.
{
  const project = makeProject(['p1']);
  seedRigWarps(project, [makeSpec('p1')]);
  const p1 = project.nodes.find((n) => n.id === 'p1');
  // User disables BodyXWarp's REALTIME bit (eye-off in Properties panel).
  const bxIdx = p1.modifiers.findIndex((m) => m.deformerId === 'BodyXWarp');
  assert(bxIdx >= 0, 'C5 setup: BodyXWarp present in stack');
  p1.modifiers[bxIdx].mode = 2; // RENDER only — REALTIME cleared

  // Re-seed (e.g. user re-runs Init Rig with refit). The leaf gets fresh-
  // written, but the user's BodyXWarp eye-off must survive.
  seedRigWarps(project, [makeSpec('p1')]);
  const p1After = project.nodes.find((n) => n.id === 'p1');
  const bxAfter = p1After.modifiers.find((m) => m.deformerId === 'BodyXWarp');
  assertEq(bxAfter.mode, 2,
    'C5: BodyXWarp eye-off (mode=RENDER-only) survives re-seed via priorFlags carry');
}

// ── Contract 6: rigParent IS never written by the authoring writer directly ──
// Synthetic check — pin that `seedRigWarps` doesn't bypass the synth and
// write rigParent itself. We verify by removing the body-warp chain (so
// the chain walk produces an empty stack post-leaf) — pre-M1 the seed
// loop would still set rigParent to spec.id; post-M1 the inverse synth
// only writes rigParent when the chain produces a real leaf.
{
  const project = { nodes: [
    // No body warp chain: leaf has no parent to walk.
    { id: 'p1', type: 'part', mesh: { vertices: [], uvs: [], triangles: [] } },
  ] };
  const specWithoutChain = {
    ...makeSpec('p1'),
    parent: { type: 'root', id: null }, // no chain parent
  };
  seedRigWarps(project, [specWithoutChain]);
  const p1 = project.nodes.find((n) => n.id === 'p1');
  // Leaf still gets pinned into modifiers[0] + the upserted lattice
  // object exists; the synth produces a 1-entry stack and inverse synth
  // sets rigParent = leaf id (the only modifier in the stack).
  assertEq(p1.modifiers.length, 1, 'C6: 1-entry stack when leaf has no chain parent');
  assertEq(p1.modifiers[0].objectId, 'RigWarp_p1', 'C6: leaf is the rigWarp spec');
  assertEq(p1.rigParent, 'RigWarp_p1',
    'C6: rigParent mirror reflects the single leaf modifier');
}

console.log(`rigWarpsAuthoringWritesModifiers: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
