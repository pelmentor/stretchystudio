// Sanity-checks src/io/live2d/caffUnpacker.js + src/io/live2d/cmo3Inspect.js
// against a real .cmo3 file and prints the metadata snapshot the inspector
// produces. Intended to be diffed against a known-good reference when
// adjusting either module.
//
// Usage: node scripts/dev-tools/verify_cmo3_unpack.mjs <file.cmo3>

import { readFileSync } from 'node:fs';
import { unpackCaff } from '../../src/io/live2d/caffUnpacker.js';
import { inspectCmo3 } from '../../src/io/live2d/cmo3Inspect.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/dev-tools/verify_cmo3_unpack.mjs <cmo3>');
  process.exit(2);
}

const bytes = readFileSync(path);
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Round-trip the CAFF container first.
const archive = await unpackCaff(u8);
console.log(`[caffUnpacker]  obfuscateKey=${archive.obfuscateKey}  files=${archive.files.length}`);
for (const f of archive.files) {
  console.log(
    `  ${f.path.padEnd(36)} ${String(f.content.length).padStart(8)}B  ` +
    `compress=${f.compress} obf=${f.obfuscated}`
  );
}

console.log('');
const meta = await inspectCmo3(u8);
console.log('[cmo3Inspect]');
console.log(`  modelName            ${meta.modelName ?? '(unset)'}`);
console.log(`  canvas               ${meta.canvasW} × ${meta.canvasH}`);
console.log(`  CModelSource version ${meta.cmodelSourceVersion}`);
console.log(`  parts (CArtMesh)     ${meta.partCount}`);
console.log(`  groups (CPart)       ${meta.groupCount}`);
console.log(`  textures (CModelImg) ${meta.textureCount}`);
console.log(`  png files in CAFF    ${meta.pngFiles.length}`);
console.log(`  parameters           ${meta.parameterCount}`);
for (const p of meta.parameters) {
  console.log(
    `    ${p.id.padEnd(20)} ${p.name.padEnd(18)} ` +
    `[${p.min}..${p.max}] default=${p.default} type=${p.type}`
  );
}
if (meta.scene) {
  const warps = meta.scene.deformers.filter((d) => d.kind === 'warp').length;
  const rots = meta.scene.deformers.filter((d) => d.kind === 'rotation').length;
  console.log('');
  console.log(`[scene] parts=${meta.scene.parts.length}  groups=${meta.scene.groups.length}  textures=${meta.scene.textures.length}  warps=${warps}  rotations=${rots}  bindings=${meta.scene.keyformBindings.length}  grids=${meta.scene.keyformGrids.length}`);
  console.log('  first 8 parts:');
  for (const p of meta.scene.parts.slice(0, 8)) {
    const verts = p.positions.length / 2;
    const tris = p.indices.length / 3;
    console.log(`    ${p.drawableIdStr.padEnd(10)} ${p.name.padEnd(18)} verts=${String(verts).padStart(3)} tris=${String(tris).padStart(3)}  texRef=${p.textureRef ?? '-'}  parent=${p.parentGuidRef ?? '-'}`);
  }
  console.log('  groups:');
  for (const g of meta.scene.groups.slice(0, 8)) {
    console.log(`    ${g.name.padEnd(20)} parent=${g.parentGuidRef ?? '(root)'}`);
  }
  console.log('  textures:');
  for (const t of meta.scene.textures.slice(0, 6)) {
    console.log(`    ${t.xsId ?? '-'}  imageFileBuf_${t.imageFileIndex ?? '?'}  filePath=${t.filePath ?? '-'}`);
  }
  console.log('  first 8 deformers:');
  for (const d of meta.scene.deformers.slice(0, 8)) {
    const grid = d.kind === 'warp' ? `${d.cols}×${d.rows}` : 'rotation';
    console.log(`    ${d.kind.padEnd(8)} ${d.idStr.padEnd(28)} ${d.name.padEnd(22)} ${grid}  kf=${d.keyforms.length}  parentDef=${d.parentDeformerGuidRef ?? '-'}`);
  }
  console.log('  first 6 keyform bindings:');
  for (const b of meta.scene.keyformBindings.slice(0, 6)) {
    console.log(`    ${b.xsId ?? '-'}  ${b.description.padEnd(20)} keys=[${b.keys.join(', ')}]  interp=${b.interpolationType}`);
  }
  // Cross-check: link the first deformer to its grid + bindings.
  if (meta.scene.deformers.length > 0) {
    const d0 = meta.scene.deformers[0];
    const grid = meta.scene.keyformGrids.find((g) => g.xsId === d0.keyformGridSourceRef);
    console.log('');
    console.log(`[link sample] ${d0.idStr} grid=${d0.keyformGridSourceRef} cells=${grid?.entries.length ?? 0}`);
    if (grid && grid.entries.length > 0) {
      const cell0 = grid.entries[0];
      console.log(`  cell 0 access:`);
      for (const ak of cell0.accessKey) {
        const bind = meta.scene.keyformBindings.find((b) => b.xsId === ak.bindingRef);
        console.log(`    ${bind?.description ?? '?'} keyIndex=${ak.keyIndex}  paramVal=${bind ? bind.keys[ak.keyIndex] : '?'}`);
      }
      console.log(`  cell 0 keyformGuid=${cell0.keyformGuidRef}`);
    }
  }
}

if (meta.warnings.length > 0) {
  console.log('');
  console.log('  warnings:');
  for (const w of meta.warnings) console.log(`    - ${w}`);
}
