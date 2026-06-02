/**
 * Mesh generation Web Worker entry point.
 *
 * Receives:  { imageData: {data, width, height}, opts }
 * Responds:  { vertices, uvs, triangles, edgeIndices }
 *
 * Note: Sets (edgeIndices) can't be transferred — send as plain Array.
 */
import { generateMesh } from './generate.js';

self.onmessage = function (e) {
  const { imageData, opts } = e.data;

  try {
    const result = generateMesh(
      imageData.data,
      imageData.width,
      imageData.height,
      opts
    );

    // Serialise the Set → Array for postMessage
    self.postMessage({
      ok: true,
      vertices: result.vertices,
      uvs: result.uvs,
      triangles: result.triangles,
      edgeIndices: Array.from(result.edgeIndices),
    }, [result.uvs.buffer]); // Transfer the Float32Array buffer

  } catch (err) {
    // WORKER-008 — `err.message` is undefined for non-Error throws
    // (some triangulation libs throw arrays/strings). Match
    // psd.worker.js / psdFinalize.worker.js safer pattern so the pool
    // rejects with a real message instead of `undefined ?? fallback`.
    const message = err && err.message ? err.message : String(err);
    self.postMessage({ ok: false, error: message, stack: err && err.stack ? err.stack : undefined });
  }
};
