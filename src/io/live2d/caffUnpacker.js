// @ts-check
/**
 * CAFF (Cubism Archive File Format) unpacker.
 *
 * Inverse of `caffPacker.js`. Reads a `.cmo3` / `.can3` byte buffer and
 * returns the embedded files (`main.xml` + PNG textures) so a downstream
 * importer can reconstruct an SS project.
 *
 * Binary layout from the packer (all multi-byte ints big-endian, XOR
 * obfuscation at integer level — the obfuscate key is read in clear):
 *
 *   Header   16 bytes:  "CAFF" + 0x00,0x00,0x00 + "----" + 0x00,0x00,0x00
 *                       + int32 obfuscateKey (CLEAR) + 8 bytes reserved
 *   Preview  24 bytes:  type1, type2, 2x skip, int16 w, int16 h,
 *                       int64 startPos, int32 fileSize, 8 bytes reserved
 *                       (when type1 == 127 the rest is zero — no preview)
 *   Table    int32 fileCount (XOR'd) followed by per-file:
 *                       string path, string tag, int64 startPos, int32 len,
 *                       bool obfuscated, byte compress, 8 bytes reserved
 *                       (every field XOR'd with `key`)
 *   Bodies   raw bytes at each entry's startPos, optionally XOR'd with the
 *            low byte of `key`, optionally a single-entry "contents" ZIP
 *   Guard    2 bytes: 0x62 0x63
 *
 * The variable-length integer encoding terminates on the first byte whose
 * high bit is clear (mirrors `writeNumber` in `caffPacker.js`).
 *
 * @module io/live2d/caffUnpacker
 */

const NO_PREVIEW = 127;
export const COMPRESS_RAW = 16;
export const COMPRESS_FAST = 33;

/**
 * @typedef {Object} CaffFile
 * @property {string} path
 * @property {string} tag
 * @property {Uint8Array} content   raw, decompressed, de-obfuscated
 * @property {number} compress      raw compress code (16 / 33)
 * @property {boolean} obfuscated   whether the bytes on disk were XOR'd
 */

/**
 * @typedef {Object} CaffArchive
 * @property {number} obfuscateKey
 * @property {CaffFile[]} files
 */

/**
 * Mirror of `caffPacker.createInt64Mask` so int64 XOR symmetry holds.
 * @param {number} key
 */
function createInt64Mask(key) {
  const lower = BigInt(key) & 0xFFFFFFFFn;
  const upper = key < 0 ? 0xFFFFFFFFn : (BigInt(key) & 0xFFFFFFFFn);
  return ((upper << 32n) | lower) & 0xFFFFFFFFFFFFFFFFn;
}

class CaffReader {
  /** @param {Uint8Array} buf */
  constructor(buf) {
    this._buf = buf;
    this._dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this._pos = 0;
  }

  get position() { return this._pos; }
  get length() { return this._buf.byteLength; }

  /** @param {number} pos */
  seek(pos) { this._pos = pos; }

  /** @param {number} count */
  skip(count) { this._pos += count; }

  /** @param {number} [key] */
  readByte(key = 0) {
    const b = this._buf[this._pos];
    this._pos += 1;
    return (b ^ (key & 0xFF)) & 0xFF;
  }

  /** @param {number} [key] */
  readInt16(key = 0) {
    const v = this._dv.getUint16(this._pos, false);
    this._pos += 2;
    return (v ^ (key & 0xFFFF)) & 0xFFFF;
  }

  /** @param {number} [key] */
  readInt32(key = 0) {
    const v = this._dv.getUint32(this._pos, false);
    this._pos += 4;
    return ((v ^ (key >>> 0)) >>> 0);
  }

  /** @param {number} [key] */
  readInt64(key = 0) {
    const v = this._dv.getBigUint64(this._pos, false);
    this._pos += 8;
    const mask = createInt64Mask(key);
    return Number((v ^ mask) & 0xFFFFFFFFFFFFFFFFn);
  }

  /** @param {number} [key] */
  readBool(key = 0) {
    return this.readByte(key) !== 0;
  }

  /** @param {number} length @param {number} [key] */
  readBytes(length, key = 0) {
    const out = new Uint8Array(length);
    if ((key & 0xFF) === 0) {
      out.set(this._buf.subarray(this._pos, this._pos + length));
    } else {
      const k = key & 0xFF;
      for (let i = 0; i < length; i++) {
        out[i] = (this._buf[this._pos + i] ^ k) & 0xFF;
      }
    }
    this._pos += length;
    return out;
  }

  /**
   * Variable-length integer. Inverse of `writeNumber`: gather bytes whose
   * high bit is set, terminate on the first byte whose high bit is clear,
   * combine as MSB-first 7-bit groups.
   *
   * @param {number} [key]
   */
  readNumber(key = 0) {
    let value = 0;
    let safety = 0;
    while (safety < 8) {
      const b = this.readByte(key);
      value = (value << 7) | (b & 0x7F);
      if ((b & 0x80) === 0) return value >>> 0;
      safety++;
    }
    throw new Error('caffUnpacker: variable-length integer too long');
  }

  /** @param {number} [key] */
  readString(key = 0) {
    const len = this.readNumber(key);
    const bytes = this.readBytes(len, key);
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Inflate a single-entry "contents" ZIP archive (matches `compressZip` in
 * the packer). Returns the decompressed bytes; throws if no entry named
 * "contents" is found.
 *
 * @param {Uint8Array} archive
 * @returns {Promise<Uint8Array>}
 */
async function inflateContentsZip(archive) {
  const dv = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  // Local file header
  if (dv.getUint32(0, true) !== 0x04034b50) {
    throw new Error('caffUnpacker: ZIP local header signature missing');
  }
  const flags = dv.getUint16(6, true);
  const method = dv.getUint16(8, true);
  const compressedSize = dv.getUint32(18, true);
  const uncompressedSize = dv.getUint32(22, true);
  const filenameLen = dv.getUint16(26, true);
  const extraLen = dv.getUint16(28, true);
  const dataOffset = 30 + filenameLen + extraLen;

  if (compressedSize === 0 && uncompressedSize === 0 && (flags & 0x08) === 0) {
    return new Uint8Array(0);
  }

  // Cubism Editor's exports stream the deflate stream and write a 16-byte
  // data descriptor at the end (signature 0x08074b50 + crc + compSize +
  // uncompSize) instead of populating the local header sizes. Detect that
  // case via the GP-flag bit-3 + zero compressedSize, and slice the
  // compressed payload up to the descriptor sig — never up to a phantom
  // EOCD that wasn't written. SS exports (caffPacker.compressZip) take the
  // standard branch.
  let compressed;
  if ((flags & 0x08) !== 0 && compressedSize === 0) {
    const tail = archive.length - 16;
    if (tail >= dataOffset && dv.getUint32(tail, true) === 0x08074b50) {
      compressed = archive.subarray(dataOffset, tail);
    } else {
      compressed = archive.subarray(dataOffset);
    }
  } else {
    compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
  }
  if (method === 0) {
    return new Uint8Array(compressed);
  }
  if (method !== 8) {
    throw new Error(`caffUnpacker: unsupported ZIP method ${method}`);
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('caffUnpacker: DecompressionStream unavailable in this environment');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  // Copy into an owned ArrayBuffer-backed Uint8Array. The subarray view's
  // buffer type is `ArrayBufferLike` per TS lib.dom, which DecompressionStream
  // refuses to accept; the slice makes the cast unnecessary.
  writer.write(compressed.slice());
  writer.close();
  /** @type {Uint8Array[]} */
  const chunks = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Parse a CAFF archive from raw bytes.
 *
 * @param {Uint8Array | ArrayBuffer} buf
 * @returns {Promise<CaffArchive>}
 */
export async function unpackCaff(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const r = new CaffReader(u8);

  // Header
  const magic = String.fromCharCode(r.readByte(), r.readByte(), r.readByte(), r.readByte());
  if (magic !== 'CAFF') {
    throw new Error(`caffUnpacker: bad magic ${JSON.stringify(magic)} (expected "CAFF")`);
  }
  r.skip(3); // archive version
  const fmt = String.fromCharCode(r.readByte(), r.readByte(), r.readByte(), r.readByte());
  if (fmt !== '----') {
    throw new Error(`caffUnpacker: unexpected format identifier ${JSON.stringify(fmt)}`);
  }
  r.skip(3); // format version
  const key = r.readInt32(0); // obfuscate key — written in clear
  r.skip(8); // reserved

  // Preview image (skip; SS exports always set NO_PREVIEW)
  const previewType = r.readByte(0);
  r.skip(1); // type2
  r.skip(2); // padding
  r.readInt16(0); // w
  r.readInt16(0); // h
  r.readInt64(0); // startPos
  r.readInt32(0); // fileSize
  r.skip(8); // reserved
  if (previewType !== NO_PREVIEW) {
    // Preview body would sit at the saved startPos. We don't need it for
    // import — the file table that follows is independent of the preview
    // payload, and the bodies it points to live past any preview blob.
  }

  // File table
  const fileCount = r.readInt32(key);
  if (!Number.isFinite(fileCount) || fileCount < 0 || fileCount > 1_000_000) {
    throw new Error(`caffUnpacker: implausible file count ${fileCount} — wrong key?`);
  }

  /** @type {{path:string, tag:string, startPos:number, storedLen:number, obfuscated:boolean, compress:number}[]} */
  const entries = [];
  for (let i = 0; i < fileCount; i++) {
    const path = r.readString(key);
    const tag = r.readString(key);
    const startPos = r.readInt64(key);
    const storedLen = r.readInt32(key);
    const obfuscated = r.readBool(key);
    const compress = r.readByte(key);
    r.skip(8);
    entries.push({ path, tag, startPos, storedLen, obfuscated, compress });
  }

  // File bodies — random-access via startPos.
  /** @type {CaffFile[]} */
  const files = [];
  for (const e of entries) {
    r.seek(e.startPos);
    const ekey = e.obfuscated ? key : 0;
    const stored = r.readBytes(e.storedLen, ekey);
    let content;
    if (e.compress === COMPRESS_RAW) {
      content = stored;
    } else if (e.compress === COMPRESS_FAST) {
      content = await inflateContentsZip(stored);
    } else {
      throw new Error(`caffUnpacker: unsupported compress code ${e.compress} for ${e.path}`);
    }
    files.push({
      path: e.path,
      tag: e.tag,
      content,
      compress: e.compress,
      obfuscated: e.obfuscated,
    });
  }

  return { obfuscateKey: key, files };
}
