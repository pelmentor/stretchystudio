// Slice F — migrate GroupRotation deformer → armature bone, validated against
// the depgraph eval (the harness-grounded shape: canvas-px mesh.vertices +
// pivot-relative runtime keyforms; bone head = vertices − keyform).
//
// Proof obligation: the MIGRATED bone model must reproduce the DEFORMER
// model's depgraph eval at rest AND rotated. (Slice E proved the LBS == the
// rotation deformer; this proves the migration produces the correct bone
// inputs from a realistic deformer-model project.)
//
// Run: node scripts/test/test_groupRotationMigration.mjs

import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';
import { migrateGroupRotationDeformersToBones } from '../../src/store/migrations/groupRotationToBone.js';
import { isGroupRotationBoneNode } from '../../src/store/warpLatticeAccess.js';

let passed = 0;
let failed = 0;
function assert(cond, name, info) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  if (info) console.error(`       ${info}`);
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function maxDelta(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

// Realistic deformer-model fixture (root-parented for a clean baseline):
// canvas-px mesh.vertices, pivot-relative runtime keyforms, rotation at the
// canvas-final pivot (550,460).
function makeDeformerProject() {
  return {
    canvas: { width: 1024, height: 1024, x: 0, y: 0 },
    parameters: [{ id: 'ParamRotation_grp', name: 'ParamRotation_grp', defaultValue: 0, minValue: -30, maxValue: 30 }],
    nodes: [
      { id: 'grp', type: 'group', name: 'grp', parent: null },
      { id: 'GroupRotation_grp', type: 'deformer', deformerKind: 'rotation', parent: null,
        name: 'GroupRotation_grp', visible: true,
        bindings: [{ parameterId: 'ParamRotation_grp', keys: [-30, 0, 30], interpolation: 'LINEAR' }],
        keyforms: [
          { keyTuple: [-30], angle: -30, originX: 550, originY: 460, scale: 1, opacity: 1, reflectX: false, reflectY: false },
          { keyTuple: [0],   angle:   0, originX: 550, originY: 460, scale: 1, opacity: 1, reflectX: false, reflectY: false },
          { keyTuple: [30],  angle:  30, originX: 550, originY: 460, scale: 1, opacity: 1, reflectX: false, reflectY: false },
        ],
        baseAngle: 0, handleLengthOnCanvas: 200, circleRadiusOnCanvas: 100, isLocked: false, useBoneUiTestImpl: false },
      { id: 'charm', type: 'part', name: 'charm', visible: true, draw_order: 100,
        parent: 'grp', rigParent: 'GroupRotation_grp',
        mesh: {
          vertices: [500, 400, 600, 400, 600, 520, 500, 520], // canvas-px
          uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3],
          runtime: {
            parent: { type: 'rotation', id: 'GroupRotation_grp' },
            bindings: [],
            keyforms: [{ keyTuple: [], opacity: 1, vertexPositions: [-50, -60, 50, -60, 50, 60, -50, 60] }], // pivot-relative
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
}

function evalCharm(project, params) {
  const frames = evalProjectFrameViaDepgraph(project, params);
  const f = frames.find((fr) => fr.id === 'charm');
  return f ? Array.from(f.vertexPositions) : null;
}

// ── 1. Deformer-model baseline (depgraph) ──
const deformer = makeDeformerProject();
synthesizeModifierStacks(deformer);
const baseRest = evalCharm(deformer, { ParamRotation_grp: 0 });
const base30 = evalCharm(deformer, { ParamRotation_grp: 30 });
assert(maxDelta(baseRest, [500, 400, 600, 400, 600, 520, 500, 520]) < 1e-3,
  'deformer rest == canvas-px verts');
assert(maxDelta(base30, baseRest) > 1, 'deformer @30 actually rotated (non-vacuous)');

// ── 2. Migrate deformer → bone ──
const bone = makeDeformerProject();
migrateGroupRotationDeformersToBones(bone);
const grp = bone.nodes.find((n) => n.id === 'grp');
const rotGone = !bone.nodes.some((n) => n.id === 'GroupRotation_grp');
const charm = bone.nodes.find((n) => n.id === 'charm');
assert(isGroupRotationBoneNode(grp), 'migration: group became a groupRotation bone');
assert(Math.abs(grp.transform.pivotX - 550) < 1e-6 && Math.abs(grp.transform.pivotY - 460) < 1e-6,
  'migration: bone head = canvas-final rest pivot (550,460)');
assert(rotGone, 'migration: rotation deformer node removed');
assert(JSON.stringify(charm.mesh.boneWeights) === JSON.stringify([1, 1, 1, 1]), 'migration: part bound weight 1');
assert(charm.mesh.jointBoneId === 'grp', 'migration: part jointBoneId = bone');
assert(maxDelta(charm.mesh.runtime.keyforms[0].vertexPositions, [500, 400, 600, 400, 600, 520, 500, 520]) < 1e-6,
  'migration: runtime keyform collapsed to canvas-px rest');
assert(charm.mesh.runtime.bindings.length === 0, 'migration: ParamRotation binding dropped');
assert(!(charm.modifiers ?? []).some((m) => m.type === 'rotation'), 'migration: rotation modifier-stack entry removed');

// ── 3. Bone model reproduces the deformer baseline (rest + rotated) ──
synthesizeModifierStacks(bone);
grp.pose.rotation = 0;
const boneRest = evalCharm(bone, {});
assert(maxDelta(boneRest, baseRest) < 0.05,
  `bone model rest == deformer rest (maxDelta=${maxDelta(boneRest, baseRest).toFixed(4)})`);

grp.pose.rotation = 30;
const bone30 = evalCharm(bone, {});
assert(maxDelta(bone30, base30) < 0.05,
  `bone model @30 == deformer @30 — MIGRATION PRESERVES EVAL (maxDelta=${maxDelta(bone30, base30).toFixed(4)})`,
  `bone=${bone30?.map((v) => v.toFixed(2))} deformer=${base30?.map((v) => v.toFixed(2))}`);

// ── 4. Regression 2026-05-25: object-shape mesh.vertices ──────────────
// Real PSD-imported parts carry `mesh.vertices` as object array
// `[{x, y, restX?, restY?}, ...]` (per exporter.js line 493) — not
// flat number arrays. Pre-fix the migration read `verts[0]` uniformly
// as a number, producing `object - number = NaN` for the object shape,
// cascading NaN into bone `transform.pivotX/Y` and the SkeletonOverlay
// SVG flood (Shelby invisible-character regression).
{
  const project = {
    canvas: { width: 1024, height: 1024, x: 0, y: 0 },
    parameters: [{ id: 'ParamRotation_grp', name: 'ParamRotation_grp', defaultValue: 0, minValue: -30, maxValue: 30 }],
    nodes: [
      { id: 'grp', name: 'grp', type: 'group', parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 } },
      { id: 'charm', name: 'charm', type: 'part', parent: 'grp',
        mesh: {
          // Object-shape vertices — the canonical PSD-import shape.
          vertices: [
            { x: 500, y: 400, restX: 500, restY: 400 },
            { x: 600, y: 400, restX: 600, restY: 400 },
            { x: 600, y: 520, restX: 600, restY: 520 },
            { x: 500, y: 520, restX: 500, restY: 520 },
          ],
          triangles: [[0, 1, 2], [0, 2, 3]],
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
          runtime: {
            keyforms: [{ keyTuple: [0], opacity: 1,
              // Pivot-relative canvas-px (vertex − canvas pivot 550,460).
              vertexPositions: [-50, -60, 50, -60, 50, 60, -50, 60] }],
            bindings: [{ parameterId: 'ParamRotation_grp', keys: [0], interpolation: 'LINEAR' }],
          },
        } },
      { id: 'GroupRotation_grp', type: 'deformer', deformerKind: 'rotation', parent: null,
        keyforms: [{ keyTuple: [0], originX: 550, originY: 460, angle: 0, scale: 1 }] },
    ],
  };
  migrateGroupRotationDeformersToBones(project);
  const grp = project.nodes.find((n) => n.id === 'grp');
  assert(Number.isFinite(grp.transform.pivotX) && Number.isFinite(grp.transform.pivotY),
    'object-shape verts → finite bone pivot (NOT NaN)',
    `pivotX=${grp.transform.pivotX} pivotY=${grp.transform.pivotY}`);
  assert(Math.abs(grp.transform.pivotX - 550) < 1e-6 && Math.abs(grp.transform.pivotY - 460) < 1e-6,
    'object-shape verts: bone head = canvas-final rest pivot (550,460)',
    `pivotX=${grp.transform.pivotX} pivotY=${grp.transform.pivotY}`);
}

// restX/restY override x/y when present (post-pose-bake)
{
  const project = {
    canvas: { width: 1024, height: 1024, x: 0, y: 0 },
    parameters: [{ id: 'ParamRotation_grp', name: 'ParamRotation_grp', defaultValue: 0, minValue: -30, maxValue: 30 }],
    nodes: [
      { id: 'grp', name: 'grp', type: 'group', parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 } },
      { id: 'charm', name: 'charm', type: 'part', parent: 'grp',
        mesh: {
          vertices: [
            // x/y are POSED (post-rotation); restX/restY are the un-baked rest
            { x: 999, y: 999, restX: 500, restY: 400 },
          ],
          triangles: [], uvs: [],
          runtime: {
            keyforms: [{ keyTuple: [0], opacity: 1, vertexPositions: [-50, -60] }],
            bindings: [],
          },
        } },
      { id: 'GroupRotation_grp', type: 'deformer', deformerKind: 'rotation', parent: null,
        keyforms: [{ keyTuple: [0], originX: 550, originY: 460, angle: 0, scale: 1 }] },
    ],
  };
  migrateGroupRotationDeformersToBones(project);
  const grp = project.nodes.find((n) => n.id === 'grp');
  assert(Math.abs(grp.transform.pivotX - 550) < 1e-6,
    'object-shape: restX preferred over x (550 not 1049)',
    `pivotX=${grp.transform.pivotX}`);
}

console.log(`groupRotationMigration: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
