// Autonomous real-rig test harness (no browser, no PSD).
//
// Runs the ACTUAL Init-Rig pipeline (`generateCmo3`) in Node on a synthetic
// project so refactors can be validated against the REAL rig structure the
// app produces — real rotation deformers, real artMesh vertex FRAMES,
// real parent chains — instead of hand-authored fixtures whose coord frame
// might not match the pipeline (the trap behind "legwear floats").
//
// Usage:
//   import { harvestRealRig, evalRigSpec } from './realRigHarness.mjs';
//   const rigSpec = await harvestRealRig(project);   // real frames
//   const frames  = evalRigSpec(rigSpec, { ParamRotation_grp: 30 });
//
// This is the substitute for in-browser verification: the pipeline output IS
// the ground truth. Build refactor characterizations against `rigSpec` /
// `frames` here and they're grounded in real-pipeline coordinates.

import { generateCmo3 } from '../../src/io/live2d/cmo3writer.js';
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';

// Minimal valid 1x1 transparent PNG — cmo3writer requires `pngData` per mesh
// even under rigOnly (the layer-keyform pass runs before the rig short-circuit).
export const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/**
 * Convert a `{canvas, nodes:[...]}` project to the generateCmo3 input shape.
 * @param {object} project
 * @returns {object}
 */
export function toGeneratorInput(project) {
  const meshes = project.nodes.filter((n) => n.type === 'part').map((n) => ({
    partId: n.id,
    name: n.name,
    tag: n.tag,
    parentGroupId: n.parent,
    vertices: n.mesh.vertices,
    uvs: n.mesh.uvs,
    triangles: n.mesh.triangles,
    jointBoneId: n.mesh.jointBoneId,
    boneWeights: n.mesh.boneWeights,
    visible: n.visible !== false,
    variantSuffix: n.variantSuffix ?? null,
    variantRole: n.variantRole ?? null,
    pngData: PNG_1x1,
  }));
  const groups = project.nodes.filter((n) => n.type === 'group').map((g) => ({
    id: g.id,
    name: g.name ?? g.id,
    parent: g.parent ?? null,
    boneRole: g.boneRole ?? null,
    transform: g.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  }));
  return {
    canvasW: project.canvas.width,
    canvasH: project.canvas.height,
    meshes,
    groups,
    parameters: project.parameters ?? [],
    animations: [],
    modelName: 'harness',
    generateRig: true,
    generatePhysics: false,
    rigOnly: true,
  };
}

/**
 * Run the real Init-Rig harvest in Node. Returns the rigSpec with REAL
 * vertex frames + rotation/warp deformers + artMesh parent chains.
 * @param {object} project
 * @returns {Promise<object>} rigSpec
 */
export async function harvestRealRig(project) {
  const result = await generateCmo3(toGeneratorInput(project));
  return result.rigSpec;
}

/**
 * Evaluate a real rigSpec via chainEval (the export/runtime engine).
 * @param {object} rigSpec
 * @param {Object<string, number>} [params]
 * @returns {Array<{id:string, vertexPositions:Float32Array}>}
 */
export function evalRigSpec(rigSpec, params = {}) {
  return evalRig(rigSpec, params);
}

/** artMesh entry for a part id, or null. */
export function artMeshOf(rigSpec, partId) {
  return (rigSpec.artMeshes ?? []).find((m) => m.id === partId) ?? null;
}

/** rotation deformer entry by id, or null. */
export function rotationOf(rigSpec, id) {
  return (rigSpec.rotationDeformers ?? []).find((r) => r.id === id) ?? null;
}
