// @ts-check

/**
 * Click-to-select on canvas (Blender pattern).
 *
 * Pure triangle hit-test against rig-evaluated vertex positions. Given
 * the project, the latest evalRig output, and a world-space click
 * coordinate, returns the topmost partId whose triangulation contains
 * the point — matching what the user actually sees rendered.
 *
 * Plan: docs/CLICK_TO_SELECT_PLAN.md.
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
 *   1. `frames` entry from evalRig — already in canvas-px, no
 *      worldMatrix application needed.
 *   2. Rest mesh + `opts.worldMatrices.get(partId)` — for parts the
 *      rig doesn't drive (PSDs not run through Init Rig yet, group
 *      children that didn't enter the chain). The world-space click
 *      is inverse-transformed into the part's local space and tested
 *      against rest vertices.
 *   3. Rest mesh in canvas-px — final fallback; matches what the
 *      renderer falls back to when no worldMatrix is available.
 *
 * @param {{nodes?: ReadonlyArray<any>}} project
 * @param {ReadonlyArray<{id?: string, vertexPositions?: Float32Array | number[]}> | null | undefined} frames
 * @param {number} worldX
 * @param {number} worldY
 * @param {{worldMatrices?: Map<string, Float32Array | number[]> | null}} [opts]
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

  const parts = (project?.nodes ?? []).filter((n) =>
    n
    && n.type === 'part'
    && n.visible !== false
    && n.mesh
    && Array.isArray(n.mesh.triangles)
    && n.mesh.triangles.length > 0,
  );
  parts.sort((a, b) => (b.draw_order ?? 0) - (a.draw_order ?? 0));

  for (const part of parts) {
    const tris = part.mesh.triangles;
    const rigVerts = frameMap.get(part.id);
    if (rigVerts) {
      if (pointInAnyTriangle(rigVerts, tris, worldX, worldY)) return part.id;
      continue;
    }

    // Fallback: rest mesh. Inverse-transform the click point into
    // the part's local space if a worldMatrix is available.
    const local = part.mesh.vertices;
    if (!Array.isArray(local) || local.length === 0) continue;
    const wm = worldMatrices?.get(part.id) ?? null;
    let lx = worldX, ly = worldY;
    if (wm) {
      const inv = mat3Inverse(wm);
      lx = inv[0] * worldX + inv[3] * worldY + inv[6];
      ly = inv[1] * worldX + inv[4] * worldY + inv[7];
    }
    if (pointInAnyTriangleObjs(local, tris, lx, ly)) return part.id;
  }
  return null;
}

// Re-export mat3Identity for tests that want to construct identity-only
// worldMatrices maps without pulling in the renderer module.
export { mat3Identity };
