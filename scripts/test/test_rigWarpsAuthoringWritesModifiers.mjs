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

// ── Contract 3: rigParent is NOT written by authoring or inverse synth (M4) ──
{
  const project = makeProject(['p1']);
  seedRigWarps(project, [makeSpec('p1')]);
  const p1 = project.nodes.find((n) => n.id === 'p1');
  // Post-M4 (RULE-№4, 2026-05-23): `rigParent` is no longer mirrored on
  // authoring writes nor by the inverse synth. The field is retired
  // (v48 strips it from persisted saves); the seed loop must not invent
  // a value.
  assert(!('rigParent' in p1) || p1.rigParent == null,
    'C3 (M4): rigParent NOT written by authoring or inverse synth (field retired)');
}

// ── Contract 4: clearRigWarps deletes modifiers; rigParent stays untouched ──
{
  const project = makeProject(['p1', 'p2']);
  seedRigWarps(project, [makeSpec('p1'), makeSpec('p2')]);

  const p1Before = project.nodes.find((n) => n.id === 'p1');
  assert(Array.isArray(p1Before.modifiers), 'C4 setup: modifiers populated post-seed');
  // Pre-existing rigParent values on the fixture (if any) survive — the
  // inverse synth no longer nulls them out (M4). v48 strips them on load.
  // Simulate a legacy rigParent left over from a pre-M4 save.
  p1Before.rigParent = 'STALE_LEGACY_VALUE';

  clearRigWarps(project);

  const p1After = project.nodes.find((n) => n.id === 'p1');
  const p2After = project.nodes.find((n) => n.id === 'p2');
  assert(!('modifiers' in p1After),
    'C4: clearRigWarps removed p1.modifiers field');
  // M4 (RULE-№4, 2026-05-23): clearRigWarps + inverse synth no longer
  // touch rigParent — v48 migration is the single sweep that strips it
  // from persisted saves. Legacy values pass through unchanged.
  assertEq(p1After.rigParent, 'STALE_LEGACY_VALUE',
    'C4 (M4): stale rigParent untouched by clearRigWarps + inverse synth');
  assert(!('modifiers' in p2After),
    'C4: clearRigWarps removed p2.modifiers field');
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

// ── Contract 6: leaf-only stack — modifiers populated, rigParent NOT (M4) ──
// Verify by removing the body-warp chain (so the chain walk produces an
// empty stack post-leaf): the seed loop still pins modifiers[0] but
// (post-M4) does NOT mirror the leaf id into rigParent.
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
  // Leaf gets pinned into modifiers[0] + the upserted lattice object
  // exists; the synth produces a 1-entry stack. M4: rigParent is NOT
  // written.
  assertEq(p1.modifiers.length, 1, 'C6: 1-entry stack when leaf has no chain parent');
  assertEq(p1.modifiers[0].objectId, 'RigWarp_p1', 'C6: leaf is the rigWarp spec');
  assert(!('rigParent' in p1) || p1.rigParent == null,
    'C6 (M4): rigParent NOT mirrored (field retired)');
}

// ── Audit-fix MED (2026-05-23): same-id re-rig preserves leaf user flags ──
// On a re-rig where the rigWarp's spec.id is stable (the common case —
// the same part being re-fitted), the user's leaf flag-state
// (enabled / mode / showInEditor) lives ONLY on the prior modifiers[0]
// record. The writer must carry these forward; otherwise the user's
// "disabled this rigWarp" or "eye-off this rigWarp" toggles silently
// reset to defaults on every re-fit.
{
  const project = makeProject(['p1']);
  seedRigWarps(project, [makeSpec('p1')]);
  const p1 = project.nodes.find((n) => n.id === 'p1');

  // User toggles eye-off (REALTIME bit cleared) AND ✓-off (enabled=false)
  // on the leaf rigWarp.
  p1.modifiers[0].mode = 2; // RENDER only
  p1.modifiers[0].enabled = false;
  p1.modifiers[0].showInEditor = false;

  // Re-seed with the same spec id (typical Init Rig refit).
  seedRigWarps(project, [makeSpec('p1')]);
  const p1After = project.nodes.find((n) => n.id === 'p1');
  assertEq(p1After.modifiers[0].mode, 2,
    'audit-fix MED: same-id re-rig preserves leaf mode (RENDER-only)');
  assertEq(p1After.modifiers[0].enabled, false,
    'audit-fix MED: same-id re-rig preserves leaf enabled=false');
  assertEq(p1After.modifiers[0].showInEditor, false,
    'audit-fix MED: same-id re-rig preserves leaf showInEditor=false');
}

// ── Audit-fix HIGH (2026-05-23): clearRigWarps preserves Armature flags ──
// Bone-baked parts carry an Armature modifier whose flags
// (enabled/mode/showInEditor) live only on the modifier record. A blind
// `delete n.modifiers` would wipe them. The fix: preserve armature
// entries through clearRigWarps so synthesizeModifierStacks' priorFlags
// carry-forward keeps the user state.
{
  // Bone-baked legwear: no rigWarp, just an Armature modifier riding the
  // body warp chain via runtime.parent.
  const project = {
    nodes: [
      { id: 'BodyZWarp',  type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'BodyXWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BodyZWarp' },
      { id: 'leftKnee', type: 'group', boneRole: 'leftKnee', parent: null,
        transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      { id: 'legwear', type: 'part',
        modifiers: [
          // Armature modifier the user has tweaked (eye-off via mode bit).
          { type: 'armature', deformerId: 'leftKnee', enabled: true, mode: 2,
            showInEditor: false,
            data: { jointBoneId: 'leftKnee', parentBoneId: null } },
        ],
        mesh: {
          vertices: [{ x: 0, y: 0 }], boneWeights: [1], jointBoneId: 'leftKnee',
          runtime: { parent: { type: 'warp', id: 'BodyXWarp' }, keyforms: [] },
        } },
    ],
  };
  clearRigWarps(project);
  const legwear = project.nodes.find((n) => n.id === 'legwear');
  assert(Array.isArray(legwear.modifiers),
    'audit-fix HIGH: clearRigWarps preserves modifiers field on bone-baked part');
  const armature = legwear.modifiers.find((m) => m.type === 'armature');
  assert(armature, 'audit-fix HIGH: armature modifier survived clearRigWarps');
  assertEq(armature.mode, 2,
    'audit-fix HIGH: user armature mode (RENDER-only) preserved');
  assertEq(armature.showInEditor, false,
    'audit-fix HIGH: user armature showInEditor=false preserved');
}

// ── Audit-fix follow-up: armature-only stack falls through to runtime.parent ──
// After clearRigWarps strips warp leaves on a bone-baked part, the synth
// must skip past the leading armature entry and fall through to the
// runtime.parent fallback so the body-warp chain is re-derived.
{
  // Bone-baked part with armature-only modifiers (post-clearRigWarps shape).
  // runtime.parent points at BodyXWarp lattice — the synth should rebuild
  // the stack from there + re-append Armature on top.
  const project = {
    nodes: [
      { id: 'BodyZWarp',  type: 'object', objectKind: 'lattice', parent: null,
        dataId: 'BodyZWarp__cage' },
      { id: 'BodyZWarp__cage', type: 'meshData', isLatticeCage: true, vertices: [] },
      { id: 'BodyXWarp',  type: 'object', objectKind: 'lattice', parent: 'BodyZWarp',
        dataId: 'BodyXWarp__cage' },
      { id: 'BodyXWarp__cage', type: 'meshData', isLatticeCage: true, vertices: [] },
      { id: 'leftKnee', type: 'group', boneRole: 'leftKnee', parent: null,
        transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      { id: 'legwear', type: 'part',
        modifiers: [
          { type: 'armature', deformerId: 'leftKnee', enabled: true, mode: 3,
            showInEditor: true,
            data: { jointBoneId: 'leftKnee', parentBoneId: null } },
        ],
        mesh: {
          vertices: [{ x: 0, y: 0 }], boneWeights: [1], jointBoneId: 'leftKnee',
          runtime: { parent: { type: 'warp', id: 'BodyXWarp' }, keyforms: [] },
        } },
    ],
  };
  // Import the synth directly so we can verify the leaf-resolution skip.
  const { synthesizeModifierStacks } = await import('../../src/store/deformerNodeSync.js');
  synthesizeModifierStacks(project);
  const legwear = project.nodes.find((n) => n.id === 'legwear');
  assert(legwear.modifiers.length >= 2,
    'audit-fix follow-up: synth re-derived body-warp chain past armature-only modifiers[0]');
  const types = legwear.modifiers.map((m) => m.type);
  assert(types.includes('lattice'),
    'audit-fix follow-up: lattice chain re-emerged from runtime.parent fallback');
  assertEq(legwear.modifiers[legwear.modifiers.length - 1].type, 'armature',
    'audit-fix follow-up: armature still appended last');
}

console.log(`rigWarpsAuthoringWritesModifiers: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
