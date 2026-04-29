// Dump the first CTextureInput_ModelImage and CModelImage from a .cmo3
// to figure out how the texture path is wired. Read-only dev script.
//
// Usage: node scripts/dev-tools/dump_texture_sample.mjs <file.cmo3>

import { readFileSync } from 'node:fs';
import { unpackCaff } from '../../src/io/live2d/caffUnpacker.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/dev-tools/dump_texture_sample.mjs <cmo3>');
  process.exit(2);
}

const bytes = readFileSync(path);
const archive = await unpackCaff(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
const xml = new TextDecoder().decode(
  archive.files.find((f) => f.path === 'main.xml').content,
);

// First CTextureInput_ModelImage definition
function dumpFirst(tag) {
  const re = new RegExp(`<${tag}\\s+xs\\.id="(#\\d+)"`);
  const m = re.exec(xml);
  if (!m) return console.log(`(no ${tag} definition)`);
  const start = m.index;
  let depth = 0;
  let i = start;
  let end = -1;
  while (i < xml.length) {
    if (xml.startsWith(`<${tag}`, i)) {
      const close = xml.indexOf('>', i);
      if (close === -1) break;
      depth++;
      if (xml[close - 1] === '/') depth--;
      i = close + 1;
    } else if (xml.startsWith(`</${tag}>`, i)) {
      depth--;
      i += `</${tag}>`.length;
      if (depth === 0) { end = i; break; }
    } else {
      i++;
    }
  }
  console.log(`=== ${tag} ===`);
  console.log(xml.slice(start, end));
  console.log('');
}

dumpFirst('CTextureInput_ModelImage');
dumpFirst('CModelImage');
