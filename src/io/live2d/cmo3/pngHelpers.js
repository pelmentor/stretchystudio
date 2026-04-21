/**
 * PNG helpers for the .cmo3 generator.
 *
 * - `buildRawPng`: synthesizes a white RGBA PNG from scratch using
 *   uncompressed deflate blocks. Used as a fallback texture when a mesh
 *   doesn't provide its own PNG.
 * - `extractBottomContourFromLayerPng`: samples a layer PNG's bottom-edge
 *   alpha contour for the eye-closure parabola fit (P12).
 *
 * @module io/live2d/cmo3/pngHelpers
 */

/** Build a raw white RGBA PNG from scratch (no canvas needed). */
export function buildRawPng(w, h) {
  // PNG = signature + IHDR + IDAT + IEND
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const len = data.length;
    const buf = new Uint8Array(4 + type.length + data.length + 4);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, len, false);
    buf.set(type, 4);
    buf.set(data, 4 + type.length);
    // CRC over type+data
    const crcData = buf.subarray(4, 4 + type.length + data.length);
    const crc = crc32Buf(crcData);
    dv.setUint32(4 + type.length + data.length, crc, false);
    return buf;
  }

  // IHDR
  const ihdrData = new Uint8Array(13);
  const ihdrDv = new DataView(ihdrData.buffer);
  ihdrDv.setUint32(0, w, false);
  ihdrDv.setUint32(4, h, false);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk(new Uint8Array([73, 72, 68, 82]), ihdrData);

  // IDAT — white opaque pixels, filter byte 0 per row
  const rawRow = new Uint8Array(1 + w * 4);
  rawRow[0] = 0; // filter none
  for (let x = 0; x < w; x++) {
    rawRow[1 + x * 4 + 0] = 255;
    rawRow[1 + x * 4 + 1] = 255;
    rawRow[1 + x * 4 + 2] = 255;
    rawRow[1 + x * 4 + 3] = 255;
  }
  const rawData = new Uint8Array(rawRow.length * h);
  for (let y = 0; y < h; y++) rawData.set(rawRow, y * rawRow.length);

  // Deflate using CompressionStream is async — use uncompressed deflate blocks instead
  const deflated = deflateUncompressed(rawData);
  const idat = makeChunk(new Uint8Array([73, 68, 65, 84]), deflated);

  const iend = makeChunk(new Uint8Array([73, 69, 78, 68]), new Uint8Array(0));

  const total = signature.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(total);
  let off = 0;
  png.set(signature, off); off += signature.length;
  png.set(ihdr, off); off += ihdr.length;
  png.set(idat, off); off += idat.length;
  png.set(iend, off);
  return png;
}

/** Wrap raw data in uncompressed deflate blocks (zlib stream). */
function deflateUncompressed(data) {
  // zlib header: CMF=0x78, FLG=0x01
  const maxBlock = 65535;
  const numBlocks = Math.ceil(data.length / maxBlock) || 1;
  const outSize = 2 + numBlocks * 5 + data.length + 4; // header + blocks + adler32
  const out = new Uint8Array(outSize);
  let pos = 0;
  out[pos++] = 0x78; // CMF
  out[pos++] = 0x01; // FLG
  let remaining = data.length;
  let srcOff = 0;
  while (remaining > 0 || srcOff === 0) {
    const blockLen = Math.min(remaining, maxBlock);
    const isLast = remaining <= maxBlock;
    out[pos++] = isLast ? 1 : 0; // BFINAL
    out[pos++] = blockLen & 0xFF;
    out[pos++] = (blockLen >> 8) & 0xFF;
    out[pos++] = (~blockLen) & 0xFF;
    out[pos++] = ((~blockLen) >> 8) & 0xFF;
    out.set(data.subarray(srcOff, srcOff + blockLen), pos);
    pos += blockLen;
    srcOff += blockLen;
    remaining -= blockLen;
    if (blockLen === 0) break;
  }
  // Adler-32
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  out[pos++] = (adler >> 24) & 0xFF;
  out[pos++] = (adler >> 16) & 0xFF;
  out[pos++] = (adler >> 8) & 0xFF;
  out[pos++] = adler & 0xFF;
  return out.subarray(0, pos);
}

const CRC_TABLE_PNG = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32Buf(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ CRC_TABLE_PNG[(crc ^ data[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * P12 (Apr 2026): extract a layer's bottom contour directly from its PNG alpha.
 * Used by the eye-closure parabola fit to find the TRUE drawn bottom edge of the
 * eyewhite, bypassing SS mesh triangulation artifacts (bin-max on dense interior
 * vertices can pick INSIDE instead of the edge, flipping the closure direction).
 *
 * For each X column within [xMinCanvas, xMaxCanvas], scans from the bottom of
 * the canvas upward until it finds a pixel with alpha > threshold. That pixel's
 * (x, y) is the bottom edge sample. Returns an array of [x, y] pairs in canvas
 * coordinates, or null if decode fails / no opaque pixels found.
 *
 * @param {Uint8Array} pngData - Canvas-sized PNG bytes (alpha channel marks the layer)
 * @param {number} xMinCanvas
 * @param {number} xMaxCanvas
 * @returns {Promise<Array<[number, number]> | null>}
 */
export async function extractBottomContourFromLayerPng(pngData, xMinCanvas, xMaxCanvas) {
  if (!pngData || !pngData.length) return null;
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return null;
  try {
    const blob = new Blob([pngData], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    let img;
    try {
      img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = (e) => reject(e);
        el.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    const canvas = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(img.width, img.height)
      : Object.assign(document.createElement('canvas'), {
          width: img.width, height: img.height,
        });
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const ALPHA_THRESHOLD = 16;
    const xStart = Math.max(0, Math.floor(xMinCanvas));
    const xEnd   = Math.min(img.width - 1, Math.ceil(xMaxCanvas));
    const contour = [];
    for (let x = xStart; x <= xEnd; x++) {
      for (let y = img.height - 1; y >= 0; y--) {
        if (data[(y * img.width + x) * 4 + 3] > ALPHA_THRESHOLD) {
          contour.push([x, y]);
          break;
        }
      }
    }
    return contour.length >= 3 ? contour : null;
  } catch {
    return null;
  }
}
