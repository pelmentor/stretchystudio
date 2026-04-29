// @ts-check

/**
 * v3 — small image helpers shared between the export operator and
 * the ExportModal. Each consumer needs an `images: Map<id, HTMLImageElement>`
 * keyed by texture id; loading them in browser code requires the
 * <img> element so the helper lives here rather than in the
 * services layer (which prefers to stay DOM-free).
 *
 * @module io/imageHelpers
 */

/**
 * Load every texture's source into a decoded HTMLImageElement.
 * Resolves once all images are decoded; rejects on the first image
 * that errors out.
 *
 * @param {object} project
 * @returns {Promise<Map<string, HTMLImageElement>>}
 */
export async function loadProjectTextures(project) {
  /** @type {Map<string, HTMLImageElement>} */
  const images = new Map();
  for (const tex of project?.textures ?? []) {
    if (!tex?.source) continue;
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { images.set(tex.id, img); resolve(undefined); };
      img.onerror = (err) => reject(err);
      img.src = tex.source;
    });
  }
  return images;
}
