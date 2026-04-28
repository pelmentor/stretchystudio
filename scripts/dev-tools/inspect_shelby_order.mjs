import fs from 'fs';
import { inflateRawSync } from 'node:zlib';

const path = process.argv[2] || 'shelby_smile.cmo3';
const buf = Uint8Array.from(fs.readFileSync(path));
const td = new TextDecoder();
if (td.decode(buf.slice(0, 4)) !== 'CAFF') { console.error('not CAFF'); process.exit(1); }
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

let pos = 26;
pos += 2 + 2 + 2 + 2 + 8 + 4 + 8;
const fileCount = dv.getInt32(pos, false) ^ obfKey;
pos += 4;

let mainXmlEntry = null;
for (let i = 0; i < fileCount; i++) {
  const { str: name, pos: p1 } = readStr(buf, pos, obfKey);
  const compress = (dv.getInt8(p1) ^ (obfKey & 0xFF));
  const obf = (dv.getInt8(p1 + 1) ^ (obfKey & 0xFF)) !== 0;
  const len = dv.getInt32(p1 + 2, false) ^ obfKey;
  const offset = dv.getInt32(p1 + 6, false) ^ obfKey;
  pos = p1 + 10;
  if (name === 'main.xml') {
    mainXmlEntry = { compress, obf, len, offset };
  }
}

const { compress, obf, len, offset } = mainXmlEntry;
let raw = buf.slice(offset, offset + len);
if (obf) {
  const xor = (obfKey & 0xFF) ^ ((offset ^ (offset >> 8)) & 0xFF);
  const unxor = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) unxor[i] = raw[i] ^ (xor ^ (i & 0xFF));
  raw = unxor;
}
const xml = compress ? inflateRawSync(raw).toString('utf8') : td.decode(raw);

// Locate CDrawableSourceSet _sources
const m = xml.match(/drawableSourceSet[\s\S]*?<carray_list xs\.n="_sources" count="(\d+)">([\s\S]*?)<\/carray_list>/);
if (!m) { console.error('no drawableSourceSet'); process.exit(1); }
const refs = Array.from(m[2].matchAll(/xs\.ref="([^"]+)"/g)).map(m => m[1]);

function nameFor(id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mm = xml.match(new RegExp('xs\\.id="' + esc + '"[\\s\\S]*?<s xs\\.n="localName">([^<]*)</s>'));
  return mm ? mm[1] : '(no name)';
}

console.log('=== _sources order ===');
refs.forEach((r, i) => {
  const n = nameFor(r);
  if (n.includes('face') || n.includes('mouth') || n.includes('nose') || n.includes('eyebrow')) {
    console.log(String(i).padStart(3), r, '→', n);
  }
});
