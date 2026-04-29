// Dump all warp deformers + their parent-deformer chain so we can
// understand what idStrs the cmo3 carries for the body / face / neck
// chain. Output orders deformers root→leaf by walking parents.
import { readFileSync } from 'node:fs';
let blobCounter = 0;
globalThis.URL.createObjectURL = (blob) => `blob:mock-${++blobCounter}`;

import { unpackCaff } from '../../src/io/live2d/caffUnpacker.js';
import { parseCmo3Xml } from '../../src/io/live2d/cmo3XmlParser.js';
import { extractScene } from '../../src/io/live2d/cmo3PartExtract.js';

const bytes = readFileSync(process.argv[2] ?? 'shelby.cmo3');
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const archive = await unpackCaff(u8);
const xml = new TextDecoder().decode(archive.files.find((f) => f.path === 'main.xml').content);
const parsed = parseCmo3Xml(xml);
const scene = extractScene(parsed);

const byOwn = new Map();
for (const d of scene.deformers) {
  if (d.ownGuidRef) byOwn.set(d.ownGuidRef, d);
}

console.log('All deformers (idStr, kind, parentDeformerGuidRef, parent.idStr):');
for (const d of scene.deformers) {
  const parent = d.parentDeformerGuidRef ? byOwn.get(d.parentDeformerGuidRef) : null;
  const parentLabel = parent ? `${parent.idStr} (${parent.kind})` : '(root or unresolved)';
  console.log(`  ${d.idStr.padEnd(28)} kind=${d.kind.padEnd(10)} parent=${parentLabel}`);
}

console.log('');
console.log('Resolved chains (root → leaf):');
for (const d of scene.deformers) {
  const chain = [d.idStr];
  let cur = d;
  let safety = 16;
  while (cur.parentDeformerGuidRef && safety-- > 0) {
    const p = byOwn.get(cur.parentDeformerGuidRef);
    if (!p) break;
    chain.unshift(p.idStr);
    cur = p;
  }
  console.log(`  ${chain.join(' → ')}`);
}
