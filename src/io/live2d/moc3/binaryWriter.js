// @ts-check

/**
 * Little-endian binary writer for the .moc3 generator.
 *
 * Lifted out of moc3writer.js (Phase 6 god-class breakup, sweep #34).
 *
 * Buffer-of-bytes append model — `_buf` is a regular JS array of byte
 * values (0..255). Multi-byte primitives go through DataView so endianness
 * is consistent regardless of host platform. Strings are written with a
 * fixed null-padded byte width (default 64 — `STRING_FIELD_SIZE`) and
 * raise on overflow.
 *
 * `writeRuntime(count)` emits `count * RUNTIME_UNIT_SIZE` zero bytes —
 * matches Cubism's runtime_space sections that hold zeroed slots the SDK
 * fills in at load time.
 *
 * @module io/live2d/moc3/binaryWriter
 */

import { RUNTIME_UNIT_SIZE, STRING_FIELD_SIZE } from './layout.js';

export class BinaryWriter {
  constructor() {
    /** @type {number[]} */
    this._buf = [];
  }

  get pos() { return this._buf.length; }

  writeU8(v)  { this._buf.push(v & 0xFF); }
  writeI16(v) { const b = new ArrayBuffer(2); new DataView(b).setInt16(0, v, true); this._pushBytes(b); }
  writeI32(v) { const b = new ArrayBuffer(4); new DataView(b).setInt32(0, v, true); this._pushBytes(b); }
  writeU32(v) { const b = new ArrayBuffer(4); new DataView(b).setUint32(0, v, true); this._pushBytes(b); }
  writeF32(v) { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v, true); this._pushBytes(b); }

  writeI32Array(vals)  { for (const v of vals) this.writeI32(v); }
  writeU32Array(vals)  { for (const v of vals) this.writeU32(v); }
  writeF32Array(vals)  { for (const v of vals) this.writeF32(v); }
  writeI16Array(vals)  { for (const v of vals) this.writeI16(v); }
  writeU8Array(vals)   { for (const v of vals) this.writeU8(v); }
  writeBoolArray(vals) { for (const v of vals) this.writeI32(v ? 1 : 0); }

  writeString(s, fieldSize = STRING_FIELD_SIZE) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(s);
    if (encoded.length >= fieldSize) {
      throw new Error(`String "${s}" too long for ${fieldSize}-byte field`);
    }
    for (const byte of encoded) this._buf.push(byte);
    // Null-pad to fieldSize
    for (let i = encoded.length; i < fieldSize; i++) this._buf.push(0);
  }

  writeStringArray(vals) { for (const s of vals) this.writeString(s); }

  writeRuntime(count) {
    // Runtime space: zeroed bytes
    this.fill(count * RUNTIME_UNIT_SIZE);
  }

  fill(count, value = 0) {
    for (let i = 0; i < count; i++) this._buf.push(value);
  }

  padTo(alignment) {
    const rem = this._buf.length % alignment;
    if (rem !== 0) this.fill(alignment - rem);
  }

  /** Patch a uint32 value at a previously known position. */
  patchU32(offset, value) {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, value, true);
    const bytes = new Uint8Array(b);
    for (let i = 0; i < 4; i++) this._buf[offset + i] = bytes[i];
  }

  toArrayBuffer() {
    return new Uint8Array(this._buf).buffer;
  }

  _pushBytes(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    for (const b of bytes) this._buf.push(b);
  }
}
