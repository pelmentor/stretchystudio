// Dump shelby's full authored rig structure: all warps, rotations, parents.
// Used to understand what buildAuthoredRigSeed needs to reproduce.
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
for (const d of scene.deformers) if (d.ownGuidRef) byOwn.set(d.ownGuidRef, d);

console.log(`# shelby.cmo3 full rig`);
console.log(`#   ${scene.deformers.length} deformers (${scene.deformers.filter(d => d.kind === 'warp').length} warp, ${scene.deformers.filter(d => d.kind === 'rotation').length} rotation)`);
console.log(`#   ${scene.parts.length} parts`);
console.log();

console.log(`## warp deformers (parent first)`);
const warps = scene.deformers.filter(d => d.kind === 'warp');
for (const w of warps) {
  const parent = w.parentDeformerGuidRef ? byOwn.get(w.parentDeformerGuidRef) : null;
  const parentLabel = parent ? `${parent.kind}/${parent.idStr}` : `<root>`;
  console.log(`  ${w.idStr.padEnd(28)} parent=${parentLabel.padEnd(20)} grid=${w.cols}×${w.rows} keyforms=${w.keyforms.length}`);
}
console.log();

console.log(`## rotation deformers`);
const rots = scene.deformers.filter(d => d.kind === 'rotation');
for (const r of rots) {
  const parent = r.parentDeformerGuidRef ? byOwn.get(r.parentDeformerGuidRef) : null;
  const parentLabel = parent ? `${parent.kind}/${parent.idStr}` : `<root>`;
  console.log(`  ${r.idStr.padEnd(28)} parent=${parentLabel.padEnd(20)} keyforms=${r.keyforms.length} restOrigin=(${r.keyforms[0]?.originX ?? '?'}, ${r.keyforms[0]?.originY ?? '?'})`);
}
console.log();

console.log(`## body warp keyforms (each kf, corners)`);
for (const idStr of ['BodyWarpZ', 'BodyWarpY', 'BreathWarp', 'BodyXWarp']) {
  const w = scene.deformers.find(d => d.idStr === idStr);
  if (!w) continue;
  console.log(`  ${idStr}  has top-level positions: ${w.positions ? 'YES' : 'NO'}  keyforms: ${w.keyforms.length}`);
  for (let i = 0; i < w.keyforms.length; i++) {
    const k = w.keyforms[i];
    if (!k.positions) { console.log(`    kf[${i}] no positions`); continue; }
    const lastIdx = k.positions.length - 2;
    const trIdx = 2 * w.cols;
    console.log(`    kf[${i}] TL=(${k.positions[0].toFixed(4)}, ${k.positions[1].toFixed(4)})  TR=(${k.positions[trIdx].toFixed(4)}, ${k.positions[trIdx+1].toFixed(4)})  BR=(${k.positions[lastIdx].toFixed(4)}, ${k.positions[lastIdx+1].toFixed(4)})`);
  }
}
console.log();

console.log(`## FaceParallax keyforms (corners)`);
{
  const w = scene.deformers.find(d => d.idStr === 'FaceParallax');
  if (w) {
    console.log(`  has top-level positions: ${w.positions ? 'YES' : 'NO'}  keyforms: ${w.keyforms.length}  parent: ${byOwn.get(w.parentDeformerGuidRef)?.idStr ?? '<root>'}`);
    for (let i = 0; i < w.keyforms.length; i++) {
      const k = w.keyforms[i];
      if (!k.positions) continue;
      const lastIdx = k.positions.length - 2;
      const trIdx = 2 * w.cols;
      console.log(`    kf[${i}] TL=(${k.positions[0].toFixed(4)}, ${k.positions[1].toFixed(4)})  TR=(${k.positions[trIdx].toFixed(4)}, ${k.positions[trIdx+1].toFixed(4)})  BR=(${k.positions[lastIdx].toFixed(4)}, ${k.positions[lastIdx+1].toFixed(4)})`);
    }
  }
}
console.log();

console.log(`## parts → deformer parent`);
for (const p of scene.parts) {
  const def = p.deformerGuidRef ? byOwn.get(p.deformerGuidRef) : null;
  const defLabel = def ? `${def.kind}/${def.idStr}` : `<no deformer>`;
  console.log(`  ${p.drawableIdStr.padEnd(12)} (${(p.name ?? '?').padEnd(18)})  parent=${defLabel}`);
}
