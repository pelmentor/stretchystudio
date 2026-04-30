// @ts-check
/**
 * Synthesise SS-shape `project.rigWarps[partId]` from extracted cmo3
 * deformer + binding + grid graph.
 *
 * Coverage (sweep #13 honest scope):
 *
 *   - Warp deformers whose own CDeformerGuid xs.ref is referenced by
 *     exactly one `ExtractedPart.deformerGuidRef` get a full rigWarpSpec
 *     keyed by that part's SS node id.
 *   - Warps with no mesh child (intermediate / chained warps under
 *     FaceParallax / NeckWarp / BodyXWarp) are SKIPPED — they need a
 *     deformer-tree synthesis pass that doesn't exist yet.
 *   - Rotation deformers are SKIPPED — they map to SS's groupRotation
 *     system (handled by `rotationDeformerSynth.js`).
 *
 * `gridSize` is the cell count (`cols × rows`); `baseGrid` is
 * `(cols+1) × (rows+1)` control-point pairs — same convention the
 * writer uses. Positions are returned in canvas-pixel space (cmo3
 * stores `0..1`-normalised; the writer's stored-rigWarps fast path
 * expects pixel space).
 *
 * @module io/live2d/cmo3Import/rigWarpSynth
 */

/**
 * @param {import('../cmo3PartExtract.js').ExtractedScene} scene
 * @param {Map<string, string>} partGuidToNodeId   ExtractedPart.xsId → SS node id
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {{ rigWarps: Record<string, any>, warnings: string[] }}
 */
export function buildRigWarpsFromScene(scene, partGuidToNodeId, canvasW, canvasH) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Record<string, any>} */
  const rigWarps = {};

  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedDeformer>} */
  const warpByOwnGuid = new Map();
  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedDeformer>} */
  const rotationByOwnGuid = new Map();
  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedDeformer>} */
  const deformerByOwnGuid = new Map();
  for (const d of scene.deformers) {
    if (!d.ownGuidRef) continue;
    deformerByOwnGuid.set(d.ownGuidRef, d);
    if (d.kind === 'warp') warpByOwnGuid.set(d.ownGuidRef, d);
    else if (d.kind === 'rotation') rotationByOwnGuid.set(d.ownGuidRef, d);
  }

  /**
   * Walk a warp's parent-deformer chain in cmo3 space and resolve to
   * the SS-side parent the runtime evaluator expects. Maps cmo3
   * "FaceParallax" → SS "FaceParallaxWarp" etc.; falls through any
   * intermediate warps until it hits one of the three named structural
   * warps. Without this, every imported leaf rigWarp defaulted to
   * BodyXWarp — wrong for the face/eye/brow/hair region.
   *
   * @param {import('../cmo3PartExtract.js').ExtractedDeformer} startWarp
   * @returns {{type:'warp', id:string}}
   */
  function resolveRigWarpParent(startWarp) {
    const NAMED_MAP = {
      FaceParallax: 'FaceParallaxWarp',
      NeckWarp:     'NeckWarp',
      BodyXWarp:    'BodyXWarp',
    };
    let cur = startWarp;
    let safety = 16;
    while (cur && cur.parentDeformerGuidRef && safety-- > 0) {
      const parent = deformerByOwnGuid.get(cur.parentDeformerGuidRef);
      if (!parent) break;
      if (parent.kind === 'warp' && NAMED_MAP[parent.idStr]) {
        return { type: 'warp', id: NAMED_MAP[parent.idStr] };
      }
      cur = parent;
    }
    return { type: 'warp', id: 'BodyXWarp' };
  }

  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedKeyformBinding>} */
  const bindingsById = new Map();
  for (const b of scene.keyformBindings) {
    if (b.xsId) bindingsById.set(b.xsId, b);
  }

  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedKeyformGrid>} */
  const gridsById = new Map();
  for (const g of scene.keyformGrids) {
    if (g.xsId) gridsById.set(g.xsId, g);
  }

  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedKeyformBinding[]>} */
  const bindingsByGrid = new Map();
  for (const b of scene.keyformBindings) {
    if (!b.gridSourceRef) continue;
    let arr = bindingsByGrid.get(b.gridSourceRef);
    if (!arr) { arr = []; bindingsByGrid.set(b.gridSourceRef, arr); }
    arr.push(b);
  }

  for (const part of scene.parts) {
    if (!part.deformerGuidRef) continue;
    const warp = warpByOwnGuid.get(part.deformerGuidRef);
    if (!warp) {
      const rot = rotationByOwnGuid.get(part.deformerGuidRef);
      if (rot) {
        // Parts whose deformer parent is a rotation (not a warp) don't
        // get a stored rigWarp — the writer's per-mesh inline path
        // generates one on re-export.
      } else {
        warnings.push(
          `part ${part.drawableIdStr} (${part.name}) deformer ref ${part.deformerGuidRef} resolves to neither a warp nor a rotation deformer`,
        );
      }
      continue;
    }

    const partNodeId = partGuidToNodeId.get(part.xsId ?? '');
    if (!partNodeId) {
      warnings.push(`rigWarp build: part ${part.drawableIdStr} has no node id assignment`);
      continue;
    }

    const grid = warp.keyformGridSourceRef ? gridsById.get(warp.keyformGridSourceRef) : null;
    const gridBindings = warp.keyformGridSourceRef
      ? (bindingsByGrid.get(warp.keyformGridSourceRef) ?? [])
      : [];

    /** @type {{parameterId:string, keys:number[], interpolation:string}[]} */
    const bindings = gridBindings.map((b) => ({
      parameterId: b.description || 'ParamOpacity',
      keys: b.keys.slice(),
      interpolation: b.interpolationType || 'LINEAR',
    }));
    if (bindings.length === 0) {
      bindings.push({ parameterId: 'ParamOpacity', keys: [1], interpolation: 'LINEAR' });
    }

    if (!grid || grid.entries.length === 0 || !warp.keyforms.length) {
      warnings.push(`rigWarp build: warp ${warp.idStr} has no keyforms / grid`);
      continue;
    }
    let restCellIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < grid.entries.length; i++) {
      const cell = grid.entries[i];
      let dist = 0;
      for (const b of gridBindings) {
        const ak = cell.accessKey.find((k) => k.bindingRef === b.xsId);
        const val = ak ? (b.keys[ak.keyIndex] ?? 0) : 0;
        dist += val * val;
      }
      if (dist < bestDist) {
        bestDist = dist;
        restCellIdx = i;
      }
    }
    const restPositions = warp.keyforms[restCellIdx]?.positions;
    if (!restPositions || restPositions.length === 0) {
      warnings.push(`rigWarp build: warp ${warp.idStr} rest cell ${restCellIdx} has no positions`);
      continue;
    }
    const baseGrid = new Array(restPositions.length);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < restPositions.length; i += 2) {
      const px = restPositions[i] * canvasW;
      const py = restPositions[i + 1] * canvasH;
      baseGrid[i] = px;
      baseGrid[i + 1] = py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    /** @type {{keyTuple:number[], positions:number[], opacity:number}[]} */
    const keyforms = [];

    if (grid && grid.entries.length === warp.keyforms.length) {
      for (let i = 0; i < grid.entries.length; i++) {
        const cell = grid.entries[i];
        const kfPositions = warp.keyforms[i].positions;
        if (!kfPositions) {
          warnings.push(`rigWarp build: warp ${warp.idStr} keyform ${i} missing positions`);
          continue;
        }
        const positions = new Array(kfPositions.length);
        for (let j = 0; j < kfPositions.length; j += 2) {
          positions[j] = kfPositions[j] * canvasW;
          positions[j + 1] = kfPositions[j + 1] * canvasH;
        }
        const keyTuple = [];
        for (const b of gridBindings) {
          const ak = cell.accessKey.find((k) => k.bindingRef === b.xsId);
          if (!ak || !Number.isFinite(b.keys[ak.keyIndex])) {
            keyTuple.push(0);
          } else {
            keyTuple.push(b.keys[ak.keyIndex]);
          }
        }
        keyforms.push({ keyTuple, positions, opacity: 1 });
      }
    } else {
      keyforms.push({
        keyTuple: bindings[0]?.keys.slice() ?? [1],
        positions: baseGrid.slice(),
        opacity: 1,
      });
    }

    rigWarps[partNodeId] = {
      id: warp.idStr || `RigWarp_${part.name}`,
      name: warp.name || `${part.name} Warp`,
      // Resolved against the cmo3's actual deformer chain so evalRig
      // walks the right ancestors at runtime.
      parent: resolveRigWarpParent(warp),
      targetPartId: partNodeId,
      canvasBbox: {
        minX,
        minY,
        W: maxX - minX,
        H: maxY - minY,
      },
      gridSize: { rows: warp.rows, cols: warp.cols },
      baseGrid,
      localFrame: 'normalized-0to1',
      bindings,
      keyforms,
      isVisible: true,
      isLocked: false,
      isQuadTransform: warp.isQuadTransform,
    };
  }

  return { rigWarps, warnings };
}
