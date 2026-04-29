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

console.log('Rotation deformers:');
for (const d of scene.deformers.filter((x) => x.kind === 'rotation')) {
  console.log(`  ${d.idStr.padEnd(22)} name="${d.name}"`);
  console.log(`    parentDeformerGuidRef=${d.parentDeformerGuidRef ?? '(root)'}`);
  console.log(`    parentPartGuidRef=${d.parentPartGuidRef ?? '(none)'}`);
  for (let i = 0; i < d.keyforms.length; i++) {
    const kf = d.keyforms[i];
    console.log(`    keyform[${i}] angle=${kf.angle} originX=${kf.originX} originY=${kf.originY} scale=${kf.scale}`);
  }
}

console.log('');
console.log('Group → guidRef map:');
for (const g of scene.groups) {
  console.log(`  ${g.name.padEnd(20)} guidRef=${g.guidRef ?? '-'} xsId=${g.xsId ?? '-'}`);
}
