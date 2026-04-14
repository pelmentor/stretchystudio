/**
 * CAFF (Cubism Archive File Format) packer.
 *
 * Creates .cmo3 files from main.xml + PNG blobs.
 * Binary layout from D2Evil RE + Java decompile of Cubism Editor 5.0.
 *
 * All multi-byte integers are BIG-ENDIAN.
 * XOR obfuscation at integer level (not byte level).
 *
 * @module io/live2d/caffPacker
 */

// Compression options
export const COMPRESS_RAW = 16;
export const COMPRESS_FAST = 33;
// export const COMPRESS_SMALL = 37;  // unused for now

const NO_PREVIEW = 127;

/**
 * Expand int32 key to int64 mask (from CaffBinaryPrimitives).
 * @param {number} key
 * @returns {bigint}
 */
function createInt64Mask(key) {
  const lower = BigInt(key) & 0xFFFFFFFFn;
  const upper = key < 0 ? 0xFFFFFFFFn : (BigInt(key) & 0xFFFFFFFFn);
  return ((upper << 32n) | lower) & 0xFFFFFFFFFFFFFFFFn;
}

class CaffWriter {
  constructor() {
    this._chunks = [];
    this._pos = 0;
    // For patching: we'll build a flat buffer at the end
    this._patches = []; // {offset, bytes}
  }

  get position() { return this._pos; }

  writeByte(value, key = 0) {
    const b = (value ^ key) & 0xFF;
    this._chunks.push(new Uint8Array([b]));
    this._pos += 1;
  }

  writeInt16(value, key = 0) {
    const encoded = (value ^ key) & 0xFFFF;
    const buf = new DataView(new ArrayBuffer(2));
    buf.setUint16(0, encoded, false); // big-endian
    this._chunks.push(new Uint8Array(buf.buffer));
    this._pos += 2;
  }

  writeInt32(value, key = 0) {
    const encoded = (value ^ key) & 0xFFFFFFFF;
    const buf = new DataView(new ArrayBuffer(4));
    buf.setUint32(0, encoded >>> 0, false);
    this._chunks.push(new Uint8Array(buf.buffer));
    this._pos += 4;
  }

  writeInt64(value, key = 0) {
    const mask = createInt64Mask(key);
    const val = BigInt(value) & 0xFFFFFFFFFFFFFFFFn;
    const encoded = (val ^ mask) & 0xFFFFFFFFFFFFFFFFn;
    const buf = new DataView(new ArrayBuffer(8));
    buf.setBigUint64(0, encoded, false);
    this._chunks.push(new Uint8Array(buf.buffer));
    this._pos += 8;
  }

  writeBool(value, key = 0) {
    this.writeByte(value ? 1 : 0, key);
  }

  writeBytes(data, key = 0) {
    const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (key === 0) {
      this._chunks.push(arr.slice());
    } else {
      const k = key & 0xFF;
      const out = new Uint8Array(arr.length);
      for (let i = 0; i < arr.length; i++) out[i] = (arr[i] ^ k) & 0xFF;
      this._chunks.push(out);
    }
    this._pos += arr.length;
  }

  /** Variable-length integer (1-4 bytes). */
  writeNumber(value, key = 0) {
    if (value < 128) {
      this.writeByte(value, key);
    } else if (value < 16384) {
      this.writeByte(((value >> 7) & 127) | 128, key);
      this.writeByte(value & 127, key);
    } else if (value < 2097152) {
      this.writeByte(((value >> 14) & 127) | 128, key);
      this.writeByte(((value >> 7) & 127) | 128, key);
      this.writeByte(value & 127, key);
    } else {
      this.writeByte(((value >> 21) & 127) | 128, key);
      this.writeByte(((value >> 14) & 127) | 128, key);
      this.writeByte(((value >> 7) & 127) | 128, key);
      this.writeByte(value & 127, key);
    }
  }

  writeString(value, key = 0) {
    const encoded = new TextEncoder().encode(value);
    this.writeNumber(encoded.length, key);
    this.writeBytes(encoded, key);
  }

  skip(count) {
    this._chunks.push(new Uint8Array(count)); // zero-filled
    this._pos += count;
  }

  /** Schedule a patch: overwrite bytes at `offset` in the final buffer. */
  schedulePatch(offset, bytes) {
    this._patches.push({ offset, bytes });
  }

  /** Flatten all chunks into a single Uint8Array, then apply patches. */
  getBytes() {
    const total = this._pos;
    const result = new Uint8Array(total);
    let off = 0;
    for (const chunk of this._chunks) {
      result.set(chunk, off);
      off += chunk.length;
    }
    for (const p of this._patches) {
      result.set(p.bytes, p.offset);
    }
    return result;
  }
}

/**
 * Compress content as ZIP archive with single entry 'contents'.
 * Uses the browser's CompressionStream API via a simple deflate approach.
 * Falls back to storing uncompressed if CompressionStream unavailable.
 *
 * @param {Uint8Array} content
 * @returns {Promise<Uint8Array>}
 */
async function compressZip(content) {
  // Build a minimal ZIP file with one entry named "contents"
  // using DeflateRaw via CompressionStream
  const fileName = new TextEncoder().encode('contents');

  let compressed;
  let method = 0; // 0=stored, 8=deflated
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    const chunks = [];
    writer.write(content);
    writer.close();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    compressed = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) { compressed.set(c, off); off += c.length; }
    method = 8;
  } else {
    compressed = content;
    method = 0;
  }

  // CRC-32
  const crc = crc32(content);

  // Build ZIP structures
  const localHeaderSize = 30 + fileName.length;
  const centralHeaderSize = 46 + fileName.length;
  const dataOffset = localHeaderSize;
  const centralDirOffset = dataOffset + compressed.length;
  const endOfCentralDirSize = 22;
  const totalSize = centralDirOffset + centralHeaderSize + endOfCentralDirSize;

  const buf = new ArrayBuffer(totalSize);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let pos = 0;

  // Local file header
  dv.setUint32(pos, 0x04034b50, true); pos += 4; // signature
  dv.setUint16(pos, 20, true); pos += 2; // version needed
  dv.setUint16(pos, 0, true); pos += 2;  // flags
  dv.setUint16(pos, method, true); pos += 2; // compression method
  dv.setUint16(pos, 0, true); pos += 2;  // mod time
  dv.setUint16(pos, 0, true); pos += 2;  // mod date
  dv.setUint32(pos, crc >>> 0, true); pos += 4; // crc32
  dv.setUint32(pos, compressed.length, true); pos += 4; // compressed size
  dv.setUint32(pos, content.length, true); pos += 4;    // uncompressed size
  dv.setUint16(pos, fileName.length, true); pos += 2;   // filename length
  dv.setUint16(pos, 0, true); pos += 2;  // extra field length
  u8.set(fileName, pos); pos += fileName.length;

  // File data
  u8.set(compressed, pos); pos += compressed.length;

  // Central directory header
  dv.setUint32(pos, 0x02014b50, true); pos += 4;
  dv.setUint16(pos, 20, true); pos += 2; // version made by
  dv.setUint16(pos, 20, true); pos += 2; // version needed
  dv.setUint16(pos, 0, true); pos += 2;  // flags
  dv.setUint16(pos, method, true); pos += 2;
  dv.setUint16(pos, 0, true); pos += 2;  // mod time
  dv.setUint16(pos, 0, true); pos += 2;  // mod date
  dv.setUint32(pos, crc >>> 0, true); pos += 4;
  dv.setUint32(pos, compressed.length, true); pos += 4;
  dv.setUint32(pos, content.length, true); pos += 4;
  dv.setUint16(pos, fileName.length, true); pos += 2;
  dv.setUint16(pos, 0, true); pos += 2;  // extra field length
  dv.setUint16(pos, 0, true); pos += 2;  // file comment length
  dv.setUint16(pos, 0, true); pos += 2;  // disk number start
  dv.setUint16(pos, 0, true); pos += 2;  // internal file attrs
  dv.setUint32(pos, 0, true); pos += 4;  // external file attrs
  dv.setUint32(pos, 0, true); pos += 4;  // local header offset
  u8.set(fileName, pos); pos += fileName.length;

  // End of central directory
  dv.setUint32(pos, 0x06054b50, true); pos += 4;
  dv.setUint16(pos, 0, true); pos += 2;  // disk number
  dv.setUint16(pos, 0, true); pos += 2;  // disk with central dir
  dv.setUint16(pos, 1, true); pos += 2;  // entries on disk
  dv.setUint16(pos, 1, true); pos += 2;  // total entries
  dv.setUint32(pos, centralHeaderSize, true); pos += 4; // central dir size
  dv.setUint32(pos, centralDirOffset, true); pos += 4;  // central dir offset
  dv.setUint16(pos, 0, true); pos += 2;  // comment length

  return new Uint8Array(buf);
}

/** CRC-32 (same table as zlib). */
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Pack files into a CAFF archive.
 *
 * @param {Array<{path: string, content: Uint8Array, tag?: string, obfuscated?: boolean, compress?: number}>} files
 * @param {number} [obfuscateKey=42]
 * @returns {Promise<Uint8Array>} Complete CAFF archive
 */
export async function packCaff(files, obfuscateKey = 42) {
  const w = new CaffWriter();
  const key = obfuscateKey;

  // === Header ===
  for (const c of 'CAFF') w.writeByte(c.charCodeAt(0), 0);
  // Archive version
  w.writeByte(0, 0); w.writeByte(0, 0); w.writeByte(0, 0);
  // Format identifier
  for (const c of '----') w.writeByte(c.charCodeAt(0), 0);
  // Format version
  w.writeByte(0, 0); w.writeByte(0, 0); w.writeByte(0, 0);
  // Obfuscate key
  w.writeInt32(key, 0);
  // Reserved
  w.skip(8);

  // === Preview image (none) ===
  w.writeByte(NO_PREVIEW, 0);
  w.writeByte(NO_PREVIEW, 0);
  w.skip(2);
  w.writeInt16(0, 0);
  w.writeInt16(0, 0);
  w.writeInt64(0, 0);  // StartPosition
  w.writeInt32(0, 0);  // FileSize
  w.skip(8);

  // === File table ===
  w.writeInt32(files.length, key);

  // Prepare entries
  const entries = [];
  for (const f of files) {
    const content = f.content instanceof Uint8Array ? f.content : new Uint8Array(f.content);
    const compress = f.compress ?? COMPRESS_RAW;
    const obfuscated = f.obfuscated ?? true;

    let stored;
    if (compress === COMPRESS_RAW) {
      stored = content;
    } else {
      stored = await compressZip(content);
    }

    entries.push({
      path: f.path,
      tag: f.tag ?? '',
      stored,
      obfuscated,
      compress,
      startPosAddr: 0,
      startPos: 0,
    });
  }

  // Write file table entries
  for (const entry of entries) {
    w.writeString(entry.path, key);
    w.writeString(entry.tag, key);
    entry.startPosAddr = w.position;
    w.writeInt64(0, key); // placeholder — will patch
    w.writeInt32(entry.stored.length, key);
    w.writeBool(entry.obfuscated, key);
    w.writeByte(entry.compress, key);
    w.skip(8);
  }

  // === File data ===
  for (const entry of entries) {
    entry.startPos = w.position;
    const ekey = entry.obfuscated ? key : 0;
    w.writeBytes(entry.stored, ekey);
  }

  // === Guard bytes ===
  w.writeByte(98, 0);
  w.writeByte(99, 0);

  // === Patch start positions ===
  for (const entry of entries) {
    // Rebuild the int64 write at the saved address
    const mask = createInt64Mask(key);
    const val = BigInt(entry.startPos) & 0xFFFFFFFFFFFFFFFFn;
    const encoded = (val ^ mask) & 0xFFFFFFFFFFFFFFFFn;
    const patchBuf = new DataView(new ArrayBuffer(8));
    patchBuf.setBigUint64(0, encoded, false);
    w.schedulePatch(entry.startPosAddr, new Uint8Array(patchBuf.buffer));
  }

  return w.getBytes();
}
