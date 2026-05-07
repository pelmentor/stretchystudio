// @ts-check

/**
 * Shelby byte-fidelity gate (V2 Phase 0.4).
 *
 * Runs the harness against the user's local Shelby fixture +
 * baseline .moc3. Reads paths from environment variables so the
 * fixture stays out of the repo (PSDs/textures are user-local).
 *
 * Usage (PowerShell):
 *   $env:SHELBY_FIXTURE       = "C:\path\to\shelby_baseline.stretch"
 *   $env:SHELBY_BASELINE_MOC3 = "C:\path\to\shelby_baseline.moc3"
 *   node scripts/byteFidelity/check_shelby.mjs
 *
 * `.stretch` files are JSZip archives. This script unpacks them via
 * the same path the runtime uses (jszip + projectFile.loadProject's
 * project.json parse step), then runs the harness.
 *
 * Exit code 0 = byte-identical. Exit code 1 = divergence detected.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import JSZip from 'jszip';
import { runByteFidelitySweep } from './byteFidelityHarness.mjs';

const FIXTURE_PATH = process.env.SHELBY_FIXTURE;
const BASELINE_MOC3_PATH = process.env.SHELBY_BASELINE_MOC3;

if (!FIXTURE_PATH || !BASELINE_MOC3_PATH) {
  console.error('SHELBY_FIXTURE and SHELBY_BASELINE_MOC3 env vars required.');
  console.error('See scripts/byteFidelity/byteFidelityHarness.mjs doc header.');
  process.exit(2);
}

if (!existsSync(FIXTURE_PATH)) {
  console.error(`Fixture not found: ${FIXTURE_PATH}`);
  process.exit(2);
}
if (!existsSync(BASELINE_MOC3_PATH)) {
  console.error(`Baseline moc3 not found: ${BASELINE_MOC3_PATH}`);
  process.exit(2);
}

const stretchBytes = await readFile(FIXTURE_PATH);
const baselineMoc3 = await readFile(BASELINE_MOC3_PATH);

const zip = await JSZip.loadAsync(stretchBytes);
const projectJson = zip.file('project.json');
if (!projectJson) {
  console.error('Fixture missing project.json — not a valid .stretch file.');
  process.exit(2);
}
const project = JSON.parse(await projectJson.async('string'));

const result = runByteFidelitySweep(project, baselineMoc3);

console.log(`Fixture:        ${FIXTURE_PATH}`);
console.log(`Baseline moc3:  ${BASELINE_MOC3_PATH}`);
console.log(`Migrated to:    schema v${result.migratedSchemaVersion}`);
const d = result.moc3Diff;
if (!d) {
  console.error('No baseline diff produced.');
  process.exit(2);
}
console.log(`Actual moc3:    ${d.actualLen} bytes, hash ${d.actualHash}`);
console.log(`Expected moc3:  ${d.expectedLen} bytes, hash ${d.expectedHash}`);
if (d.identical) {
  console.log('moc3: BYTE-IDENTICAL ✓');
  process.exit(0);
}
console.error(`moc3: DIVERGENCE`);
console.error(`  first divergent byte: offset ${d.firstDivergenceAt}`);
console.error(`  divergent byte count: ${d.divergentByteCount}`);
console.error(`  length delta: ${d.actualLen - d.expectedLen}`);
process.exit(1);
