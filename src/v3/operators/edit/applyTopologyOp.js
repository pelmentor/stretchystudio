// @ts-check

/**
 * Toolset Plan Phase 4.D — Topology-op project applier.
 *
 * Translates a `TopologyOpResult` (returned by the pure operator
 * functions in `merge.js` / `dissolve.js` / `subdivide.js`) into a
 * project mutation + per-vertex blendShape/weightGroup remap + GPU
 * upload + selection remap.
 *
 * The pure operators handle vertex / UV / triangle / edgeIndices
 * arithmetic. This module owns the side-effects:
 *
 *   - `updateProject` recipe: writes the new mesh fields, rebuilds
 *     blendShape deltas via `vertexSources` averaging, rebuilds
 *     weightGroups via averaging, rebuilds legacy `boneWeights`.
 *   - `editorStore.invalidateVertexSelectionForPart` is too coarse for
 *     Phase 4 — we want survivors to stay selected. Instead we apply
 *     `vertexIndexRemap` (oldIdx → newIdx | null) directly:
 *     deleted verts drop, surviving verts keep their selection.
 *     New midpoints from Subdivide are NOT in the remap (they have no
 *     `oldIdx`); they're added to the selection iff BOTH source
 *     endpoints were in the pre-op selection (Blender's "subdivide
 *     keeps the selected ring intact" semantic).
 *   - GPU re-upload via the scene registry (set by CanvasViewport).
 *     Tests run without a registered scene; the helper no-ops the
 *     upload step in that case.
 *
 * The operator is treated as a single undo entry: the dispatch wraps
 * the `updateProject` call (which captures one snapshot for undo).
 *
 * @module v3/operators/edit/applyTopologyOp
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { getMesh } from '../../../store/objectDataAccess.js';
import {
  remapPerVertexArray, averageDeltas, averageNumbers,
} from '../../../lib/meshTopology.js';
import { getSceneRef } from '../../../lib/sceneRegistry.js';
import { meshSignature } from '../../../io/meshSignature.js';

/** @typedef {import('../../../lib/meshTopology.js').TopologyOpResult} TopologyOpResult */

/**
 * Apply a `TopologyOpResult` to the project for `partId`. Persists to
 * the store, remaps per-vertex side-data, remaps the editor selection,
 * and re-uploads the mesh to the WebGL scene (when a scene is
 * registered).
 *
 * Phase 5 — when `result.selectionOverride` is set, the editor
 * selection is replaced wholesale with the override (instead of the
 * survivor + growth remap). Used by Extrude to select only the freshly-
 * duplicated verts (Blender's E pattern: source ring stays unselected
 * post-extrude so modal G drags the duplicates).
 *
 * @param {string} partId
 * @param {TopologyOpResult} result
 * @returns {boolean}  true on success, false when the project node is
 *                     missing or the part has no editable mesh
 */
export function applyTopologyOp(partId, result) {
  if (typeof partId !== 'string' || partId.length === 0) return false;
  if (!result) return false;

  const projectStore = useProjectStore.getState();
  const project = projectStore.project;
  const node = project?.nodes?.find((n) => n.id === partId);
  if (!node) return false;
  const mesh = getMesh(node, project);
  if (!mesh) return false;

  // Snapshot the pre-op selection so we can rebuild it post-mutation.
  const editor = useEditorStore.getState();
  const priorSelection = editor.selectedVertexIndices.get(partId);
  const priorActive = editor.activeVertex;

  // Pre-compute per-vertex remapped side-data using the OLD mesh.
  // Pass `result.vertexWeights` (when present) so Subdivide's barycentric
  // / lerp interpolation uses weighted averages — without weights, every
  // edge midpoint and interior vert would snap to the unweighted source
  // mean (centroid for 3-source interior, midpoint regardless of cut
  // parameter for 2-source edge mids).
  const vw = result.vertexWeights ?? null;
  /** @type {Array<{dx:number, dy:number}|null>[]|null} */
  const remappedShapeDeltas = node.blendShapes?.length
    ? node.blendShapes.map((shape) =>
        remapPerVertexArray(
          shape.deltas ?? [],
          result.vertexSources,
          result.vertices.length,
          averageDeltas,
          vw,
        ),
      )
    : null;

  /** @type {Record<string, number[]>|null} */
  let remappedWeightGroups = null;
  if (mesh.weightGroups && typeof mesh.weightGroups === 'object') {
    remappedWeightGroups = {};
    for (const [name, weights] of Object.entries(mesh.weightGroups)) {
      remappedWeightGroups[name] = remapPerVertexArray(
        /** @type {ArrayLike<number>} */ (weights),
        result.vertexSources,
        result.vertices.length,
        averageNumbers,
        vw,
      );
    }
  }

  /** @type {number[]|null} */
  const remappedBoneWeights = Array.isArray(mesh.boneWeights)
    ? remapPerVertexArray(
        mesh.boneWeights,
        result.vertexSources,
        result.vertices.length,
        averageNumbers,
        vw,
      )
    : null;

  // Single store mutation = single undo entry.
  projectStore.updateProject((proj) => {
    const n = proj.nodes.find((nn) => nn.id === partId);
    if (!n) return;
    const m = getMesh(n, proj);
    if (!m) return;
    m.vertices = result.vertices;
    m.uvs = Array.from(result.uvs);
    m.triangles = result.triangles;
    m.edgeIndices = result.edgeIndices;
    if (remappedShapeDeltas && Array.isArray(n.blendShapes)) {
      for (let i = 0; i < n.blendShapes.length; i++) {
        n.blendShapes[i].deltas = remappedShapeDeltas[i];
      }
    }
    if (remappedWeightGroups) m.weightGroups = remappedWeightGroups;
    if (remappedBoneWeights)  m.boneWeights  = remappedBoneWeights;
    // Audit fix G-1 — `mesh.runtime.keyforms[i].vertexPositions` is
    // positionally-indexed at the OLD vertex count. After topology
    // change it stays at `2 * N_old`; `artMeshEval` reads that length
    // as authoritative `len` and emits wrong-sized buffers (or filters
    // out the keyform entirely). The runtime is rebuilt by the next
    // Init Rig pass — clearing here matches the existing pattern at
    // `ArmatureModifierService.js:155` and `artMeshRuntimeSync.js:175`.
    if (m.runtime) delete m.runtime;
  });

  // GPU re-upload — match the existing add_vertex / remove_vertex paths
  // in CanvasViewport (uploadMesh + isDirtyRef.current = true). The
  // sceneRegistry handles the dirty flag bump as part of uploadMesh.
  // Record the post-op signature so CanvasViewport's sync-useEffect
  // doesn't double-upload after the React render cycle (audit fix G-3
  // — the sync compares signatures, so seeding the cache prevents the
  // redundant second upload).
  const scene = getSceneRef();
  if (scene && scene.parts) {
    const meshLike = {
      vertices:    result.vertices,
      uvs:         result.uvs,
      triangles:   result.triangles,
      edgeIndices: result.edgeIndices,
    };
    scene.parts.uploadMesh(partId, meshLike);
    if (typeof scene._recordMeshUpload === 'function') {
      scene._recordMeshUpload(partId, meshSignature(meshLike));
    }
    if (typeof scene._markDirty === 'function') scene._markDirty();
  }

  // Apply selection — `selectionOverride` (Phase 5) wins over the
  // survivor + growth remap; otherwise, run the standard remap.
  if (result.selectionOverride instanceof Set) {
    overrideSelectionForPart(partId, result.selectionOverride);
  } else {
    remapSelectionForPart(partId, result, priorSelection, priorActive);
  }

  return true;
}

/**
 * Selection remap: for the pre-op selected verts:
 *   - oldIdx → null      → drop from selection (deleted vert)
 *   - oldIdx → newIdx    → keep at the new index
 *   - oldIdx not in remap → drop (defensive — shouldn't happen)
 *
 * Plus subdivide's growth rule: any new vertex (not in the pre-op
 * mesh) is selected iff ALL its source vertices were in the pre-op
 * selection. This matches Blender's "subdivide keeps the active edge
 * loop intact" — when a user selects a ring of verts and subdivides,
 * the new midpoints inserted into that ring also become selected.
 *
 * Active vertex is preserved when its mapping survives, dropped
 * otherwise.
 *
 * @param {string} partId
 * @param {TopologyOpResult} result
 * @param {Set<number>|undefined} priorSelection
 * @param {{partId:string, vertIndex:number}|null} priorActive
 */
function remapSelectionForPart(partId, result, priorSelection, priorActive) {
  const editor = useEditorStore.getState();

  /** @type {Set<number>} */
  const newSelection = new Set();
  const sel = priorSelection ?? new Set();

  // Survivor pass via vertexIndexRemap.
  for (const oldIdx of sel) {
    const ne = result.vertexIndexRemap.get(oldIdx);
    if (ne != null) newSelection.add(ne);
  }

  // Growth pass: walk vertexSources for indices NOT in the original
  // mesh (i.e. newly created midpoints). Add when every source is in
  // the prior selection.
  if (sel.size > 0) {
    for (const [newIdx, sources] of result.vertexSources) {
      if (sources.length <= 1) continue; // straight copy (already handled)
      // Skip indices already covered by the survivor pass.
      if (newSelection.has(newIdx)) continue;
      const allWereSelected = sources.every((s) => sel.has(s));
      if (allWereSelected) newSelection.add(newIdx);
    }
  }

  if (newSelection.size === 0) {
    editor.deselectAllVertices(partId);
  } else {
    editor.setVertexSelectionForPart(partId, newSelection);
  }

  // Active vertex remap.
  if (priorActive && priorActive.partId === partId) {
    const ne = result.vertexIndexRemap.get(priorActive.vertIndex);
    if (ne != null && newSelection.has(ne)) {
      // Re-set selectVertex to update activeVertex slot — non-additive
      // would clear our newSelection rebuild, so we use selectVertex
      // additive to bump active without losing the set.
      editor.selectVertex(partId, ne, /* additive */ true);
    }
  }
}

/**
 * Phase 5 — selection override path. Replaces the editor selection
 * for `partId` with the given Set verbatim, then re-points
 * `activeVertex` at one of the new verts (Blender's E sets the active
 * vertex to the most-recently-duplicated, but SS uses Set iteration
 * order as the proxy — same compromise as `mergeAtFirst`).
 *
 * @param {string} partId
 * @param {Set<number>} override
 */
function overrideSelectionForPart(partId, override) {
  const editor = useEditorStore.getState();
  if (override.size === 0) {
    editor.deselectAllVertices(partId);
    return;
  }
  editor.setVertexSelectionForPart(partId, override);
  // Bump activeVertex to the first new vert so downstream consumers
  // (e.g. Mesh Edit Mode tools that read activeVertex) have a sensible
  // reference. selectVertex additive preserves the override set.
  const first = override.values().next().value;
  if (typeof first === 'number') {
    editor.selectVertex(partId, first, /* additive */ true);
  }
}
