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
import { rotationSpecToDeformerNode, upsertDeformerNode, synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';
import { persistArtMeshRuntime } from '../../src/store/artMeshRuntimeSync.js';
import { seedBodyWarpChain } from '../../src/io/live2d/rig/bodyWarpStore.js';

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

/**
 * The harness's `rigSpec → project.nodes` seed step — the missing inverse of
 * `harvestRealRig`. Mirrors the deformer-model peer sequence inside
 * `projectStore.seedAllRig` (rotation-deformer-node upsert →
 * `persistArtMeshRuntime` → `synthesizeModifierStacks`) so a refactor that
 * mutates `project.nodes` (e.g. the GroupRotation→bone migration) can be
 * validated on the REAL pipeline's rig structure — real pivot-relative
 * keyform frames, real nested/warp parent chains — instead of a hand-authored
 * fixture whose frame might not match.
 *
 * Takes the SOURCE project (its `group` + `part` skeleton, with canvas-px
 * `mesh.vertices`) and the harvested `rigSpec`, and returns a deformer-model
 * project: rotation deformer nodes present, each part's `mesh.runtime`
 * populated (pivot-relative keyforms + parent ref), modifier stacks
 * synthesised, `ParamRotation_<g>` params registered. Eval it via the depgraph
 * to get the deformer-model baseline; migrate it to get the bone model.
 *
 * @param {object} sourceProject - the `{canvas, nodes:[group|part...]}` input
 * @param {object} rigSpec - output of `harvestRealRig(sourceProject)`
 * @returns {object} a fresh deformer-model project (source is not mutated)
 */
export function seedRigSpecToNodes(sourceProject, rigSpec) {
  const proj = JSON.parse(JSON.stringify(sourceProject));
  // Register the auto-seeded rig params (ParamRotation_<g>, body angles, …) so
  // the depgraph can drive the rotation bindings.
  if (Array.isArray(rigSpec?.parameters)) {
    const have = new Set((proj.parameters ?? []).map((p) => p?.id));
    proj.parameters = [
      ...(proj.parameters ?? []),
      ...rigSpec.parameters.filter((p) => p?.id && !have.has(p.id)).map((p) => ({ ...p })),
    ];
  }
  // Body warp chain as Lattice objects (the rotations are warp-parented by
  // default; without these the rotation pivots can't map warp-local→canvas and
  // the eval collapses to pivot-relative). Seed BEFORE the rotations so the
  // warp ancestors exist when stacks synthesise.
  if (rigSpec?.bodyWarpChain?.specs?.length) {
    seedBodyWarpChain(proj, rigSpec.bodyWarpChain, 'replace');
  }
  // Rotation deformer nodes (seedAllRig's BFA-006 Phase 3 dual-write).
  for (const spec of rigSpec?.rotationDeformers ?? []) {
    if (spec?.id) upsertDeformerNode(proj.nodes, rotationSpecToDeformerNode(spec));
  }
  // Persist artMesh runtime (bindings + pivot-relative keyforms + parent ref).
  persistArtMeshRuntime(proj, rigSpec, 'replace');
  // Pin each part's canvas-px rest verts from the real artMesh `verticesCanvas`
  // (the bone-head derivation `vertices − keyform` relies on this frame).
  for (const am of rigSpec?.artMeshes ?? []) {
    const part = proj.nodes.find((n) => n.id === am.id && n.type === 'part');
    if (part?.mesh && am.verticesCanvas) part.mesh.vertices = Array.from(am.verticesCanvas);
  }
  synthesizeModifierStacks(proj);
  return proj;
}
