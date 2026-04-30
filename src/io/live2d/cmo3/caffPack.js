// @ts-check

import { packCaff, COMPRESS_RAW, COMPRESS_FAST } from '../caffPacker.js';
import { buildRawPng } from './pngHelpers.js';

/**
 * CAFF (Cubism Archive File Format) packing for the .cmo3 generator's
 * Section 7. Lifted out of `cmo3writer.js` (Phase 6 god-class breakup,
 * sweep #27).
 *
 * Pure side-effect-free archive assembly:
 *
 *   1. Three preview icons (64/32/16 raw white PNGs) referenced by the
 *      `CImageIcon` fields embedded in the main.xml. v14 schema
 *      requires them; absence triggers blank-load.
 *   2. One PNG per mesh — either the mesh's own `pngData` or a
 *      canvas-sized white fallback when the mesh is a placeholder.
 *   3. The serialized main.xml (FAST-compressed, tagged `main_xml`).
 *
 * Caller does the XmlBuilder serialization first so the bytes are
 * already in hand when this runs.
 *
 * @module io/live2d/cmo3/caffPack
 */

/**
 * @typedef {Object} CaffPackPerMesh
 * @property {number} mi            Mesh index into the original `meshes` array.
 * @property {string} pngPath       In-archive path (e.g. `imageFileBuf_0.png`).
 */

/**
 * Pack the cmo3 archive: icons + per-mesh textures + main.xml.
 *
 * @param {Object} opts
 * @param {Uint8Array} opts.xmlBytes
 * @param {CaffPackPerMesh[]} opts.perMesh
 * @param {Array<{ pngData?: Uint8Array }>} opts.meshes
 * @param {number} opts.canvasW
 * @param {number} opts.canvasH
 * @returns {Promise<Uint8Array>}
 */
export async function packCmo3(opts) {
  const { xmlBytes, perMesh, meshes, canvasW, canvasH } = opts;

  /** @type {Array<{path:string, content:Uint8Array, tag:string, obfuscated:boolean, compress:number}>} */
  const caffFiles = [];

  // v14 preview icons — referenced by CImageIcon fields in main.xml.
  for (const sz of [64, 32, 16]) {
    caffFiles.push({
      path: `cmo3_icon_${sz}.png`,
      content: buildRawPng(sz, sz),
      tag: '',
      obfuscated: true,
      compress: COMPRESS_RAW,
    });
  }

  for (const pm of perMesh) {
    caffFiles.push({
      path: pm.pngPath,
      content: pm.mi < meshes.length ? meshes[pm.mi].pngData : buildRawPng(canvasW, canvasH),
      tag: '',
      obfuscated: true,
      compress: COMPRESS_RAW,
    });
  }

  caffFiles.push({
    path: 'main.xml',
    content: xmlBytes,
    tag: 'main_xml',
    obfuscated: true,
    compress: COMPRESS_FAST,
  });

  return await packCaff(caffFiles, 42);
}
