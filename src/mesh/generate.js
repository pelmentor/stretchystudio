/**
 * Mesh generation orchestrator.
 *
 * image → {vertices, uvs, triangles, edgeIndices}
 *
 * This is a pure module — no DOM, no classes.
 * Designed to run both on the main thread and inside a Web Worker.
 */
import { dilateAlphaMask, traceAllContours, resampleContour, smoothContour } from './contour.js';
import { sampleInterior, filterByEdgePadding } from './sample.js';
import { triangulate } from './delaunay.js';
import { SpatialHash } from './spatialHash.js';

/**
 * Re-triangulate existing vertices without changing them.
 * Useful after adding/removing vertices — preserves positions and UVs,
 * only regenerates triangle connectivity.
 *
 * @param {Array<{x:number,y:number,restX:number,restY:number}>} vertices
 * @param {Float32Array} uvs
 * @param {Set<number>} edgeIndices - which vertices are on the boundary (preserved)
 * @returns {MeshResult}
 */
export function retriangulate(vertices, uvs, edgeIndices) {
  if (vertices.length < 3) {
    return { vertices, uvs, triangles: [], edgeIndices };
  }

  // Extract [x, y] points from existing vertices
  const points = vertices.map(v => [v.x, v.y]);

  // Triangulate
  const triangles = triangulate(points);

  // Preserve edgeIndices as-is
  return { vertices, uvs, triangles, edgeIndices };
}

/**
 * @typedef {Object} MeshResult
 * @property {Array<{x:number,y:number,restX:number,restY:number}>} vertices
 * @property {Float32Array}                                           uvs        - flat [u0,v0, u1,v1, …] in [0,1]
 * @property {Array<[number,number,number]>}                          triangles
 * @property {Set<number>}                                            edgeIndices - which vertex indices are on the boundary
 */

/**
 * Generate mesh from raw RGBA image data.
 *
 * @param {Uint8ClampedArray} data            - RGBA pixel data
 * @param {number}            width
 * @param {number}            height
 * @param {Object}            [opts]
 * @param {number}            [opts.alphaThreshold=5]
 * @param {number}            [opts.smoothPasses=0]
 * @param {number}            [opts.gridSpacing=30]
 * @param {number}            [opts.edgePadding=8]    - Min distance interior pts must keep from edge pts
 * @param {number}            [opts.numEdgePoints=80] - Total edge pts distributed across all contours
 * @returns {MeshResult}
 */
export function generateMesh(data, width, height, opts = {}) {
  const {
    alphaThreshold = 5,
    smoothPasses   = 0,
    gridSpacing    = 30,
    edgePadding    = 8,
    numEdgePoints  = 80,
  } = opts;

  // 1. Dilate alpha mask by 2px so edge vertices land just outside the visual boundary.
  //    The texture alpha clips the final render, so chord-shortcut gaps are invisible.
  const contourMask = dilateAlphaMask(data, width, height, alphaThreshold, 2);

  // 2. Trace all closed contours — one per separated region (eyes, arms, etc.)
  const contours = traceAllContours(contourMask, width, height);

  // 3. Distribute numEdgePoints across contours proportionally by perimeter
  const edgePts = [];
  if (contours.length > 0) {
    const perimeters = contours.map(c => {
      let p = 0;
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i + 1) % c.length];
        p += Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
      }
      return p;
    });
    const totalPerimeter = perimeters.reduce((a, b) => a + b, 0);

    for (let ci = 0; ci < contours.length; ci++) {
      const share = Math.max(3, Math.round(numEdgePoints * perimeters[ci] / totalPerimeter));
      let pts = resampleContour(contours[ci], Math.min(share, contours[ci].length));
      pts = smoothContour(pts, smoothPasses);
      edgePts.push(...pts);
    }
  }

  // 4. Interior grid — sampled from original alpha so all regions are filled
  let interiorPts = sampleInterior(data, width, height, alphaThreshold, Math.max(6, gridSpacing));
  if (edgePadding > 0 && edgePts.length > 0) {
    interiorPts = filterByEdgePadding(interiorPts, edgePts, edgePadding);
  }

  // 5. Combine & deduplicate via spatial hash — O(N) total instead of
  //    the prior O(N²) scan against the growing accumulator. cellSize
  //    matches MIN_DIST so the 3×3 query covers every candidate
  //    duplicate.
  const allPts = [...edgePts, ...interiorPts];
  const rawEdgeCount = edgePts.length;
  const deduped = [];
  const edgeSet = new Set();
  const MIN_DIST = 2;
  const hash = new SpatialHash(MIN_DIST);

  for (let i = 0; i < allPts.length; i++) {
    const [px, py] = allPts[i];
    if (hash.hasWithin(px, py, MIN_DIST)) continue;
    if (i < rawEdgeCount) edgeSet.add(deduped.length);
    deduped.push([px, py]);
    hash.add(px, py);
  }

  // 6. Triangulate
  const triangles = triangulate(deduped);

  // 7. Build output arrays
  const vertices = deduped.map(([x, y]) => ({
    x, y,
    restX: x,
    restY: y,
  }));

  const uvs = new Float32Array(deduped.length * 2);
  for (let i = 0; i < deduped.length; i++) {
    uvs[i * 2]     = deduped[i][0] / width;
    uvs[i * 2 + 1] = deduped[i][1] / height;
  }

  return { vertices, uvs, triangles, edgeIndices: edgeSet };
}
