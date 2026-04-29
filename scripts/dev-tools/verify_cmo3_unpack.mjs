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
if (meta.warnings.length > 0) {
  console.log('');
  console.log('  warnings:');
  for (const w of meta.warnings) console.log(`    - ${w}`);
}
