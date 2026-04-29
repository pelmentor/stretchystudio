// v3 Phase 0F.31 - tests for src/io/live2d/cmo3/pngHelpers.js
//
// buildRawPng synthesizes a white RGBA PNG from scratch using
// uncompressed deflate blocks - a hand-rolled implementation
// because we can't use canvas.toBlob() in some code paths. The
// output goes into .cmo3 fallback textures; if it's malformed
// Cubism Editor refuses to open the file.
//
// Run: node scripts/test/test_pngHelpers.mjs

import { buildRawPng } from '../../src/io/live2d/cmo3/pngHelpers.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// PNG signature: 137 80 78 71 13 10 26 10
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readU32BE(buf, offset) {
  return (
    (buf[offset]     << 24 >>> 0) +
    (buf[offset + 1] << 16) +
    (buf[offset + 2] <<  8) +
    (buf[offset + 3])
  ) >>> 0;
}

// ── Signature + chunk structure ──────────────────────────────────

{
  const png = buildRawPng(2, 2);
  assert(png instanceof Uint8Array, 'buildRawPng: returns Uint8Array');
  for (let i = 0; i < 8; i++) {
    if (png[i] !== PNG_SIG[i]) {
      failed++; console.error(`FAIL: signature byte ${i}`); break;
    }
  }
  passed++;

  // First chunk after signature is IHDR (length=13, type='IHDR')
  const ihdrLen = readU32BE(png, 8);
  assert(ihdrLen === 13, 'IHDR: length 13');
  const ihdrType = String.fromCharCode(png[12], png[13], png[14], png[15]);
  assert(ihdrType === 'IHDR', 'IHDR: type tag');
}

// ── IHDR contains correct dimensions + format ────────────────────

{
  const png = buildRawPng(7, 11);
  // After signature (8) + chunk length (4) + chunk type (4) = offset 16
  const w = readU32BE(png, 16);
  const h = readU32BE(png, 20);
  assert(w === 7,  'IHDR: width');
  assert(h === 11, 'IHDR: height');

  // bit depth = 8, colour type = 6 (RGBA)
  assert(png[24] === 8, 'IHDR: bit depth = 8');
  assert(png[25] === 6, 'IHDR: colour type = 6 (RGBA)');
  assert(png[26] === 0, 'IHDR: compression = 0 (deflate)');
  assert(png[27] === 0, 'IHDR: filter = 0');
  assert(png[28] === 0, 'IHDR: interlace = 0');
}

// ── IEND is the last chunk (12 bytes: length+type+crc, no data) ──

{
  const png = buildRawPng(4, 4);
  // IEND signature: length=0, type='IEND', then CRC
  // It's the LAST 12 bytes of the buffer.
  const tailType = String.fromCharCode(
    png[png.length - 8], png[png.length - 7], png[png.length - 6], png[png.length - 5]
  );
  assert(tailType === 'IEND', 'IEND: trailing type');
  const tailLen = readU32BE(png, png.length - 12);
  assert(tailLen === 0, 'IEND: length 0');
}

// ── IDAT chunk present between IHDR and IEND ─────────────────────

{
  const png = buildRawPng(4, 4);
  // Walk chunks: signature (8) + IHDR (4 + 4 + 13 + 4 = 25 → offset 33)
  // IHDR chunk starts at offset 8, length payload 13, total chunk = 12 + 13 = 25
  let off = 8 + 25;  // after IHDR
  // Next chunk should be IDAT
  const idatLen = readU32BE(png, off);
  const idatType = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
  assert(idatType === 'IDAT', 'IDAT: type tag');
  assert(idatLen > 0, 'IDAT: non-empty');

  // Skip past IDAT to IEND
  off += 12 + idatLen;
  const iendType = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
  assert(iendType === 'IEND', 'IEND: follows IDAT');
}

// ── Different sizes produce different lengths ────────────────────

{
  const a = buildRawPng(1, 1);
  const b = buildRawPng(10, 10);
  const c = buildRawPng(100, 100);
  assert(a.length < b.length, 'size: 1x1 < 10x10');
  assert(b.length < c.length, 'size: 10x10 < 100x100');
}

// ── Round-trippable through a real PNG decoder check ─────────────
// We can't decode without canvas, but we CAN validate the deflate
// stream is structurally valid: zlib header should start with 0x78
// and a valid FLG (FCHECK passes when (CMF * 256 + FLG) % 31 == 0).

{
  const png = buildRawPng(4, 4);
  // Find IDAT data start
  let off = 8 + 25;  // after IHDR
  const idatLen = readU32BE(png, off);
  const dataStart = off + 8;  // skip length + type

  // First two bytes: zlib header
  const cmf = png[dataStart];
  const flg = png[dataStart + 1];
  assert(cmf === 0x78, 'IDAT: CMF = 0x78 (deflate, 32K window)');
  // FCHECK: (CMF*256 + FLG) % 31 === 0
  assert((cmf * 256 + flg) % 31 === 0, 'IDAT: zlib FCHECK passes');

  // Last 4 bytes of zlib stream are Adler-32
  // We just verify they're present (not all-zero would be vanishingly improbable for a non-empty payload)
  const adlerOff = dataStart + idatLen - 4;
  const adler = readU32BE(png, adlerOff);
  assert(adler !== 0, 'IDAT: Adler-32 non-zero');
}

// ── 1x1 edge case ────────────────────────────────────────────────

{
  const png = buildRawPng(1, 1);
  assert(png.length > 8 + 25 + 12 + 12,
    '1x1: at least signature + IHDR + IDAT + IEND in size');
  // IHDR width / height
  assert(readU32BE(png, 16) === 1, '1x1: width');
  assert(readU32BE(png, 20) === 1, '1x1: height');
}

console.log(`pngHelpers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
