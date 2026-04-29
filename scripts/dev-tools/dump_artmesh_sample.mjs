// Print the first CArtMeshSource definition from a .cmo3's main.xml so we
// can understand the encoding of vertices / triangles / UVs / texture refs
// before writing a parser. Read-only dev script.
//
// Usage: node scripts/dev-tools/dump_artmesh_sample.mjs <file.cmo3>

import { readFileSync } from 'node:fs';
import { unpackCaff } from '../../src/io/live2d/caffUnpacker.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/dev-tools/dump_artmesh_sample.mjs <cmo3>');
  process.exit(2);
}

const bytes = readFileSync(path);
const archive = await unpackCaff(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
const xml = new TextDecoder().decode(
  archive.files.find((f) => f.path === 'main.xml').content,
);

// Find first <CArtMeshSource xs.id="..."> ... </CArtMeshSource>
const startRe = /<CArtMeshSource\s+xs\.id="(#\d+)"/;
const m = startRe.exec(xml);
if (!m) {
  console.error('no CArtMeshSource with xs.id found');
  process.exit(3);
}
const start = m.index;
// Walk forward, balancing tags, until matching </CArtMeshSource>
let depth = 0;
let i = start;
let end = -1;
while (i < xml.length) {
  if (xml.startsWith('<CArtMeshSource', i)) {
    depth++;
    // Skip past the tag
    const close = xml.indexOf('>', i);
    if (close === -1) break;
    i = close + 1;
    if (xml[close - 1] === '/') depth--;
  } else if (xml.startsWith('</CArtMeshSource>', i)) {
    depth--;
    i += '</CArtMeshSource>'.length;
    if (depth === 0) { end = i; break; }
  } else {
    i++;
  }
}

if (end === -1) {
  console.error('unbalanced CArtMeshSource');
  process.exit(4);
}

console.log(xml.slice(start, end));
