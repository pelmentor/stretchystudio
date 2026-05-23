// BONE_ARMATURE_INDEPENDENCE Phase A — Armature modifier emit + UI shape.
//
// Covers `synthesizeModifierStacks` adding a `type: 'armature'` entry
// for parts with `mesh.boneWeights + jointBoneId`, and the round-trip
// invariant with `synthesizeDeformerParents` (which must skip armature
// entries when deriving rigParent / deformer-parent).
//
// Mirrors `reference/blender/source/blender/makesdna/DNA_modifier_types.h:851`
// (ArmatureModifierData) — the modifier carries `{jointBoneId,
// parentBoneId, deformFlag, vertexGroupName}` analogous to
// {object, defgrp_name, deformflag}.
//
// Run: node scripts/test/test_armatureModifier.mjs

import {
  synthesizeModifierStacks,
  synthesizeDeformerParents,
} from '../../src/store/deformerNodeSync.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Test 1: bone-weighted part with no deformer chain → armature only ─

{
  const project = {
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm', transform: { pivotX: 100, pivotY: 0 }, pose: {} },
      {
        id: 'handwear-l', type: 'part', name: 'handwear-l', parent: 'leftArm',
        mesh: {
          vertices: [{ x: 100, y: 0 }, { x: 110, y: 5 }],
          boneWeights: [1, 1],
          jointBoneId: 'leftElbow',
        },
      },
    ],
  };
  synthesizeModifierStacks(project);
  const part = project.nodes.find((n) => n.id === 'handwear-l');
  const stack = part.modifiers ?? [];
  assert(stack.length === 1, 'Test 1: bone-weighted part has 1 modifier');
  assert(stack[0]?.type === 'armature', 'Test 1: modifier type is armature');
  assert(stack[0]?.deformerId === 'leftElbow', 'Test 1: modifier deformerId = jointBoneId');
  assert(stack[0]?.data?.jointBoneId === 'leftElbow', 'Test 1: data.jointBoneId set');
  assert(stack[0]?.data?.jointBoneRole === 'leftElbow', 'Test 1: data.jointBoneRole = "leftElbow"');
  assert(stack[0]?.data?.parentBoneId === 'leftArm', 'Test 1: data.parentBoneId = leftArm');
  assert(stack[0]?.data?.parentBoneRole === 'leftArm', 'Test 1: data.parentBoneRole = "leftArm"');
  assert(stack[0]?.data?.deformFlag === 1, 'Test 1: deformFlag = 1 (ARM_DEF_VGROUP)');
  assert(stack[0]?.enabled === true, 'Test 1: enabled = true');
}

// ── Test 2: bone-weighted part WITH deformer chain → armature is APPENDED ─

{
  const project = {
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm', transform: { pivotX: 100, pivotY: 0 }, pose: {} },
      { id: 'WarpA', type: 'deformer', deformerKind: 'warp', parent: null },
      {
        id: 'handwear-l', type: 'part', name: 'handwear-l', parent: 'leftArm',
        modifiers: [
          { type: 'warp', deformerId: 'WarpA', enabled: true, mode: 7, showInEditor: true },
        ],
        mesh: {
          vertices: [{ x: 100, y: 0 }],
          boneWeights: [1],
          jointBoneId: 'leftElbow',
        },
      },
    ],
  };
  synthesizeModifierStacks(project);
  const part = project.nodes.find((n) => n.id === 'handwear-l');
  const stack = part.modifiers ?? [];
  assert(stack.length === 2, 'Test 2: deformer + armature → 2 modifiers');
  assert(stack[0]?.type === 'warp', 'Test 2: stack[0] is the deformer (leaf)');
  assert(stack[0]?.deformerId === 'WarpA', 'Test 2: stack[0] points at WarpA');
  assert(stack[1]?.type === 'armature', 'Test 2: stack[1] is the Armature (after deformer chain)');
}

// ── Test 3: non-bone-weighted part has NO armature modifier ─

{
  const project = {
    nodes: [
      { id: 'torso', type: 'group', boneRole: 'torso', transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      { id: 'WarpT', type: 'deformer', deformerKind: 'warp', parent: null },
      {
        id: 'topwear', type: 'part', parent: 'torso',
        modifiers: [
          { type: 'warp', deformerId: 'WarpT', enabled: true, mode: 7, showInEditor: true },
        ],
        mesh: { vertices: [{ x: 0, y: 0 }] }, // NO boneWeights / jointBoneId
      },
    ],
  };
  synthesizeModifierStacks(project);
  const part = project.nodes.find((n) => n.id === 'topwear');
  const stack = part.modifiers ?? [];
  assert(stack.length === 1, 'Test 3: topwear has 1 modifier (the warp)');
  assert(stack[0]?.type === 'warp', 'Test 3: only the warp is present');
  assert(!stack.some((m) => m?.type === 'armature'), 'Test 3: NO armature on non-bone-weighted part');
}

// ── Test 4: empty boneWeights array → no armature entry (defensive) ─

{
  const project = {
    nodes: [
      { id: 'arm', type: 'group', boneRole: 'leftArm', transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      {
        id: 'p', type: 'part', parent: 'arm',
        mesh: {
          vertices: [{ x: 0, y: 0 }],
          boneWeights: [],            // empty
          jointBoneId: 'arm',
        },
      },
    ],
  };
  synthesizeModifierStacks(project);
  const part = project.nodes.find((n) => n.id === 'p');
  assert(!part.modifiers || part.modifiers.length === 0, 'Test 4: empty boneWeights → no armature emitted');
}

// ── Test 5: jointBoneId points at non-bone group → no armature emit ─

{
  const project = {
    nodes: [
      { id: 'plain', type: 'group', transform: { pivotX: 0, pivotY: 0 } }, // no boneRole
      {
        id: 'p', type: 'part', parent: 'plain',
        mesh: {
          vertices: [{ x: 0, y: 0 }],
          boneWeights: [1],
          jointBoneId: 'plain',
        },
      },
    ],
  };
  synthesizeModifierStacks(project);
  const part = project.nodes.find((n) => n.id === 'p');
  assert(!part.modifiers || part.modifiers.length === 0, 'Test 5: non-bone jointBoneId → no armature emitted');
}

// ── Test 6: synthesizeDeformerParents armature-only stack — no-op (M4) ─

{
  // M4 (RULE-№4, 2026-05-23): the inverse synth no longer writes
  // `rigParent` (the field is retired; v48 strips it on load). For an
  // armature-only stack, the function is effectively a no-op — any
  // pre-existing rigParent value passes through unchanged.
  const project = {
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm', transform: { pivotX: 100, pivotY: 0 }, pose: {} },
      {
        id: 'p', type: 'part', parent: 'leftArm',
        rigParent: null,
        modifiers: [
          { type: 'armature', deformerId: 'leftElbow', enabled: true, mode: 3, data: { jointBoneId: 'leftElbow', parentBoneId: 'leftArm' } },
        ],
        mesh: { vertices: [{ x: 0, y: 0 }], boneWeights: [1], jointBoneId: 'leftElbow' },
      },
    ],
  };
  synthesizeDeformerParents(project);
  const part = project.nodes.find((n) => n.id === 'p');
  // M4: rigParent untouched (was null, stays null).
  assert(part.rigParent === null, 'Test 6 (M4): armature-only stack — rigParent untouched');
}

// ── Test 7: synthesizeDeformerParents maintains deformer chain even with armature in the stack ─

{
  const project = {
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm', transform: { pivotX: 100, pivotY: 0 }, pose: {} },
      { id: 'WarpA', type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'WarpB', type: 'deformer', deformerKind: 'warp', parent: null },
      {
        id: 'p', type: 'part', parent: 'leftArm',
        modifiers: [
          { type: 'warp', deformerId: 'WarpA', enabled: true, mode: 3, data: {} },
          { type: 'warp', deformerId: 'WarpB', enabled: true, mode: 3, data: {} },
          { type: 'armature', deformerId: 'leftElbow', enabled: true, mode: 3, data: { jointBoneId: 'leftElbow', parentBoneId: 'leftArm' } },
        ],
        mesh: { vertices: [{ x: 0, y: 0 }], boneWeights: [1], jointBoneId: 'leftElbow' },
      },
    ],
  };
  synthesizeDeformerParents(project);
  const part = project.nodes.find((n) => n.id === 'p');
  const warpA = project.nodes.find((n) => n.id === 'WarpA');
  // M4: rigParent is NOT written.
  assert(!('rigParent' in part) || part.rigParent == null,
    'Test 7 (M4): inverse synth does not write rigParent (field retired)');
  // The deformer chain link IS still maintained — that's still the
  // function's purpose for the cmo3 export pipeline.
  assert(warpA.parent === 'WarpB', 'Test 7: deformer parent chain reflects the warp ordering');
}

// ── Test 8: round-trip — synthesize stacks → synthesize parents preserves deformer chain ─

{
  const project = {
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', transform: { pivotX: 0, pivotY: 0 }, pose: {} },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', parent: 'leftArm', transform: { pivotX: 100, pivotY: 0 }, pose: {} },
      { id: 'WarpA', type: 'deformer', deformerKind: 'warp', parent: 'WarpB' },
      { id: 'WarpB', type: 'deformer', deformerKind: 'warp', parent: null },
      {
        id: 'p', type: 'part', parent: 'leftArm',
        modifiers: [
          { type: 'warp', deformerId: 'WarpA', enabled: true, mode: 7, showInEditor: true },
        ],
        mesh: { vertices: [{ x: 0, y: 0 }], boneWeights: [1], jointBoneId: 'leftElbow' },
      },
    ],
  };
  synthesizeModifierStacks(project);
  const beforeWarpAParent = project.nodes.find((n) => n.id === 'WarpA').parent;
  // Mutate to simulate post-load shape, then synthesize back.
  synthesizeDeformerParents(project);
  const afterWarpAParent = project.nodes.find((n) => n.id === 'WarpA').parent;
  assert(beforeWarpAParent === afterWarpAParent, 'Test 8: deformer parent chain unchanged after round-trip');
}

console.log(`\narmatureModifier: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
