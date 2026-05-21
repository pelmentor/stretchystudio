// @ts-check

/**
 * v43 — Warps as first-class Lattice objects (Slice 1.B flip).
 *
 * Converts the abstract warp-deformer representation into Blender's
 * Lattice model (docs/plans/WARP_AS_LATTICE_OBJECT_REFACTOR_PLAN.md):
 *
 *   BEFORE (per warp):
 *     - `{type:'deformer', deformerKind:'warp', id, parent, gridSize,
 *        baseGrid, localFrame, bindings, keyforms, isQuadTransform,
 *        targetPartId?, canvasBbox?}` node in `project.nodes`.
 *     - each affected part carries a modifier
 *        `{type:'warp', deformerId, enabled, mode, data:{...warp fields}}`.
 *
 *   AFTER (per warp):
 *     - a real grid-mesh OBJECT
 *        `{type:'object', objectKind:'lattice', id, parent, dataId,
 *          gridSize, localFrame, bindings, keyforms, isQuadTransform,
 *          targetPartId?, canvasBbox?}` (id REUSED from the warp node so
 *          every existing reference — parent links, `targetPartId`,
 *          `part.rigParent`, modifier refs — stays valid).
 *     - a linked cage `{type:'meshData', id:`<id>__cage`, vertices,
 *        gridSize, isLatticeCage}` whose `vertices` ARE the rest control
 *        points (`baseGrid` re-shaped to `{x,y}[]`) — the editable cage
 *        (Blender Lattice data-block; the `meshData.vertices` is the
 *        Basis, keyforms are the relative shape-keys).
 *     - each affected part's warp modifier becomes
 *        `{type:'lattice', objectId, enabled, mode, showInEditor}` —
 *        a reference to the cage object (Blender `LatticeModifierData.object`,
 *        DNA_modifier_types.h:285), NOT a data copy. The lattice OBJECT is
 *        the single source of truth (Rule №1 — no dual store; the v28
 *        `modifier.data` copy is dropped for warps).
 *
 * Rotation deformers + rotation/armature modifiers are UNTOUCHED — only
 * warps flip. `baseGrid` (the rest cage) is read downstream ONLY by the
 * selectRigSpec/export path (the depgraph kernels read `keyforms`/`gridSize`,
 * not the rest cage), and that path funnels through
 * `synthesizeDeformerNodesForExport` + `_warpNodeToSpec` — both updated in
 * lockstep with this migration so `selectRigSpec().warpDeformers` is
 * byte-identical (Phase-0 oracle f50b6178).
 *
 * Idempotent: a warp already converted (no `deformer/warp` nodes left)
 * is a no-op; a part whose warp modifier is already `type:'lattice'` is
 * skipped.
 *
 * localFrame relocation (the plan's #1 silent-corruption hazard): kept as
 * explicit object metadata `lattice.localFrame`, NOT baked into a transform
 * — the eval reads it from the synthesised warp node (which reads it from
 * the object), so the bilinear projection space is preserved verbatim.
 *
 * @module store/migrations/v43_lattice_substrate
 */

/**
 * Re-shape a flat control-point array `[x0,y0,x1,y1,...]` into the
 * `{x,y}[]` vertex form `meshData` uses. Tolerates Float64Array or number[].
 *
 * @param {number[]|Float64Array|undefined|null} baseGrid
 * @returns {Array<{x:number, y:number}>}
 */
function baseGridToCageVertices(baseGrid) {
  if (!baseGrid || typeof baseGrid.length !== 'number') return [];
  const out = [];
  for (let i = 0; i + 1 < baseGrid.length; i += 2) {
    out.push({ x: baseGrid[i], y: baseGrid[i + 1] });
  }
  return out;
}

/**
 * Convert one `{type:'deformer', deformerKind:'warp'}` node into its
 * Blender-Lattice replacement: a `{type:'object', objectKind:'lattice'}`
 * object (id REUSED) + a linked `{type:'meshData', isLatticeCage:true}`
 * cage whose `vertices` ARE the rest control points.
 *
 * This is the CANONICAL warp→lattice shape. Both this migration AND the
 * runtime auto-rig seeders (Phase 5 — `deformerNodeSync.upsertWarpAsLattice`)
 * call it, so a freshly-seeded warp is byte-identical to a migrated one
 * (the Phase-0 oracle `f50b6178` depends on this — a divergence would change
 * `selectRigSpec().warpDeformers`).
 *
 * @param {object} n - a `deformer/warp` node (raw-node shape; `baseGrid`
 *   may be Float64Array or number[])
 * @returns {{ lattice: object, cage: object }}
 */
export function warpNodeToLatticeNodes(n) {
  const gridSize = {
    rows: n.gridSize?.rows ?? 5,
    cols: n.gridSize?.cols ?? 5,
  };
  const cageId = `${n.id}__cage`;
  const cage = {
    id: cageId,
    type: 'meshData',
    // The rest control points ARE the cage mesh vertices (the Basis).
    vertices: baseGridToCageVertices(n.baseGrid),
    // Phase 3 (Edit-Mode cage) builds grid edges/topology from gridSize;
    // a lattice has no faces (Blender Lattice), so triangles stay empty.
    uvs: [],
    triangles: [],
    edgeIndices: [],
    isLatticeCage: true,
    gridSize: { ...gridSize },
  };

  const lattice = {
    id: n.id,
    type: 'object',
    objectKind: 'lattice',
    name: n.name ?? n.id,
    parent: typeof n.parent === 'string' ? n.parent : null,
    dataId: cageId,
    visible: n.visible !== false,
    gridSize,
    localFrame: n.localFrame ?? 'canvas-px',
    bindings: Array.isArray(n.bindings) ? n.bindings : [],
    keyforms: Array.isArray(n.keyforms) ? n.keyforms : [],
    isLocked: n.isLocked === true,
    isQuadTransform: n.isQuadTransform === true,
  };
  if (typeof n.targetPartId === 'string' && n.targetPartId.length > 0) {
    lattice.targetPartId = n.targetPartId;
  }
  if (n.canvasBbox && typeof n.canvasBbox === 'object') {
    lattice.canvasBbox = n.canvasBbox;
  }
  if (n._userAuthored === true) lattice._userAuthored = true;
  if (typeof n.rigParent === 'string') lattice.rigParent = n.rigParent;

  return { lattice, cage };
}

/**
 * @param {object} project - mutated in place; at v42 on entry, v43 on exit
 */
export function migrateLatticeSubstrate(project) {
  if (!project || !Array.isArray(project.nodes)) return;

  const nodes = project.nodes;

  // 1. Find every warp deformer node + build its lattice-object +
  //    cage-meshData replacements. Collect ids so the modifier rewrite
  //    (step 3) only touches modifiers that reference an actual warp.
  /** @type {Set<string>} */
  const warpIds = new Set();
  /** @type {Array<{ index: number, lattice: object, cage: object }>} */
  const conversions = [];

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n || n.type !== 'deformer' || n.deformerKind !== 'warp') continue;
    if (typeof n.id !== 'string') continue;
    warpIds.add(n.id);

    const { lattice, cage } = warpNodeToLatticeNodes(n);
    conversions.push({ index: i, lattice, cage });
  }

  if (warpIds.size === 0) return; // nothing to flip (idempotent)

  // 2. Replace each warp node with its lattice object in place (preserve
  //    array position so order-sensitive consumers see the same topology),
  //    and append the cage data nodes.
  for (const { index, lattice } of conversions) {
    nodes[index] = lattice;
  }
  for (const { cage } of conversions) {
    nodes.push(cage);
  }

  // 3. Rewrite every part's warp modifier into a lattice modifier that
  //    REFERENCES the cage object (drop the v28 `data` copy — the object
  //    is now the single source of truth). Only modifiers whose
  //    `deformerId` resolves to a converted warp are touched; rotation /
  //    armature modifiers are left exactly as they were.
  for (const part of nodes) {
    if (!part || part.type !== 'part' || !Array.isArray(part.modifiers)) continue;
    for (let i = 0; i < part.modifiers.length; i++) {
      const mod = part.modifiers[i];
      if (!mod || typeof mod !== 'object') continue;
      if (mod.type !== 'warp') continue;
      if (typeof mod.deformerId !== 'string' || !warpIds.has(mod.deformerId)) continue;
      const next = {
        type: 'lattice',
        objectId: mod.deformerId,
        enabled: mod.enabled !== false,
        mode: typeof mod.mode === 'number' ? mod.mode : undefined,
        showInEditor: mod.showInEditor !== false,
      };
      if (next.mode === undefined) delete next.mode;
      // Preserve the v21 `synthetic` marker (a modifier auto-inserted on an
      // ancestor-affected part with no explicit stack entry). It drives the
      // "(synth)" Node-Tree label + the Modifier-Stack synthetic badge, so
      // dropping it on the warp→lattice flip would silently lose that UI.
      if (mod.synthetic === true) next.synthetic = true;
      part.modifiers[i] = next;
    }
  }
}
