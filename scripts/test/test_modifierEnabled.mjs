// Modifier-enabled live-render gating.
//
// Bug: Properties → Modifier Stack → toggle off → effect still applied
// in Live Preview. Root cause was that `synthesizeDeformerNodesForExport`
// + `selectRigSpec._buildArtMeshes` ignored `modifier.enabled`. The
// modifier stack is now the live source of truth for which deformers
// apply to a given part — disabled entries are skipped.
//
// Run: node scripts/test/test_modifierEnabled.mjs

import { synthesizeDeformerNodesForExport } from '../../src/io/live2d/rig/synthesizeDeformerNodesForExport.js';
import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';
import {
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
} from '../../src/store/migrations/v21_modifier_mode_flags.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function approx(a, b, eps = 1e-3) {
  return Math.abs(a - b) <= eps;
}

function findById(arr, id) {
  return arr.find((n) => n?.id === id) ?? null;
}

// ---- 1. synth: disabled leaf modifier doesn't establish parent edge ----
{
  const project = {
    nodes: [
      {
        id: 'face', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'RigWarp_face',
            enabled: false,
            data: { name: 'RigWarp_face', gridSize: { rows: 3, cols: 3 } } },
          { type: 'warp', deformerId: 'BodyXWarp',
            data: { name: 'BodyXWarp', gridSize: { rows: 5, cols: 5 } } },
        ],
      },
    ],
  };
  const synth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  // RigWarp_face is disabled in face's only stack → not emitted via the
  // modifier-stack pass. With includeOrphans:false, it's not emitted at
  // all. Only BodyXWarp survives.
  assert(synth.length === 1, 'disabled leaf dropped from synth output (no orphan fallback)');
  assert(findById(synth, 'BodyXWarp')?.parent === null, 'enabled outermost has null parent');
  assert(findById(synth, 'RigWarp_face') === null, 'disabled deformer absent from synth');
}

// ---- 2. synth: disabled middle skipped, parent edge walks past ----
{
  const project = {
    nodes: [
      {
        id: 'arm', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'RigWarp_arm',
            data: { name: 'RigWarp_arm' } },
          { type: 'warp', deformerId: 'BodyZWarp',
            enabled: false,
            data: { name: 'BodyZWarp' } },
          { type: 'warp', deformerId: 'BodyYWarp',
            data: { name: 'BodyYWarp' } },
        ],
      },
    ],
  };
  const synth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  assert(synth.length === 2, 'disabled middle drops only itself');
  const leaf = findById(synth, 'RigWarp_arm');
  assert(leaf?.parent === 'BodyYWarp',
    'leaf parent walks past disabled middle to next enabled');
  const outermost = findById(synth, 'BodyYWarp');
  assert(outermost?.parent === null, 'outermost parent stays null');
  assert(findById(synth, 'BodyZWarp') === null, 'disabled middle absent');
}

// ---- 3. synth: shared deformer disabled by one part, enabled by another ----
{
  const project = {
    nodes: [
      {
        id: 'face', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'RigWarp_face',
            data: { name: 'RigWarp_face' } },
          { type: 'warp', deformerId: 'BodyXWarp',
            enabled: false,                    // face disables shared body warp
            data: { name: 'BodyXWarp' } },
        ],
      },
      {
        id: 'topwear', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'RigWarp_topwear',
            data: { name: 'RigWarp_topwear' } },
          { type: 'warp', deformerId: 'BodyXWarp',
            data: { name: 'BodyXWarp' } },     // topwear keeps it
        ],
      },
    ],
  };
  const synth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  // RigWarp_face, RigWarp_topwear, BodyXWarp = 3 unique
  assert(synth.length === 3, 'shared deformer survives via the part that has it enabled');
  // RigWarp_face's parent should be null (face's filtered stack ends at it).
  const faceLeaf = findById(synth, 'RigWarp_face');
  assert(faceLeaf?.parent === null, 'face leaf parent = null (skipped disabled BodyXWarp)');
  // RigWarp_topwear's parent should be BodyXWarp (topwear has it enabled).
  const topwearLeaf = findById(synth, 'RigWarp_topwear');
  assert(topwearLeaf?.parent === 'BodyXWarp', 'topwear leaf parent = BodyXWarp');
  // BodyXWarp's parent edge from topwear's stack = null.
  const shared = findById(synth, 'BodyXWarp');
  assert(shared?.parent === null, 'shared deformer parent edge from enabled stack');
}

// ---- 4. synth: all modifiers disabled — falls through to orphan fallback ----
{
  const project = {
    nodes: [
      {
        id: 'orphan-warp', type: 'deformer', deformerKind: 'warp',
        name: 'BodyXWarp', parent: null,
      },
      {
        id: 'face', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'orphan-warp', enabled: false,
            data: { name: 'BodyXWarp' } },
        ],
      },
    ],
  };
  const synth = synthesizeDeformerNodesForExport(project, { includeOrphans: true, suppressFlare: true });
  // Disabled in face's stack → not emitted via modifier pass.
  // But it exists in project.nodes → orphan fallback emits it.
  assert(synth.length === 1, 'orphan fallback emits disabled-everywhere deformer');
  assert(findById(synth, 'orphan-warp')?.parent === null, 'orphan parent from authored project.nodes');
}

// ---- 5. selectRigSpec: leaf-modifier disable redirects artMesh.parent to next enabled ----
{
  // Build a project with: 1 part with 2-warp modifier stack + cached
  // runtime baked at "all enabled" pointing to the leaf.
  // Leaf bbox = [0..100, 0..100]. Outer bbox = [0..200, 0..200].
  // Vertex stored at leaf-local (0.5, 0.5) — that's canvas (50, 50).
  // After disabling leaf, effectiveParent = outer warp; vertex
  // re-projected: canvas (50, 50) → outer-local (50/200, 50/200) = (0.25, 0.25).
  const leafLifted = new Float64Array([
    0, 0,    100, 0,
    0, 100,  100, 100,
  ]);
  const outerLifted = new Float64Array([
    0, 0,    200, 0,
    0, 200,  200, 200,
  ]);
  const project = {
    canvas: { width: 400, height: 400 },
    parameters: [],
    nodes: [
      // Outer warp deformer.
      {
        id: 'OuterWarp', type: 'deformer', deformerKind: 'warp',
        name: 'OuterWarp', parent: null,
        gridSize: { rows: 2, cols: 2 },
        baseGrid: outerLifted,
        keyforms: [{ keyTuple: [], positions: outerLifted }],
        bindings: [],
      },
      // Leaf warp deformer (parent = OuterWarp).
      {
        id: 'LeafWarp', type: 'deformer', deformerKind: 'warp',
        name: 'LeafWarp', parent: 'OuterWarp',
        gridSize: { rows: 2, cols: 2 },
        baseGrid: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]),
        keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]) }],
        bindings: [],
      },
      // Part with mesh + modifier stack + runtime cache.
      {
        id: 'face', type: 'part',
        name: 'face',
        mesh: {
          vertices: [{ x: 50, y: 50 }],
          triangles: [],
          uvs: [],
          runtime: {
            // Cached at Init Rig time when leaf was enabled. Vertex in
            // leaf-local frame at (0.5, 0.5).
            parent: { type: 'warp', id: 'LeafWarp' },
            bindings: [],
            keyforms: [{
              keyTuple: [],
              vertexPositions: [0.5, 0.5],
              opacity: 1,
            }],
          },
        },
        modifiers: [
          {
            type: 'warp', deformerId: 'LeafWarp', enabled: false,  // disabled!
            data: {
              name: 'LeafWarp',
              gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]) }],
              bindings: [],
            },
          },
          {
            type: 'warp', deformerId: 'OuterWarp',  // enabled (default)
            data: {
              name: 'OuterWarp',
              gridSize: { rows: 1, cols: 1 },
              baseGrid: outerLifted,
              keyforms: [{ keyTuple: [], positions: outerLifted }],
              bindings: [],
            },
          },
        ],
      },
    ],
  };
  const rigSpec = selectRigSpec(project);
  const am = rigSpec.artMeshes.find((a) => a.id === 'face');
  assert(!!am, 'artMesh built for face');
  assert(am?.parent?.type === 'warp', 'artMesh.parent type = warp');
  assert(am?.parent?.id === 'OuterWarp',
    'artMesh.parent redirected to OuterWarp (skipping disabled LeafWarp)');
  // The cached vertex was (0.5, 0.5) in LeafWarp-local frame. LeafWarp
  // rest bbox = [0..100, 0..100], so canvas (50, 50). OuterWarp rest
  // bbox = [0..200, 0..200], so OuterWarp-local = (0.25, 0.25).
  const v = am?.keyforms?.[0]?.vertexPositions;
  assert(approx(v[0], 0.25), `keyform vertex x re-projected to outer-local 0.25 (got ${v[0]})`);
  assert(approx(v[1], 0.25), `keyform vertex y re-projected to outer-local 0.25 (got ${v[1]})`);
}

// ---- 6. selectRigSpec: ALL modifiers disabled — artMesh.parent = root ----
{
  const project = {
    canvas: { width: 400, height: 400 },
    parameters: [],
    nodes: [
      {
        id: 'BodyWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BodyWarp', parent: null,
        gridSize: { rows: 2, cols: 2 },
        baseGrid: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]),
        keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]) }],
        bindings: [],
      },
      {
        id: 'face', type: 'part',
        name: 'face',
        mesh: {
          vertices: [{ x: 50, y: 50 }],
          triangles: [],
          uvs: [],
          runtime: {
            parent: { type: 'warp', id: 'BodyWarp' },
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [0.5, 0.5], opacity: 1 }],
          },
        },
        modifiers: [
          {
            type: 'warp', deformerId: 'BodyWarp', enabled: false,
            data: {
              name: 'BodyWarp',
              gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]) }],
              bindings: [],
            },
          },
        ],
      },
    ],
  };
  const rigSpec = selectRigSpec(project);
  const am = rigSpec.artMeshes.find((a) => a.id === 'face');
  assert(am?.parent?.type === 'root', 'artMesh.parent = root when all modifiers disabled');
  // Vertex was (0.5, 0.5) in BodyWarp-local. BodyWarp rest bbox =
  // [0..100, 0..100], so canvas (50, 50). Root frame = canvas-px.
  const v = am?.keyforms?.[0]?.vertexPositions;
  assert(approx(v[0], 50), `keyform vertex x re-projected to canvas-px 50 (got ${v[0]})`);
  assert(approx(v[1], 50), `keyform vertex y re-projected to canvas-px 50 (got ${v[1]})`);
}

// ---- 7. selectRigSpec: all enabled — runtime cache passes through unchanged ----
{
  const project = {
    canvas: { width: 400, height: 400 },
    parameters: [],
    nodes: [
      {
        id: 'BodyWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BodyWarp', parent: null,
        gridSize: { rows: 2, cols: 2 },
        baseGrid: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]),
        keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]) }],
        bindings: [],
      },
      {
        id: 'face', type: 'part',
        name: 'face',
        mesh: {
          vertices: [{ x: 50, y: 50 }],
          triangles: [],
          uvs: [],
          runtime: {
            parent: { type: 'warp', id: 'BodyWarp' },
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [0.5, 0.5], opacity: 1 }],
          },
        },
        modifiers: [
          {
            type: 'warp', deformerId: 'BodyWarp', // enabled by default
            data: {
              name: 'BodyWarp',
              gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]) }],
              bindings: [],
            },
          },
        ],
      },
    ],
  };
  const rigSpec = selectRigSpec(project);
  const am = rigSpec.artMeshes.find((a) => a.id === 'face');
  assert(am?.parent?.id === 'BodyWarp', 'artMesh.parent unchanged when all enabled');
  const v = am?.keyforms?.[0]?.vertexPositions;
  assert(approx(v[0], 0.5), `keyform vertex passed through (got ${v[0]})`);
  assert(approx(v[1], 0.5), `keyform vertex passed through (got ${v[1]})`);
}

// ---- 8. Mode bitmask: REALTIME bit cleared excludes modifier from live render ----
{
  const project = {
    nodes: [
      {
        id: 'face', type: 'part',
        modifiers: [
          // Disabled REALTIME (bit 0 cleared) but RENDER on — would only
          // contribute to export bake. For the live-render path
          // (selectRigSpec default), it should be invisible.
          { type: 'warp', deformerId: 'RigWarp_face',
            mode: MODIFIER_MODE_RENDER,
            data: { name: 'RigWarp_face' } },
          { type: 'warp', deformerId: 'BodyXWarp',
            data: { name: 'BodyXWarp' } },
        ],
      },
    ],
  };
  // Default — REALTIME mode required. RigWarp_face is render-only, so
  // dropped.
  const liveSynth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  assert(liveSynth.length === 1,
    'render-only modifier hidden from live-render synth');
  assert(findById(liveSynth, 'RigWarp_face') === null,
    'render-only modifier absent under REALTIME requiredMode');
  // Explicit RENDER eval → both visible.
  const renderSynth = synthesizeDeformerNodesForExport(project, {
    includeOrphans: false,
    requiredMode: MODIFIER_MODE_RENDER,
  });
  assert(renderSynth.length === 2,
    'render-only modifier visible under RENDER requiredMode');
  const leaf = findById(renderSynth, 'RigWarp_face');
  assert(leaf?.parent === 'BodyXWarp',
    'render-only modifier parent edge intact under RENDER requiredMode');
}

// ---- 9a. modifierChain: shape + ordering ----
{
  // Two parts sharing a 3-warp chain. One part disables the MIDDLE warp;
  // the other keeps all enabled. Each artMesh.modifierChain should
  // reflect the part's effective stack post-filter.
  const project = {
    canvas: { width: 400, height: 400 },
    parameters: [],
    nodes: [
      {
        id: 'BodyZWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BodyZWarp', parent: null,
        gridSize: { rows: 1, cols: 1 },
        baseGrid: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]),
        keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]) }],
        bindings: [],
      },
      {
        id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BodyXWarp', parent: 'BodyZWarp',
        gridSize: { rows: 1, cols: 1 },
        baseGrid: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]),
        keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]) }],
        bindings: [],
      },
      {
        id: 'BreathWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BreathWarp', parent: 'BodyXWarp',
        gridSize: { rows: 1, cols: 1 },
        baseGrid: new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]),
        keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]) }],
        bindings: [],
      },
      // Part A — all 3 modifiers active.
      {
        id: 'face', type: 'part', name: 'face',
        mesh: {
          vertices: [{ x: 50, y: 50 }],
          triangles: [],
          uvs: [],
          runtime: {
            parent: { type: 'warp', id: 'BreathWarp' },
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [0.5, 0.5], opacity: 1 }],
          },
        },
        modifiers: [
          { type: 'warp', deformerId: 'BreathWarp',
            data: { name: 'BreathWarp', gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]) }],
              bindings: [] } },
          { type: 'warp', deformerId: 'BodyXWarp',
            data: { name: 'BodyXWarp', gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]) }],
              bindings: [] } },
          { type: 'warp', deformerId: 'BodyZWarp',
            data: { name: 'BodyZWarp', gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]) }],
              bindings: [] } },
        ],
      },
      // Part B — middle modifier disabled (BodyXWarp).
      {
        id: 'topwear', type: 'part', name: 'topwear',
        mesh: {
          vertices: [{ x: 50, y: 50 }],
          triangles: [],
          uvs: [],
          runtime: {
            parent: { type: 'warp', id: 'BreathWarp' },
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [0.5, 0.5], opacity: 1 }],
          },
        },
        modifiers: [
          { type: 'warp', deformerId: 'BreathWarp',
            data: { name: 'BreathWarp', gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]) }],
              bindings: [] } },
          { type: 'warp', deformerId: 'BodyXWarp', enabled: false,  // disabled middle
            data: { name: 'BodyXWarp', gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]) }],
              bindings: [] } },
          { type: 'warp', deformerId: 'BodyZWarp',
            data: { name: 'BodyZWarp', gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]) }],
              bindings: [] } },
        ],
      },
    ],
  };
  const rigSpec = selectRigSpec(project);
  const face = rigSpec.artMeshes.find((a) => a.id === 'face');
  const topwear = rigSpec.artMeshes.find((a) => a.id === 'topwear');
  assert(Array.isArray(face?.modifierChain) && face.modifierChain.length === 3,
    'face has full 3-modifier chain');
  assert(face.modifierChain[0].id === 'BreathWarp', 'face chain leaf = BreathWarp');
  assert(face.modifierChain[1].id === 'BodyXWarp', 'face chain middle = BodyXWarp');
  assert(face.modifierChain[2].id === 'BodyZWarp', 'face chain outer = BodyZWarp');
  assert(Array.isArray(topwear?.modifierChain) && topwear.modifierChain.length === 2,
    'topwear chain skips disabled middle, keeping leaf + outer');
  assert(topwear.modifierChain[0].id === 'BreathWarp', 'topwear chain leaf = BreathWarp');
  assert(topwear.modifierChain[1].id === 'BodyZWarp',
    'topwear chain skips disabled BodyXWarp — outer becomes BodyZWarp');
}

// ---- 9c. Bone-baked-path bypass: modifierChain suppressed when runtime.parent
//        points to a deformer not in part.modifiers[] ----
{
  // Simulates a bone-baked part (legwear): runtime.parent points to a
  // GroupRotation deformer that's NOT in part.modifiers[] (v21
  // synthesizeModifierStacks only inserts body-warp synthetics, not
  // bone rotations). The modifier stack is incomplete — chainEval
  // must fall back to the global parent-pointer walk to render the
  // bone-baked offset correctly.
  const project = {
    canvas: { width: 1280, height: 1280 },
    parameters: [],
    nodes: [
      // Body warp deformer.
      {
        id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp',
        name: 'BodyXWarp', parent: null,
        gridSize: { rows: 1, cols: 1 },
        baseGrid: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]),
        keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]) }],
        bindings: [],
      },
      // Bone rotation — exists in project.nodes but NOT referenced by
      // any part's modifier stack (gets emitted via orphan fallback).
      {
        id: 'GroupRotation_leftLeg', type: 'deformer', deformerKind: 'rotation',
        name: 'GroupRotation_leftLeg', parent: 'BodyXWarp',
        baseAngle: 0,
        keyforms: [{ keyTuple: [], angle: 0, originX: 100, originY: 100, scale: 1 }],
        bindings: [],
      },
      // Bone-baked legwear — runtime.parent = GroupRotation; modifiers
      // list contains only body warps (not the bone rotation).
      {
        id: 'legwear-l', type: 'part', name: 'legwear-l',
        mesh: {
          vertices: [{ x: 50, y: 50 }],
          triangles: [], uvs: [],
          jointBoneId: 'grp-leftLeg',
          runtime: {
            parent: { type: 'rotation', id: 'GroupRotation_leftLeg' },
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [50, 50], opacity: 1 }],
          },
        },
        modifiers: [
          // v21 synthesised body-warp entry; bone rotation is absent.
          { type: 'warp', deformerId: 'BodyXWarp',
            data: { name: 'BodyXWarp', gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 200, 0, 0, 200, 200, 200]) }],
              bindings: [] } },
        ],
      },
    ],
  };
  const rigSpec = selectRigSpec(project);
  const am = rigSpec.artMeshes.find((a) => a.id === 'legwear-l');
  assert(!!am, 'bone-baked artMesh built');
  // modifierChain MUST be null so chainEval falls back to the global
  // parent-pointer walk and includes the bone rotation in the chain.
  assert(am?.modifierChain === null,
    'bone-baked part: modifierChain suppressed (legacy walk preserves bone rotation)');
  // Parent stays at the cached runtime.parent (the bone rotation), NOT
  // overridden to the modifier stack's leaf.
  assert(am?.parent?.type === 'rotation' && am?.parent?.id === 'GroupRotation_leftLeg',
    'bone-baked part: artMesh.parent stays at runtime.parent (GroupRotation)');
}

// ---- 9b. modifierChain: empty array when all disabled, null when no stack ----
{
  const project = {
    canvas: { width: 400, height: 400 },
    parameters: [],
    nodes: [
      {
        id: 'W', type: 'deformer', deformerKind: 'warp',
        name: 'W', parent: null,
        gridSize: { rows: 1, cols: 1 },
        baseGrid: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]),
        keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]) }],
        bindings: [],
      },
      {
        id: 'allOff', type: 'part',
        mesh: {
          vertices: [{ x: 50, y: 50 }],
          triangles: [], uvs: [],
          runtime: {
            parent: { type: 'warp', id: 'W' },
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [0.5, 0.5], opacity: 1 }],
          },
        },
        modifiers: [
          { type: 'warp', deformerId: 'W', enabled: false,
            data: { name: 'W', gridSize: { rows: 1, cols: 1 },
              baseGrid: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]),
              keyforms: [{ keyTuple: [], positions: new Float64Array([0, 0, 100, 0, 0, 100, 100, 100]) }],
              bindings: [] } },
        ],
      },
      // Pre-rig part — no modifiers, no runtime.
      {
        id: 'preRig', type: 'part',
        mesh: { vertices: [{ x: 10, y: 10 }], triangles: [], uvs: [] },
      },
    ],
  };
  const rigSpec = selectRigSpec(project);
  const allOff = rigSpec.artMeshes.find((a) => a.id === 'allOff');
  const preRig = rigSpec.artMeshes.find((a) => a.id === 'preRig');
  assert(Array.isArray(allOff?.modifierChain) && allOff.modifierChain.length === 0,
    'all-disabled part: modifierChain = empty array (chain walk skipped)');
  assert(preRig?.modifierChain === null,
    'no-stack part: modifierChain = null (chainEval falls back to parent walk)');
}

// ---- 9. Mode bitmask: undefined mode field defaults to REALTIME|RENDER ----
{
  const project = {
    nodes: [
      {
        id: 'face', type: 'part',
        modifiers: [
          // No `mode` field → default REALTIME|RENDER (per v21 doc).
          { type: 'warp', deformerId: 'RigWarp_face',
            data: { name: 'RigWarp_face' } },
        ],
      },
    ],
  };
  const liveSynth = synthesizeDeformerNodesForExport(project, { includeOrphans: false });
  assert(liveSynth.length === 1, 'undefined mode passes REALTIME by default');
}

console.log(`modifierEnabled: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
