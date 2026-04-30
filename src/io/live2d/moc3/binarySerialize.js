// @ts-nocheck

/**
 * Binary serialization pipeline for the .moc3 generator.
 *
 * Lifted out of moc3writer.js (Phase 6 god-class breakup, sweep #40).
 *
 * Translates the prepared `{ sections, counts, canvas }` bundle into
 * the final ArrayBuffer. Two phases:
 *
 *   - **Phase 1** writes the body — count info → canvas info →
 *     `SECTION_LAYOUT` walk emitting each typed-array section, then
 *     V3.03+ `quad_transforms` (Bool32 per warp deformer; matches
 *     Hiyori's all-false pattern). Records absolute offsets in `sotEntries`.
 *
 *   - **Phase 2** assembles header (MAGIC + version + endian flag) + SOT
 *     (160 × uint32, padded with the last valid offset, NOT 0 — the
 *     SDK rejects 0 entries) + padding to `DEFAULT_OFFSET` + body.
 *     Final 64-byte alignment ensures SOT offsets stay ≤ file_size.
 *
 * `writeSection` dispatches per ELEM type (RUNTIME emits zero bytes,
 * I32/F32/I16/U8/BOOL/STR64 each have their own array writer on
 * `BinaryWriter`).
 *
 * @module io/live2d/moc3/binarySerialize
 */

import {
  MAGIC, HEADER_SIZE, SOT_COUNT, COUNT_INFO_SIZE,
  CANVAS_INFO_SIZE, DEFAULT_OFFSET, ALIGN, RUNTIME_UNIT_SIZE,
  MOC_VERSION, COUNT_IDX, ELEM, SECTION_LAYOUT,
} from './layout.js';
import { BinaryWriter } from './binaryWriter.js';

/**
 * Write a single section's data.
 *
 * @param {BinaryWriter} w
 * @param {object} elemType - One of the ELEM constants
 * @param {any[]} data
 * @param {number} count
 */
function writeSection(w, elemType, data, count) {
  if (elemType === ELEM.RUNTIME) {
    w.fill(count * RUNTIME_UNIT_SIZE);
  } else if (elemType === ELEM.I32) {
    w.writeI32Array(data);
  } else if (elemType === ELEM.F32) {
    w.writeF32Array(data);
  } else if (elemType === ELEM.I16) {
    w.writeI16Array(data);
  } else if (elemType === ELEM.U8) {
    w.writeU8Array(data);
  } else if (elemType === ELEM.BOOL) {
    w.writeBoolArray(data);
  } else if (elemType === ELEM.STR64) {
    w.writeStringArray(data);
  }
}

/**
 * Serialise the prepared section bundle into a .moc3 ArrayBuffer.
 *
 * @param {Object} bundle
 * @param {Map<string, any[]>} bundle.sections
 * @param {number[]} bundle.counts
 * @param {Object} bundle.canvas
 * @returns {ArrayBuffer}
 */
export function serializeMoc3({ sections, counts, canvas }) {
  // V4.00 matches Hiyori reference — confirmed working with Ren'Py 8.5 Cubism SDK
  const version = MOC_VERSION.V4_00;

  // ── Phase 1: Body sections, recording absolute offsets ──
  const body = new BinaryWriter();
  const sotEntries = [];

  // SOT[0] — Count Info
  sotEntries.push(DEFAULT_OFFSET + body.pos);
  for (const c of counts) body.writeI32(c);
  body.fill(COUNT_INFO_SIZE - counts.length * 4);

  // SOT[1] — Canvas Info
  sotEntries.push(DEFAULT_OFFSET + body.pos);
  body.writeF32(canvas.pixelsPerUnit);
  body.writeF32(canvas.originX);
  body.writeF32(canvas.originY);
  body.writeF32(canvas.canvasWidth);
  body.writeF32(canvas.canvasHeight);
  body.writeU8(canvas.canvasFlag);
  body.fill(CANVAS_INFO_SIZE - (5 * 4 + 1));

  // SOT[2..] — Body sections
  for (const [name, elemType, countIdx, alignment] of SECTION_LAYOUT) {
    if (alignment > 0) body.padTo(alignment);
    sotEntries.push(DEFAULT_OFFSET + body.pos);

    const data = sections.get(name) ?? [];
    const count = elemType === ELEM.RUNTIME
      ? (countIdx >= 0 ? counts[countIdx] : 0)
      : data.length;

    writeSection(body, elemType, data, count);
  }

  // V3.03+ quad_transforms (Bool32 per warp deformer; SDK reads N×4 bytes
  // at this offset so emit explicit zeros for every warp).
  if (version >= MOC_VERSION.V3_03) {
    body.padTo(ALIGN);
    sotEntries.push(DEFAULT_OFFSET + body.pos);
    const numWarps = counts[COUNT_IDX.WARP_DEFORMERS];
    for (let i = 0; i < numWarps; i++) body.writeI32(0); // false
  }

  // ── Phase 2: Header + SOT + padding + body ──
  const out = new BinaryWriter();

  // Header (64 bytes)
  out.writeU8(MAGIC[0]); out.writeU8(MAGIC[1]); out.writeU8(MAGIC[2]); out.writeU8(MAGIC[3]);
  out.writeU8(version);
  out.writeU8(0); // endian flag (0 = LE)
  out.fill(HEADER_SIZE - 6);

  // SOT (160 × uint32) — pad with last valid offset, NOT zero
  // (SDK validates non-zero entries for the current version).
  const lastValidOffset = sotEntries[sotEntries.length - 1] || DEFAULT_OFFSET;
  while (sotEntries.length < SOT_COUNT) sotEntries.push(lastValidOffset);
  out.writeU32Array(sotEntries.slice(0, SOT_COUNT));

  // Pad to DEFAULT_OFFSET, then append body
  out.fill(DEFAULT_OFFSET - out.pos);
  const bodyBytes = new Uint8Array(body.toArrayBuffer());
  for (const b of bodyBytes) out.writeU8(b);

  // Final 64-byte alignment so SOT offsets stay ≤ file_size.
  out.padTo(ALIGN);

  return out.toArrayBuffer();
}
