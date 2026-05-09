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

// Re-export mat3Identity for tests that want to construct identity-only
// worldMatrices maps without pulling in the renderer module.
export { mat3Identity };
