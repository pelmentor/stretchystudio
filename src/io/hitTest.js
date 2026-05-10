// @ts-check

/**
 * Click-to-select on canvas (Blender pattern).
 *
 * Pure triangle hit-test against rig-evaluated vertex positions. Given
 * the project, the latest evalRig output, and a world-space click
 * coordinate, returns the topmost partId whose triangulation contains
 * the point — matching what the user actually sees rendered.
 *
 * Plan: docs/archive/plans-shipped/CLICK_TO_SELECT.md.
 *
 * Why triangulation, not pixel sampling: the alpha-sample path the
 * canvas used previously only worked against the rest texture (no rig
 * deformation), so clicks landed on stale positions. We have rig-
 * evaluated vertex positions per frame already in the canvas pipeline;
 * point-in-triangle against those matches the scene exactly without
 * GPU readback.
 *
 * For first-cut, full triangulation = opaque (alpha-zero holes inside
 * a mesh still register as hits). Mask-respecting and per-triangle
 * UV-alpha variants are deferred — see CLICK_TO_SELECT_PLAN.md "Edge
 * cases".
 *
 * @module io/hitTest
 */

import { mat3Inverse, mat3Identity } from '../renderer/transforms.js';
import { getMesh, isMeshedPart } from '../store/objectDataAccess.js';
import { sampleAlphaMask } from '../components/canvas/viewport/alphaMask.js';

/**
 * Sign of triangle (ax,ay)→(bx,by)→(cx,cy)→(ax,ay) used for
 * point-in-triangle. Inlined for hot loops.
 *
 * @returns {number}
 */
function _sign(px, py, ax, ay, bx, by) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

/**
 * Standard barycentric-sign point-in-triangle test. Inclusive on
 * edges so a click landing exactly on a shared edge picks the
 * topmost-drawn part (consistent with Blender's behaviour).
 *
 * @returns {boolean}
 */
export function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = _sign(px, py, ax, ay, bx, by);
  const d2 = _sign(px, py, bx, by, cx, cy);
  const d3 = _sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Run the point-in-triangle test against an interleaved [x,y,...]
 * vertex buffer for a triangulation in `Array<[i,j,k]>` form.
 *
 * @param {ArrayLike<number>} verts  - interleaved [x,y,...]
 * @param {ReadonlyArray<ReadonlyArray<number>>} tris  - Array<[i,j,k]>
 * @param {number} px
 * @param {number} py
 * @returns {boolean}
 */
function pointInAnyTriangle(verts, tris, px, py) {
  for (let t = 0; t < tris.length; t++) {
    const tri = tris[t];
    const i = tri[0], j = tri[1], k = tri[2];
    const ax = verts[i * 2],     ay = verts[i * 2 + 1];
    const bx = verts[j * 2],     by = verts[j * 2 + 1];
    const cx = verts[k * 2],     cy = verts[k * 2 + 1];
    if (pointInTriangle(px, py, ax, ay, bx, by, cx, cy)) return true;
  }
  return false;
}

/**
 * Same as `pointInAnyTriangle` but the vertex buffer is the
 * project mesh's `Array<{x,y}>` shape (rest mesh).
 *
 * @param {ReadonlyArray<{x?: number, y?: number, restX?: number, restY?: number}>} verts
 * @param {ReadonlyArray<ReadonlyArray<number>>} tris
 * @param {number} px
 * @param {number} py
 * @returns {boolean}
 */
function pointInAnyTriangleObjs(verts, tris, px, py) {
  for (let t = 0; t < tris.length; t++) {
    const tri = tris[t];
    const a = verts[tri[0]];
    const b = verts[tri[1]];
    const c = verts[tri[2]];
    if (!a || !b || !c) continue;
    const ax = a.x ?? a.restX ?? 0;
    const ay = a.y ?? a.restY ?? 0;
    const bx = b.x ?? b.restX ?? 0;
    const by = b.y ?? b.restY ?? 0;
    const cx = c.x ?? c.restX ?? 0;
    const cy = c.y ?? c.restY ?? 0;
    if (pointInTriangle(px, py, ax, ay, bx, by, cx, cy)) return true;
  }
  return false;
}

/**
 * Topmost-part hit-test.
 *
 * Iterates parts front-to-back by `draw_order` (descending). For each
 * visible meshed part, checks whether the world-space click landed
 * inside any triangle of its triangulation. First hit wins.
 *
 * Vertex source per part (in priority order):
 *   1. `opts.finalVertsByPartId` entry — the FINAL per-part verts the
 *      renderer last drew (chainEval + two-bone LBS + blend shapes
 *      composed). Match the user's visible geometry exactly. Set by
 *      `CanvasViewport`'s render loop after the GPU upload pass.
 *   2. `frames` entry from evalRig — chainEval canvas-px output. Used
 *      when the final-verts snapshot doesn't have an entry (e.g. a
 *      part that wasn't drawn this frame, or a fresh rig before the
 *      first render). Doesn't include the bone overlay / LBS pass —
 *      a posed limb tests against its rest position via this path.
 *   3. Rest mesh + `opts.worldMatrices.get(partId)` — for parts the
 *      rig doesn't drive (PSDs not run through Init Rig yet, group
 *      children that didn't enter the chain). The world-space click
 *      is inverse-transformed into the part's local space and tested
 *      against rest vertices. World matrix DOES include bone pose
 *      (`computeWorldMatrices` calls `makeBoneLocalMatrix`).
 *   4. Rest mesh in canvas-px — final fallback; matches what the
 *      renderer falls back to when no worldMatrix is available.
 *
 * Pre-mesh parts (PSD-imported, not yet auto-meshed — wizard reorder
 * step) hit-test against imageData alpha when `opts.imageDataMap` is
 * supplied: the canvas-sized RGBA buffer painted at PSD import time
 * already holds the layer's opaque-pixel footprint, so alpha-sampling
 * matches what the user sees rendered. Falls back to `imageBounds`
 * (opaque-pixel bbox in canvas space) when alpha data isn't available,
 * and finally to the full `imageWidth`/`imageHeight` rectangle. The
 * latter two are coarser — `imageWidth`/`imageHeight` is the entire
 * canvas for PSD parts, so it would always hit the topmost layer.
 *
 * @param {{nodes?: ReadonlyArray<any>}} project
 * @param {ReadonlyArray<{id?: string, vertexPositions?: Float32Array | number[]}> | null | undefined} frames
 * @param {number} worldX
 * @param {number} worldY
 * @param {{worldMatrices?: Map<string, Float32Array | number[]> | null, imageDataMap?: Map<string, import('../components/canvas/viewport/alphaMask.js').AlphaMaskRecord> | null, finalVertsByPartId?: Map<string, ReadonlyArray<{x:number,y:number}>> | null}} [opts]
 * @returns {string | null}
 */
export function hitTestParts(project, frames, worldX, worldY, opts = {}) {
  /** @type {Map<string, Float32Array | number[]>} */
  const frameMap = new Map();
  if (frames && typeof frames[Symbol.iterator] === 'function') {
    for (const f of frames) {
      if (f && typeof f.id === 'string' && f.vertexPositions) {
        frameMap.set(f.id, f.vertexPositions);
      }
    }
  }
  const worldMatrices = opts.worldMatrices ?? null;
  const imageDataMap = opts.imageDataMap ?? null;
  const finalVertsByPartId = opts.finalVertsByPartId ?? null;

  // Include parts with a triangulated mesh OR raw image-only parts (no
  // mesh yet — e.g. fresh PSD imports during the wizard's Reorder step).
  // Pre-mesh parts hit-test against alpha / imageBounds / imageWidth-Height
  // (in that priority); post-mesh parts use the triangulation as before.
  const parts = (project?.nodes ?? []).filter((n) => {
    if (!n || n.type !== 'part' || n.visible === false) return false;
    const m = getMesh(n, project);
    const hasTris = m
      && Array.isArray(m.triangles)
      && m.triangles.length > 0;
    const hasBounds = n.imageBounds
      && typeof n.imageBounds.minX === 'number'
      && typeof n.imageBounds.maxX === 'number'
      && n.imageBounds.maxX > n.imageBounds.minX
      && n.imageBounds.maxY > n.imageBounds.minY;
    const hasQuad = typeof n.imageWidth === 'number'
      && typeof n.imageHeight === 'number'
      && n.imageWidth > 0
      && n.imageHeight > 0;
    return hasTris || hasBounds || hasQuad;
  });
  parts.sort((a, b) => (b.draw_order ?? 0) - (a.draw_order ?? 0));

  for (const part of parts) {
    const partMesh = getMesh(part, project);
    const tris = partMesh?.triangles ?? null;
    // Priority 1: final composed verts (post chainEval + LBS + blends)
    // — what the renderer actually drew. Selectable at the visible
    // location even when the part is posed via two-bone LBS or has a
    // blend shape active. Format: Array<{x,y}>.
    const finalVerts = finalVertsByPartId?.get(part.id) ?? null;
    if (finalVerts && finalVerts.length > 0 && tris && tris.length > 0) {
      if (pointInAnyTriangleObjs(finalVerts, tris, worldX, worldY)) return part.id;
      continue;
    }
    // Priority 2: chainEval rig frames in canvas-px. Used when
    // finalVerts is unavailable (e.g. fresh rig before first render).
    const rigVerts = frameMap.get(part.id);
    if (rigVerts && tris && tris.length > 0) {
      if (pointInAnyTriangle(rigVerts, tris, worldX, worldY)) return part.id;
      continue;
    }

    const wm = worldMatrices?.get(part.id) ?? null;
    let lx = worldX, ly = worldY;
    if (wm) {
      const inv = mat3Inverse(wm);
      lx = inv[0] * worldX + inv[3] * worldY + inv[6];
      ly = inv[1] * worldX + inv[4] * worldY + inv[7];
    }

    // Triangulated mesh path: rest verts in local space.
    if (tris && tris.length > 0) {
      const local = partMesh?.vertices;
      if (Array.isArray(local) && local.length > 0
          && pointInAnyTriangleObjs(local, tris, lx, ly)) {
        return part.id;
      }
      continue;
    }

    // Pre-mesh hit-test priority for PSD-imported parts (wizard Reorder /
    // Adjust steps before auto-mesh runs):
    //   (a) alpha sample of the cached canvas-sized imageData — the layer's
    //       opaque-pixel footprint matches exactly what the user sees, so
    //       clicks on transparent areas (between layers) fall through to
    //       parts behind.
    //   (b) `imageBounds` rectangle in canvas space — the opaque-pixel
    //       bbox computed at PSD import. Coarser than alpha but still
    //       per-layer (every layer has a different bbox).
    //   (c) `imageWidth`/`imageHeight` rectangle in local space — final
    //       fallback. For PSD parts these dimensions are the FULL canvas
    //       (the texture covers the whole canvas with the layer painted
    //       at its PSD position), so this branch is always-hit and only
    //       useful when neither imageData nor imageBounds is available.
    //
    // M7b — alphaMask record is the 256² downsample of the layer's
    // canvas-painted alpha. `sampleAlphaMask` maps (worldX, worldY) →
    // mask cell → 0..255. Same pre-mesh-only contract as before; once
    // a part has triangles the priority-2 rigVerts path takes over.
    const maskRec = imageDataMap?.get(part.id) ?? null;
    if (maskRec && maskRec.w > 0) {
      const alpha = sampleAlphaMask(maskRec, worldX, worldY);
      if (alpha > 0) return part.id;
      continue;
    }

    const bb = part.imageBounds;
    if (bb && typeof bb.minX === 'number' && bb.maxX > bb.minX) {
      if (worldX >= bb.minX && worldX <= bb.maxX
          && worldY >= bb.minY && worldY <= bb.maxY) return part.id;
      continue;
    }

    const w = part.imageWidth;
    const h = part.imageHeight;
    if (typeof w === 'number' && typeof h === 'number'
        && lx >= 0 && lx <= w && ly >= 0 && ly <= h) return part.id;
  }
  return null;
}

/**
 * Toolset Phase 0.B — vertex hit-test for Edit Mode click-to-select.
 *
 * Given a part's frame-of-reference vertex positions and a world-space
 * point, returns the index of the vertex within `threshold` distance,
 * or `-1` when no vertex is within range. The threshold is the
 * world-space radius — callers compute it as a fixed pixel distance
 * (typically 6) divided by `view.zoom` so the hit area stays visually
 * constant across zoom levels (matches Blender's vertex pick threshold).
 *
 * Ties (multiple vertices within threshold): nearest wins. When two
 * vertices are equidistant, lower index wins (deterministic).
 *
 * @param {ArrayLike<number> | ReadonlyArray<{x:number,y:number}>} verts
 *   - flat `[x0, y0, x1, y1, ...]` OR Array<{x,y}> form. Both are
 *   supported because chainEval emits the flat shape and the rest
 *   `mesh.vertices` ships the object shape.
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} threshold - world-space radius
 * @returns {number} vertex index or -1
 */
export function hitTestVertices(verts, worldX, worldY, threshold) {
  if (!verts || threshold <= 0) return -1;
  const t2 = threshold * threshold;
  let bestIdx = -1;
  let bestD2 = Infinity;
  // Object-shape branch: Array<{x, y}>. Cast through `any` because the
  // union type doesn't narrow via property probe.
  const probe = /** @type {any} */ (verts[0]);
  if (probe && typeof probe.x === 'number') {
    /** @type {ReadonlyArray<{x:number,y:number}>} */
    const arr = /** @type {any} */ (verts);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      const dx = v.x - worldX;
      const dy = v.y - worldY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2 && d2 <= t2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
  // Flat-array branch: [x0, y0, x1, y1, ...].
  /** @type {ArrayLike<number>} */
  const flat = /** @type {any} */ (verts);
  const n = flat.length >> 1;
  for (let i = 0; i < n; i++) {
    const dx = flat[i * 2] - worldX;
    const dy = flat[i * 2 + 1] - worldY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 && d2 <= t2) {
      bestD2 = d2;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Toolset Phase 0.B — build a vertex adjacency map from a triangle
 * index list. Used by `Ctrl+LMB` shortest-path selection (BFS on
 * `mesh.shortest_path_pick` semantics — see `reference/blender/source/blender/editors/mesh/editmesh_select.cc`).
 *
 * Each vertex maps to the set of vertex indices it shares an edge with.
 * Triangles are interpreted as three pairwise edges (i,j), (j,k), (k,i).
 * Output map keys are vertex indices; values are `Set<number>`.
 *
 * @param {ReadonlyArray<number>} triangles - flat `[i, j, k, i, j, k, ...]`
 * @param {number} vertCount - total vertex count (for prealloc)
 * @returns {Map<number, Set<number>>}
 */
export function buildVertexAdjacency(triangles, vertCount) {
  /** @type {Map<number, Set<number>>} */
  const adj = new Map();
  if (!Array.isArray(triangles) && !(triangles instanceof Uint32Array || triangles instanceof Uint16Array)) {
    return adj;
  }
  const ensure = (i) => {
    let s = adj.get(i);
    if (!s) { s = new Set(); adj.set(i, s); }
    return s;
  };
  const n = triangles.length;
  for (let t = 0; t < n; t += 3) {
    const i = triangles[t];
    const j = triangles[t + 1];
    const k = triangles[t + 2];
    if (i < 0 || j < 0 || k < 0 || i >= vertCount || j >= vertCount || k >= vertCount) continue;
    ensure(i).add(j); ensure(i).add(k);
    ensure(j).add(i); ensure(j).add(k);
    ensure(k).add(i); ensure(k).add(j);
  }
  return adj;
}

/**
 * Toolset Phase 0.B — BFS shortest path from `fromIdx` to `toIdx` on
 * the vertex adjacency graph. Returns the path as an array of vertex
 * indices INCLUDING both endpoints, or `null` when unreachable
 * (disconnected mesh components) or when either endpoint is missing
 * from the graph.
 *
 * Mirrors Blender's `mesh.shortest_path_pick`: the user clicks the
 * active vertex, Ctrl+clicks a target, every vertex along the
 * connectivity path joins the selection. Pure topology (uses edge
 * count as the distance metric, not Euclidean) — same as Blender's
 * default behaviour.
 *
 * @param {Map<number, Set<number>>} adjacency
 * @param {number} fromIdx
 * @param {number} toIdx
 * @returns {number[] | null}
 */
export function shortestPathBetweenVertices(adjacency, fromIdx, toIdx) {
  if (!adjacency || !Number.isInteger(fromIdx) || !Number.isInteger(toIdx)) return null;
  if (fromIdx === toIdx) return [fromIdx];
  if (!adjacency.has(fromIdx) || !adjacency.has(toIdx)) return null;
  /** @type {Map<number, number>} */
  const cameFrom = new Map();
  cameFrom.set(fromIdx, -1);
  const queue = [fromIdx];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === toIdx) break;
    const nbrs = adjacency.get(cur);
    if (!nbrs) continue;
    for (const n of nbrs) {
      if (cameFrom.has(n)) continue;
      cameFrom.set(n, cur);
      if (n === toIdx) {
        // Reconstruct + return.
        const path = [n];
        let p = cameFrom.get(n) ?? -1;
        while (p !== -1) {
          path.push(p);
          p = cameFrom.get(p) ?? -1;
        }
        path.reverse();
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/**
 * Toolset Phase 1.A — vertices-in-rect for Edit Mode box select.
 *
 * Iterates a part's local-space rest verts and returns the indices of
 * every vertex inside the local-space rectangle `[minX,maxX]×[minY,maxY]`.
 * The caller is expected to inverse-transform the canvas-space rect
 * corners through the part's worldMatrix into local space before
 * calling — same pattern the click-to-select path uses for hit-test.
 *
 * Both flat `[x0,y0,x1,y1,...]` and `Array<{x,y}>` shapes accepted.
 * Inclusive on edges so a vert exactly on the rect boundary counts as
 * inside (Blender's box-select also includes boundary verts).
 *
 * @param {ArrayLike<number> | ReadonlyArray<{x:number,y:number}>} verts
 * @param {number} minX
 * @param {number} minY
 * @param {number} maxX
 * @param {number} maxY
 * @returns {number[]} matching vertex indices (ascending order)
 */
export function verticesInRect(verts, minX, minY, maxX, maxY) {
  /** @type {number[]} */
  const out = [];
  if (!verts) return out;
  if (minX > maxX) { const t = minX; minX = maxX; maxX = t; }
  if (minY > maxY) { const t = minY; minY = maxY; maxY = t; }
  const probe = /** @type {any} */ (verts[0]);
  if (probe && typeof probe.x === 'number') {
    /** @type {ReadonlyArray<{x:number,y:number}>} */
    const arr = /** @type {any} */ (verts);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY) out.push(i);
    }
    return out;
  }
  /** @type {ArrayLike<number>} */
  const flat = /** @type {any} */ (verts);
  const n = flat.length >> 1;
  for (let i = 0; i < n; i++) {
    const x = flat[i * 2];
    const y = flat[i * 2 + 1];
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) out.push(i);
  }
  return out;
}

/**
 * Toolset Phase 1.B — vertices-in-polygon for Edit Mode lasso select.
 *
 * Returns indices of every vertex inside the polygon defined by
 * `polyXs[]` / `polyYs[]` (parallel arrays in local space — same frame
 * as `verts`). Uses the standard ray-cast / crossings test (more
 * compact than winding number, and matches Blender's lasso behaviour
 * for the common simple-polygon case).
 *
 * Polygon edges are closed automatically (last → first). Self-
 * intersecting paths follow the even-odd fill rule, which matches
 * Blender's lasso (a figure-8 lasso selects the "outer" lobes only —
 * the centre cross-over is "outside" by even-odd, same as Blender).
 *
 * @param {ArrayLike<number> | ReadonlyArray<{x:number,y:number}>} verts
 * @param {ReadonlyArray<number>} polyXs
 * @param {ReadonlyArray<number>} polyYs
 * @returns {number[]} matching vertex indices (ascending order)
 */
export function verticesInPolygon(verts, polyXs, polyYs) {
  /** @type {number[]} */
  const out = [];
  if (!verts || !polyXs || !polyYs) return out;
  const np = Math.min(polyXs.length, polyYs.length);
  if (np < 3) return out;
  const probe = /** @type {any} */ (verts[0]);
  /** @param {number} px @param {number} py */
  const inside = (px, py) => pointInPolygon(px, py, polyXs, polyYs);
  if (probe && typeof probe.x === 'number') {
    /** @type {ReadonlyArray<{x:number,y:number}>} */
    const arr = /** @type {any} */ (verts);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (inside(v.x, v.y)) out.push(i);
    }
    return out;
  }
  /** @type {ArrayLike<number>} */
  const flat = /** @type {any} */ (verts);
  const n = flat.length >> 1;
  for (let i = 0; i < n; i++) {
    if (inside(flat[i * 2], flat[i * 2 + 1])) out.push(i);
  }
  return out;
}

/**
 * Even-odd point-in-polygon test (ray-cast / crossings).
 *
 * Self-intersecting polygons follow the even-odd fill rule (figure-8
 * lasso selects outer lobes only) — matches Blender's lasso semantics.
 *
 * @param {number} px
 * @param {number} py
 * @param {ReadonlyArray<number>} polyXs
 * @param {ReadonlyArray<number>} polyYs
 * @returns {boolean}
 */
export function pointInPolygon(px, py, polyXs, polyYs) {
  const n = Math.min(polyXs.length, polyYs.length);
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polyXs[i], yi = polyYs[i];
    const xj = polyXs[j], yj = polyYs[j];
    // Ray cast east from (px, py); count edge crossings.
    const intersect = ((yi > py) !== (yj > py))
      && (px < (xj - xi) * (py - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Toolset Phase 1.A — part-AABB-vs-rect intersection for Object Mode
 * box select.
 *
 * Returns `true` when the part's canvas-space mesh AABB intersects the
 * canvas-space rectangle. Uses `finalVertsByPartId` when supplied
 * (matches what the user sees rendered, including chainEval + LBS +
 * blends), then `frames` (chainEval-only), then rest mesh in
 * canvas-px via the part's worldMatrix.
 *
 * Standard separating-axis test: two AABBs intersect iff their
 * intervals overlap on both X and Y. Inclusive on edges so a part
 * grazing the rect counts as hit.
 *
 * Pre-mesh PSD-imported parts (no triangles yet) fall back to
 * `imageBounds` when present, then to the full canvas-quad
 * (`imageWidth`/`imageHeight` in local space) — same priority order
 * as `hitTestParts`.
 *
 * @param {{nodes?: ReadonlyArray<any>}} project
 * @param {ReadonlyArray<{id?: string, vertexPositions?: Float32Array | number[]}> | null | undefined} frames
 * @param {number} rectMinX
 * @param {number} rectMinY
 * @param {number} rectMaxX
 * @param {number} rectMaxY
 * @param {{worldMatrices?: Map<string, Float32Array | number[]> | null, finalVertsByPartId?: Map<string, ReadonlyArray<{x:number,y:number}>> | null}} [opts]
 * @returns {string[]} part ids whose AABB intersects the rect
 */
export function partsInRect(project, frames, rectMinX, rectMinY, rectMaxX, rectMaxY, opts = {}) {
  if (rectMinX > rectMaxX) { const t = rectMinX; rectMinX = rectMaxX; rectMaxX = t; }
  if (rectMinY > rectMaxY) { const t = rectMinY; rectMinY = rectMaxY; rectMaxY = t; }
  const worldMatrices = opts.worldMatrices ?? null;
  const finalVertsByPartId = opts.finalVertsByPartId ?? null;
  /** @type {Map<string, Float32Array | number[]>} */
  const frameMap = new Map();
  if (frames && typeof frames[Symbol.iterator] === 'function') {
    for (const f of frames) {
      if (f && typeof f.id === 'string' && f.vertexPositions) {
        frameMap.set(f.id, f.vertexPositions);
      }
    }
  }
  /** @type {string[]} */
  const out = [];
  for (const part of project?.nodes ?? []) {
    if (!part || part.type !== 'part' || part.visible === false) continue;
    const aabb = computePartAabbCanvas(part, project, frameMap, worldMatrices, finalVertsByPartId);
    if (!aabb) continue;
    if (aabb.maxX < rectMinX || aabb.minX > rectMaxX) continue;
    if (aabb.maxY < rectMinY || aabb.minY > rectMaxY) continue;
    out.push(part.id);
  }
  return out;
}

/**
 * Toolset Phase 1.B — parts whose AABB centroid (or any vertex) falls
 * inside a polygon, in canvas space. Used by Object-Mode lasso select.
 *
 * To match Blender's behaviour (a part is "inside" when its origin
 * passes the lasso, not just its bbox), we test the AABB centre and
 * any of the four AABB corners. A part is considered inside when at
 * least one of those five points is inside the polygon. This is more
 * permissive than centre-only (lassoes that clip a part still pick it
 * up) but doesn't degenerate to whole-mesh-inside as a strict bounds
 * test would.
 *
 * @param {{nodes?: ReadonlyArray<any>}} project
 * @param {ReadonlyArray<{id?: string, vertexPositions?: Float32Array | number[]}> | null | undefined} frames
 * @param {ReadonlyArray<number>} polyXs
 * @param {ReadonlyArray<number>} polyYs
 * @param {{worldMatrices?: Map<string, Float32Array | number[]> | null, finalVertsByPartId?: Map<string, ReadonlyArray<{x:number,y:number}>> | null}} [opts]
 * @returns {string[]}
 */
export function partsInPolygon(project, frames, polyXs, polyYs, opts = {}) {
  const np = Math.min(polyXs?.length ?? 0, polyYs?.length ?? 0);
  /** @type {string[]} */
  const out = [];
  if (np < 3) return out;
  const worldMatrices = opts.worldMatrices ?? null;
  const finalVertsByPartId = opts.finalVertsByPartId ?? null;
  /** @type {Map<string, Float32Array | number[]>} */
  const frameMap = new Map();
  if (frames && typeof frames[Symbol.iterator] === 'function') {
    for (const f of frames) {
      if (f && typeof f.id === 'string' && f.vertexPositions) {
        frameMap.set(f.id, f.vertexPositions);
      }
    }
  }
  for (const part of project?.nodes ?? []) {
    if (!part || part.type !== 'part' || part.visible === false) continue;
    const aabb = computePartAabbCanvas(part, project, frameMap, worldMatrices, finalVertsByPartId);
    if (!aabb) continue;
    const cx = (aabb.minX + aabb.maxX) / 2;
    const cy = (aabb.minY + aabb.maxY) / 2;
    if (pointInPolygon(cx, cy, polyXs, polyYs)
      || pointInPolygon(aabb.minX, aabb.minY, polyXs, polyYs)
      || pointInPolygon(aabb.maxX, aabb.minY, polyXs, polyYs)
      || pointInPolygon(aabb.minX, aabb.maxY, polyXs, polyYs)
      || pointInPolygon(aabb.maxX, aabb.maxY, polyXs, polyYs)) {
      out.push(part.id);
    }
  }
  return out;
}

/**
 * Compute a part's canvas-space mesh AABB. Returns `null` when the
 * part has no geometry to bound against.
 *
 * Vertex source priority mirrors `hitTestParts`:
 *   1. `finalVertsByPartId` — composed verts the renderer drew
 *   2. `frameMap` (chainEval canvas-px output)
 *   3. rest mesh transformed through the part's worldMatrix
 *   4. pre-mesh PSD parts: `imageBounds` (canvas-px)
 *   5. `imageWidth`/`imageHeight` rectangle through worldMatrix
 *
 * @param {any} part
 * @param {{nodes?: ReadonlyArray<any>}} project
 * @param {Map<string, Float32Array | number[]>} frameMap
 * @param {Map<string, Float32Array | number[]> | null} worldMatrices
 * @param {Map<string, ReadonlyArray<{x:number,y:number}>> | null} finalVertsByPartId
 * @returns {{minX:number, minY:number, maxX:number, maxY:number} | null}
 */
function computePartAabbCanvas(part, project, frameMap, worldMatrices, finalVertsByPartId) {
  const partMesh = getMesh(part, project);

  // Priority 1 — final composed verts (already in canvas-px).
  const finalVerts = finalVertsByPartId?.get(part.id) ?? null;
  if (finalVerts && finalVerts.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of finalVerts) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }

  // Priority 2 — chainEval frames (canvas-px, flat array).
  const rigVerts = frameMap.get(part.id);
  if (rigVerts && rigVerts.length >= 2) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const n = rigVerts.length >> 1;
    for (let i = 0; i < n; i++) {
      const x = rigVerts[i * 2];
      const y = rigVerts[i * 2 + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }

  // Priority 3 — rest mesh transformed through worldMatrix.
  const wm = worldMatrices?.get(part.id) ?? null;
  if (partMesh?.vertices && partMesh.vertices.length > 0) {
    const verts = partMesh.vertices;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (wm) {
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        const lx = v?.x ?? v?.restX ?? 0;
        const ly = v?.y ?? v?.restY ?? 0;
        const wx = wm[0] * lx + wm[3] * ly + wm[6];
        const wy = wm[1] * lx + wm[4] * ly + wm[7];
        if (wx < minX) minX = wx;
        if (wy < minY) minY = wy;
        if (wx > maxX) maxX = wx;
        if (wy > maxY) maxY = wy;
      }
    } else {
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        const x = v?.x ?? v?.restX ?? 0;
        const y = v?.y ?? v?.restY ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }

  // Priority 4 — pre-mesh PSD: imageBounds in canvas space.
  const bb = part.imageBounds;
  if (bb && typeof bb.minX === 'number' && bb.maxX > bb.minX) {
    return { minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY };
  }

  // Priority 5 — pre-mesh PSD: full image quad via worldMatrix.
  const w = part.imageWidth, h = part.imageHeight;
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
    if (wm) {
      const cs = [
        [0, 0], [w, 0], [0, h], [w, h],
      ];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [lx, ly] of cs) {
        const wx = wm[0] * lx + wm[3] * ly + wm[6];
        const wy = wm[1] * lx + wm[4] * ly + wm[7];
        if (wx < minX) minX = wx;
        if (wy < minY) minY = wy;
        if (wx > maxX) maxX = wx;
        if (wy > maxY) maxY = wy;
      }
      return { minX, minY, maxX, maxY };
    }
    return { minX: 0, minY: 0, maxX: w, maxY: h };
  }

  return null;
}

// Re-export mat3Identity for tests that want to construct identity-only
// worldMatrices maps without pulling in the renderer module.
export { mat3Identity };
