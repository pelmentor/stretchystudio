// @ts-check

/**
 * Edit Mode — Delete Vertices operator.
 *
 * Mirrors Blender's `MESH_OT_delete` with `type='VERTS'` (the default
 * branch of the X-menu in Mesh Edit Mode): removes the selected
 * vertices AND every triangle incident to any of them, leaving holes.
 * No retriangulation — that's [[dissolve]]'s job.
 *
 * The companion `Ctrl+X` chord still routes to `edit.dissolveVerts`;
 * plain `X` / `Delete` route to this op in Edit Mode (the dispatcher's
 * `selection.delete` is polymorphic — Object Mode deletes the selected
 * part/group, Edit Mode deletes vertices).
 *
 * @module v3/operators/edit/deleteVerts
 */

import { removeDegenerateTriangles } from '../../../lib/meshTopology.js';

/** @typedef {import('../../../lib/meshTopology.js').TopologyOpResult} TopologyOpResult */
/** @typedef {import('../../../lib/meshTopology.js').VertexLike} VertexLike */
/** @typedef {import('../../../lib/meshTopology.js').TriIndex} TriIndex */

/**
 * Drop selected vertices and every triangle incident to any of them.
 *
 * Returns null when the operation would empty the mesh, leave fewer than
 * 3 verts, or leave no triangles after dropping incident ones (the rig
 * pipeline insists on a non-degenerate mesh; callers should treat null
 * as "no-op — too aggressive a delete").
 *
 * Per-vertex data preservation:
 *   - UVs survive via index-compaction (`uvs[newIdx] = uvs[oldIdx]`)
 *   - blendShape deltas, weights, etc., are out-of-scope for this v1
 *     (mirrors `dissolveVertices`: `vertexSources` maps `newIdx →
 *     [oldIdx]` so downstream remappers can copy whatever they need).
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @returns {TopologyOpResult|null}
 */
export function deleteVertices(mesh, selection) {
  const sel = new Set(
    Array.from(selection).filter(
      (i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length,
    ),
  );
  if (sel.size === 0) return null;
  // Refuse to drop below the rig pipeline's 3-vert floor.
  if (mesh.vertices.length - sel.size < 3) return null;

  // Drop triangles that touch any deleted vert.
  /** @type {Array<TriIndex>} */
  const survivingTris = [];
  for (const tri of mesh.triangles) {
    const [a, b, c] = tri;
    if (sel.has(a) || sel.has(b) || sel.has(c)) continue;
    survivingTris.push(tri);
  }
  // Bail if every triangle was incident — surviving verts would have no
  // topology and the rig pipeline would reject the mesh.
  if (survivingTris.length === 0) return null;

  // Compact: build oldToNew that drops deleted verts.
  /** @type {Map<number, number|null>} */
  const oldToNew = new Map();
  /** @type {Map<number, number[]>} */
  const vertexSources = new Map();
  /** @type {Array<VertexLike>} */
  const vertices = [];
  /** @type {number[]} */
  const survivingOldIndices = [];
  for (let i = 0; i < mesh.vertices.length; i++) {
    if (sel.has(i)) {
      oldToNew.set(i, null);
      continue;
    }
    const newIdx = vertices.length;
    oldToNew.set(i, newIdx);
    vertices.push({ ...mesh.vertices[i] });
    vertexSources.set(newIdx, [i]);
    survivingOldIndices.push(i);
  }
  if (vertices.length < 3) return null;

  // Remap triangle indices.
  /** @type {Array<TriIndex>} */
  const remappedTris = [];
  for (const [a, b, c] of survivingTris) {
    const na = oldToNew.get(a);
    const nb = oldToNew.get(b);
    const nc = oldToNew.get(c);
    if (na == null || nb == null || nc == null) continue;
    if (na === nb || nb === nc || nc === na) continue;
    remappedTris.push([na, nb, nc]);
  }
  const triangles = removeDegenerateTriangles(remappedTris);
  if (triangles.length === 0) return null;

  // Remap UVs via dropping deleted entries.
  const uvs = new Float32Array(vertices.length * 2);
  for (let i = 0; i < survivingOldIndices.length; i++) {
    const old = survivingOldIndices[i];
    uvs[i * 2]     = mesh.uvs[old * 2]     ?? 0;
    uvs[i * 2 + 1] = mesh.uvs[old * 2 + 1] ?? 0;
  }

  // Remap edgeIndices (drop deleted, re-index survivors).
  /** @type {Set<number>} */
  const edgeIndices = new Set();
  if (mesh.edgeIndices) {
    for (const ei of mesh.edgeIndices) {
      const ne = oldToNew.get(ei);
      if (ne != null) edgeIndices.add(ne);
    }
  }

  return {
    vertices,
    uvs,
    triangles,
    edgeIndices,
    vertexIndexRemap: oldToNew,
    vertexSources,
    retriangulated: false,
  };
}
