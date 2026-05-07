// @ts-check

/**
 * Inspect a V2-exported moc3/cmo3 pair: hash, header sanity, smoke
 * checks. Used for the user-side V2 validation when no pre-V2
 * baseline is available.
 *
 * Usage:
 *   node scripts/byteFidelity/inspect_export.mjs <moc3-path> <cmo3-path>
 */

import { readFile } from 'node:fs/promises';
import { fnv1aHashBuffer } from './byteFidelityHarness.mjs';

const moc3Path = process.argv[2];
const cmo3Path = process.argv[3];

if (!moc3Path || !cmo3Path) {
  console.error('Usage: node inspect_export.mjs <moc3-path> <cmo3-path>');
  process.exit(2);
}

const moc3 = await readFile(moc3Path);
const cmo3 = await readFile(cmo3Path);

console.log('moc3:');
console.log(`  path:  ${moc3Path}`);
console.log(`  size:  ${moc3.length} bytes`);
console.log(`  hash:  ${fnv1aHashBuffer(moc3)}`);
console.log(`  magic: ${String.fromCharCode(moc3[0], moc3[1], moc3[2], moc3[3])} (expected MOC3)`);
const moc3Version = moc3[4];
console.log(`  ver:   0x${moc3Version.toString(16).padStart(2, '0')} (1=2.0+, 2=3.0+, 3=3.3+, 4=4.0+, 5=4.2+)`);

console.log();
console.log('cmo3:');
console.log(`  path:  ${cmo3Path}`);
console.log(`  size:  ${cmo3.length} bytes`);
console.log(`  hash:  ${fnv1aHashBuffer(cmo3)}`);
// .cmo3 is a CAFF archive; first 4 bytes should be the CAFF magic.
const cmo3Magic = String.fromCharCode(cmo3[0], cmo3[1], cmo3[2], cmo3[3]);
console.log(`  magic: ${cmo3Magic} (expected CAFF)`);

const ok = moc3.length > 100 && cmo3.length > 1000;
console.log();
console.log(ok ? 'OK' : 'WARN — sizes look unusually small');
process.exit(0);
