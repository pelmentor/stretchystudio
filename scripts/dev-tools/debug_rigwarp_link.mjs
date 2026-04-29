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

console.log('Warps with own guid refs:');
for (const w of scene.deformers.filter((d) => d.kind === 'warp').slice(0, 4)) {
  console.log(`  ${w.idStr}: ownGuidRef=${w.ownGuidRef} parentDef=${w.parentDeformerGuidRef}`);
}
console.log('');
console.log('Parts with deformer refs:');
for (const p of scene.parts.slice(0, 4)) {
  console.log(`  ${p.drawableIdStr} (${p.name}): deformerGuidRef=${p.deformerGuidRef}`);
}

// Manual run of importCmo3 to see what rigWarps build sees
const { importCmo3 } = await import('../../src/io/live2d/cmo3Import.js');
const result = await importCmo3(u8);
console.log('');
console.log(`importCmo3 stats: ${JSON.stringify(result.stats)}`);
const rigWarpKeys = Object.keys(result.project.rigWarps);
console.log(`rigWarp keys: ${rigWarpKeys.length} entries: ${rigWarpKeys.slice(0, 4).join(', ')}`);

console.log('');
console.log('parts WITHOUT a rigWarp:');
const partsList = result.project.nodes.filter((n) => n.type === 'part');
for (const p of partsList) {
  if (!result.project.rigWarps[p.id]) {
    const part = scene.parts.find((sp) => sp.name === p.name);
    console.log(`  ${p.name.padEnd(20)}  deformerGuidRef=${part?.deformerGuidRef ?? '-'}`);
  }
}

if (result.warnings.length > 0) {
  console.log('warnings:');
  for (const w of result.warnings.slice(0, 8)) console.log(`  - ${w}`);
}
