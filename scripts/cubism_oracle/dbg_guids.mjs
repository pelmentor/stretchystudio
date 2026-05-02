let blobCounter = 0;
globalThis.URL.createObjectURL = (blob) => `blob:mock-${++blobCounter}`;
import { readFileSync } from 'node:fs';
import { unpackCaff } from '../../src/io/live2d/caffUnpacker.js';
import { parseCmo3Xml } from '../../src/io/live2d/cmo3XmlParser.js';
import { extractScene } from '../../src/io/live2d/cmo3PartExtract.js';
const bytes = readFileSync('shelby.cmo3');
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const archive = await unpackCaff(u8);
const xml = new TextDecoder().decode(archive.files.find(f => f.path === 'main.xml').content);
const parsed = parseCmo3Xml(xml);
const scene = extractScene(parsed);
console.log('# deformers (first 6):');
for (const d of scene.deformers.slice(0,6)) {
  console.log(`  ${d.idStr.padEnd(20)} own=${String(d.ownGuidRef).padEnd(8)} parent=${d.parentDeformerGuidRef}`);
}
console.log('\n# FaceParallax own:', scene.deformers.find(d => d.idStr === 'FaceParallax')?.ownGuidRef);
console.log('# FaceRotation own:', scene.deformers.find(d => d.idStr === 'FaceRotation')?.ownGuidRef);
console.log('# RigWarp_irides_l parent:', scene.deformers.find(d => d.idStr === 'RigWarp_irides_l')?.parentDeformerGuidRef);
console.log('# BodyWarpZ own:', scene.deformers.find(d => d.idStr === 'BodyWarpZ')?.ownGuidRef);
console.log('# BodyWarpZ parent:', scene.deformers.find(d => d.idStr === 'BodyWarpZ')?.parentDeformerGuidRef);
console.log('\n# all deformers in extraction order:');
for (const d of scene.deformers) console.log(`  ${d.kind}/${d.idStr.padEnd(20)} own=${String(d.ownGuidRef).padEnd(8)} parent=${String(d.parentDeformerGuidRef).padEnd(8)}`);
