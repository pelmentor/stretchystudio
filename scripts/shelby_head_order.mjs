// Decode shelby_smile.cmo3, find head part, list _childGuids in order with mesh names.
import { readFileSync } from 'node:fs';
import { inflateRawSync, createInflateRaw } from 'node:zlib';

const cmo3Path = process.argv[2] || 'shelby_smile.cmo3';
const buf = Uint8Array.from(readFileSync(cmo3Path));
const td = new TextDecoder();
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const obfKey = dv.getInt32(14, false);

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

let pos = 26 + 2 + 2 + 2 + 2 + 8 + 4 + 8;
const fileCount = dv.getInt32(pos, false) ^ obfKey;
pos += 4;
const fileEntries = [];
for (let i = 0; i < fileCount; i++) {
  const { str: filePath, pos: p2 } = readStr(buf, pos, obfKey & 0xFF); pos = p2;
  const { str: tag, pos: p3 } = readStr(buf, pos, obfKey & 0xFF); pos = p3;
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
  pos += 1 + 8;
  fileEntries.push({ path: filePath, tag, startPos, fileLen, obfuscated, compress });
}
const mainEntry = fileEntries.find(e => e.path === 'main.xml');
let mainBytes = buf.slice(mainEntry.startPos, mainEntry.startPos + mainEntry.fileLen);
if (mainEntry.obfuscated) {
  const k = obfKey & 0xFF;
  const out = new Uint8Array(mainBytes.length);
  for (let i = 0; i < mainBytes.length; i++) out[i] = mainBytes[i] ^ k;
  mainBytes = out;
}
let xml;
if (mainEntry.compress === 16) {
  xml = td.decode(mainBytes);
} else {
  const zdv = new DataView(mainBytes.buffer, mainBytes.byteOffset, mainBytes.byteLength);
  const method = zdv.getUint16(8, true);
  const flags = zdv.getUint16(6, true);
  const compSize = zdv.getUint32(18, true);
  const fnLen = zdv.getUint16(26, true);
  const extraLen = zdv.getUint16(28, true);
  const contentStart = 30 + fnLen + extraLen;
  let compContent;
  if ((flags & 0x08) && compSize === 0) {
    const descOff = mainBytes.length - 16;
    compContent = mainBytes.slice(contentStart, descOff);
  } else {
    compContent = mainBytes.slice(contentStart, contentStart + compSize);
  }
  const chunks = [];
  const inflate = createInflateRaw();
  await new Promise((resolve) => {
    inflate.on('data', c => chunks.push(c));
    inflate.on('end', resolve);
    inflate.on('error', resolve);
    inflate.end(compContent);
  });
  xml = td.decode(Buffer.concat(chunks));
}

// Build drawable GUID pid → localName map (from CArtMeshSource blocks)
const drawableToName = new Map();
const meshBlocks = Array.from(xml.matchAll(/<CArtMeshSource xs\.id="(#\d+)"[\s\S]*?<\/CArtMeshSource>/g));
for (const [block, pid] of meshBlocks) {
  const nameM = block.match(/<s xs\.n="localName">([^<]*)<\/s>/);
  // Look for DrawableGuid that references this pid as _source
  // (drawable guids are emitted separately; find CDrawableGuid whose target is this meshSource)
  // Actually the drawable guid is in ACDrawableSource; look up its pid
  const guidM = block.match(/<CDrawableGuid xs\.n="guid" xs\.ref="(#\d+)"/);
  if (nameM && guidM) drawableToName.set(guidM[1], nameM[1]);
}

// Also build drawable GUID pid → uuid note (from <CDrawableGuid uuid=... note=... xs.id=...>)
const drawGuidDecls = Array.from(xml.matchAll(/<CDrawableGuid uuid="[^"]+" note="([^"]+)" xs\.id="(#\d+)"/g));
const drawPidToNote = new Map();
for (const [, note, pid] of drawGuidDecls) drawPidToNote.set(pid, note);

// Find all CPartSource blocks, for each get localName + _childGuids list
const partBlocks = Array.from(xml.matchAll(/<CPartSource xs\.id="(#\d+)"[\s\S]*?<\/CPartSource>/g));
for (const [block] of partBlocks) {
  const nameM = block.match(/<s xs\.n="localName">([^<]*)<\/s>/);
  const childGuidsM = block.match(/<carray_list xs\.n="_childGuids" count="(\d+)">([\s\S]*?)<\/carray_list>/);
  if (!nameM || !childGuidsM) continue;
  const partName = nameM[1];
  const count = parseInt(childGuidsM[1], 10);
  if (count < 2) continue; // skip tiny parts
  console.log(`\n=== Part "${partName}" _childGuids (${count}) ===`);
  const refs = Array.from(childGuidsM[2].matchAll(/xs\.ref="(#\d+)"/g)).map(m => m[1]);
  refs.forEach((r, i) => {
    const name = drawableToName.get(r) || drawPidToNote.get(r) || '(no name for ' + r + ')';
    console.log(String(i).padStart(2), r, '→', name);
  });
}
