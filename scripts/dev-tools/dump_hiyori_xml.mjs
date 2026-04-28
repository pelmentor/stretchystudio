// One-shot: dump full Hiyori main.xml to stdout.
import { readFileSync } from 'node:fs';
import { createInflateRaw } from 'node:zlib';

const path = process.argv[2] || 'reference/live2d-sample/Hiyori/hiyori_pro_t11.cmo3';
const buf = Uint8Array.from(readFileSync(path));
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
const fileCount = dv.getInt32(pos, false) ^ obfKey; pos += 4;
const entries = [];
for (let i = 0; i < fileCount; i++) {
  const { str: filePath, pos: p2 } = readStr(buf, pos, obfKey & 0xFF); pos = p2;
  const { pos: p3 } = readStr(buf, pos, obfKey & 0xFF); pos = p3;
  const maskLow = BigInt(obfKey) & 0xFFFFFFFFn;
  const maskHi = obfKey < 0 ? 0xFFFFFFFFn : (BigInt(obfKey) & 0xFFFFFFFFn);
  const mask = (maskHi << 32n) | maskLow;
  const rawStart = dv.getBigUint64(pos, false);
  const startPos = Number((rawStart ^ mask) & 0xFFFFFFFFFFFFFFFFn); pos += 8;
  const fileLen = dv.getInt32(pos, false) ^ obfKey; pos += 4;
  const obf = !!(dv.getUint8(pos) ^ (obfKey & 0xFF)); pos += 1;
  pos += 1; pos += 8;
  entries.push({ path: filePath, startPos, fileLen, obfuscated: obf });
}
const main = entries.find(e => e.path === 'main.xml');
let b = buf.slice(main.startPos, main.startPos + main.fileLen);
if (main.obfuscated) { const k = obfKey & 0xFF; const o = new Uint8Array(b.length); for (let i=0;i<b.length;i++) o[i]=b[i]^k; b = o; }
const zdv = new DataView(b.buffer, b.byteOffset, b.byteLength);
const flags = zdv.getUint16(6, true);
const compSize = zdv.getUint32(18, true);
const fnLen = zdv.getUint16(26, true);
const extraLen = zdv.getUint16(28, true);
const contentStart = 30 + fnLen + extraLen;
let compContent;
if ((flags & 0x08) && compSize === 0) {
  const descOff = b.length - 16;
  const descSig = zdv.getUint32(descOff, true);
  compContent = descSig === 0x08074b50 ? b.slice(contentStart, descOff) : b.slice(contentStart);
} else {
  compContent = b.slice(contentStart, contentStart + compSize);
}
const chunks = [];
const inf = createInflateRaw();
await new Promise((r) => { inf.on('data', c => chunks.push(c)); inf.on('end', r); inf.on('error', r); inf.end(compContent); });
process.stdout.write(Buffer.concat(chunks));
