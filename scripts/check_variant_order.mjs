// Check face vs face.smile position in _sources of a cmo3 export.
// Reuses inspect_cmo3's CAFF decoder — just imports its logic.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const cmo3Path = process.argv[2];
if (!cmo3Path) { console.error('usage: node check_variant_order.mjs <cmo3>'); process.exit(1); }

// Reuse inspect_cmo3 by piping a pattern that matches nothing, to extract xml size only.
// Actually easier: call it, grep for relevant patterns.
console.log('\n=== CArtMeshSource declaration order (left-to-right by XML offset) ===');
const grepResult = execSync(`node scripts/inspect_cmo3.mjs "${cmo3Path}" "localName\\">[^<]+\\.smile<|localName\\">face<|localName\\">mouth<|localName\\">nose<|localName\\">eyebrow-[lr]<"`, { encoding: 'utf8' });
console.log(grepResult);
