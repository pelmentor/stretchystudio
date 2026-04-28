// Inspect an existing .cmo3's main.xml.
// Usage: node scripts/inspect_cmo3.mjs <path-to-cmo3> [searchPattern]
//
// Reads the CAFF, finds main.xml (zip-compressed, XOR-obfuscated), unpacks,
// optionally greps for a pattern. Use to verify what emitted in a deployed export.

import { readFileSync } from 'node:fs';
import { inflateRawSync, createInflateRaw } from 'node:zlib';

const [, , path, pattern] = process.argv;
if (!path) {
  console.error('usage: node scripts/inspect_cmo3.mjs <cmo3> [pattern]');
  process.exit(1);
}

const buf = Uint8Array.from(readFileSync(path));
const td = new TextDecoder();

// CAFF header
if (td.decode(buf.slice(0, 4)) !== 'CAFF') {
  console.error('not a CAFF file');
  process.exit(2);
}

// Parse obfuscate key (int32 BE at offset 16; header: "CAFF" + 3b + "----" + 3b = 14, then 2 reserved = 16)
// Actually: "CAFF" (4) + archVer (3) + "----" (4) + fmtVer (3) = 14, then obfKey (4) = 18, reserved (8) = 26
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const obfKey = dv.getInt32(14, false);

// Read var-number helper (inverse of caffPacker.writeNumber)
function readVarNumber(u8, pos, xor) {
  let val = 0;
  while (true) {
    const b = u8[pos++] ^ xor;
    val = (val << 7) | (b & 0x7F);
    if ((b & 0x80) === 0) break;
  }
  return { val, pos };
}

function readStr(u8, pos, xor) {
  const { val: len, pos: pos2 } = readVarNumber(u8, pos, xor);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = u8[pos2 + i] ^ xor;
  return { str: td.decode(bytes), pos: pos2 + len };
}

// Skip preview block: after header+reserved (pos 26) comes NO_PREVIEW bytes + skipped 24 bytes
// Easier: follow the packer code exactly — header 26, preview 24, files count int32 (XOR), etc.
let pos = 26;          // after CAFF header + reserved
pos += 2;               // NO_PREVIEW bytes (2)
pos += 2;               // skip 2
pos += 2;               // int16 (0)
pos += 2;               // int16 (0)
pos += 8;               // int64 start (0)
pos += 4;               // int32 size (0)
pos += 8;               // reserved 8

// File table
const fileCount = dv.getInt32(pos, false) ^ obfKey;
pos += 4;

const fileEntries = [];
for (let i = 0; i < fileCount; i++) {
  const { str: filePath, pos: p2 } = readStr(buf, pos, obfKey & 0xFF);
  pos = p2;
  const { str: tag, pos: p3 } = readStr(buf, pos, obfKey & 0xFF);
  pos = p3;
  // int64 startPos (XOR'd with mask) — see caffPacker.createInt64Mask:
  // for negative int32 keys the upper 32 bits are all 1s, not the low word
  // sign-extended by hand. Without this fix the Hiyori reference (negative
  // obfKey) decodes to garbage startPos values → zero-length slices.
  const maskLow = BigInt(obfKey) & 0xFFFFFFFFn;
  const maskHi = obfKey < 0 ? 0xFFFFFFFFn : (BigInt(obfKey) & 0xFFFFFFFFn);
  const mask = (maskHi << 32n) | maskLow;
  const rawStart = dv.getBigUint64(pos, false);
  const startPos = Number((rawStart ^ mask) & 0xFFFFFFFFFFFFFFFFn);
  pos += 8;
  const fileLen = dv.getInt32(pos, false) ^ obfKey;
  pos += 4;
  const obfuscated = !!(dv.getUint8(pos) ^ (obfKey & 0xFF));
  pos += 1;
  const compress = dv.getUint8(pos) ^ (obfKey & 0xFF);
  pos += 1;
  pos += 8;  // reserved
  fileEntries.push({ path: filePath, tag, startPos, fileLen, obfuscated, compress });
}

const mainEntry = fileEntries.find(e => e.path === 'main.xml');
if (!mainEntry) {
  console.error('main.xml entry not in file table');
  process.exit(3);
}
console.log('[inspect]', fileCount, 'files in CAFF. main.xml: compress=' + mainEntry.compress + ', obf=' + mainEntry.obfuscated + ', len=' + mainEntry.fileLen);

// Read file data
let mainBytes = buf.slice(mainEntry.startPos, mainEntry.startPos + mainEntry.fileLen);
if (mainEntry.obfuscated) {
  const k = obfKey & 0xFF;
  const out = new Uint8Array(mainBytes.length);
  for (let i = 0; i < mainBytes.length; i++) out[i] = mainBytes[i] ^ k;
  mainBytes = out;
}

// compress == 16 RAW, 33 FAST (zip with deflate-raw), 37 SMALL (zip)
let xml;
if (mainEntry.compress === 16) {
  xml = td.decode(mainBytes);
} else {
  // ZIP: local header signature = 0x04034b50.
  // Our packer writes a complete ZIP (local header + content + central dir + EOCD)
  // with compSize set in the local header. Cubism Editor uses a streaming variant:
  // local header has compSize=0, data descriptor follows the compressed stream,
  // and there's no central directory / EOCD inside this CAFF entry. Handle both.
  const zdv = new DataView(mainBytes.buffer, mainBytes.byteOffset, mainBytes.byteLength);
  const sig = zdv.getUint32(0, true);
  if (sig !== 0x04034b50) {
    console.error('not a ZIP entry, sig=0x' + sig.toString(16));
    process.exit(4);
  }
  const method = zdv.getUint16(8, true);
  const flags = zdv.getUint16(6, true);
  const compSize = zdv.getUint32(18, true);
  const fnLen = zdv.getUint16(26, true);
  const extraLen = zdv.getUint16(28, true);
  const contentStart = 30 + fnLen + extraLen;
  let compContent;
  if ((flags & 0x08) && compSize === 0) {
    // Data descriptor follows the stream (last 16 bytes: sig + crc + compSize + uncompSize).
    // Trust the descriptor's compSize — but if it disagrees with the physical bounds,
    // fall back to streaming inflate over everything between contentStart and descriptor.
    const descOff = mainBytes.length - 16;
    const descSig = zdv.getUint32(descOff, true);
    if (descSig === 0x08074b50) {
      compContent = mainBytes.slice(contentStart, descOff);
    } else {
      compContent = mainBytes.slice(contentStart);
    }
  } else {
    compContent = mainBytes.slice(contentStart, contentStart + compSize);
  }
  if (method !== 8 && method !== 0) {
    console.error('unknown zip method', method); process.exit(5);
  }
  if (method === 0) {
    xml = td.decode(compContent);
  } else {
    // Stream inflate — tolerates a descriptor at the end of the stream.
    const chunks = [];
    const inflate = createInflateRaw();
    await new Promise((resolve) => {
      inflate.on('data', c => chunks.push(c));
      inflate.on('end', resolve);
      inflate.on('error', resolve);
      inflate.end(compContent);
    });
    const total = Buffer.concat(chunks);
    xml = td.decode(total);
  }
}

console.log('[inspect] main.xml size:', xml.length, 'bytes');

if (pattern) {
  const re = new RegExp(pattern, 'g');
  let m; let count = 0;
  while ((m = re.exec(xml)) !== null) {
    const ctx = xml.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\n/g, ' ');
    console.log(` [${m.index}] …${ctx}…`);
    count++;
    if (count >= 40) { console.log(' … (truncated at 40 matches)'); break; }
  }
  console.log('[inspect]', count, 'match(es) for pattern');
} else {
  console.log(xml.slice(0, 2000));
  console.log('---');
  console.log(xml.slice(-1500));
}
