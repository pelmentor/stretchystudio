// @ts-check

/**
 * BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.B preflight.
 *
 * Loads the user's Shelby `.stretch` project, runs:
 *   A) `project.nodes.filter(n => n?.type === 'deformer')` — the
 *      current `selectRigSpec` reader.
 *   B) `synthesizeDeformerNodesForExport(project)` — the candidate
 *      Phase 3.B reader.
 *
 * Compares the two trees structurally (id, parent, deformerKind, all
 * data fields). If A ≡ B byte-equal across the field set, the
 * `selectRigSpec` reader switch is safe — Phase 3.B can ship.
 *
 * Usage:
 *   node scripts/byteFidelity/preflight_synth_vs_filter.mjs <path/to/shelby.stretch>
 */

import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { migrateProject } from '../../src/store/projectMigrations.js';
import { synthesizeDeformerNodesForExport } from '../../src/io/live2d/rig/synthesizeDeformerNodesForExport.js';

const stretchPath = process.argv[2];
if (!stretchPath) {
  console.error('Usage: node scripts/byteFidelity/preflight_synth_vs_filter.mjs <stretch-file>');
  process.exit(2);
}

// .stretch is a JSZip archive containing project.json (+ texture PNGs).
const stretchBuf = await readFile(stretchPath);
const zip = await JSZip.loadAsync(stretchBuf);
const projectJsonStr = await zip.file('project.json').async('string');
const project = JSON.parse(projectJsonStr);

// migrateProject runs the schema chain in place to CURRENT_SCHEMA_VERSION.
migrateProject(project);

const filterResult = (project.nodes ?? []).filter((n) => n?.type === 'deformer');
const synthResult = synthesizeDeformerNodesForExport(project);

console.log(`filter: ${filterResult.length} deformer nodes`);
console.log(`synth:  ${synthResult.length} deformer nodes`);

// Index both by id for direct comparison.
const byIdA = new Map();
for (const n of filterResult) {
  if (n?.id) byIdA.set(n.id, n);
}
const byIdB = new Map();
for (const n of synthResult) {
  if (n?.id) byIdB.set(n.id, n);
}

const allIds = new Set([...byIdA.keys(), ...byIdB.keys()]);
const onlyA = [];
const onlyB = [];
const fieldDiffs = [];

const COMPARE_FIELDS_WARP = [
  'parent', 'deformerKind', 'name', 'visible',
  'gridSize', 'baseGrid', 'localFrame',
  'isLocked', 'isQuadTransform',
  'targetPartId', 'canvasBbox',
  '_userAuthored',
];
const COMPARE_FIELDS_ROTATION = [
  'parent', 'deformerKind', 'name', 'visible',
  'baseAngle', 'handleLengthOnCanvas', 'circleRadiusOnCanvas',
  'isLocked', 'useBoneUiTestImpl',
  '_userAuthored',
];

function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let bindingsTotal = 0, bindingsDiff = 0;
let keyformsTotal = 0, keyformsDiff = 0;

for (const id of allIds) {
  const a = byIdA.get(id);
  const b = byIdB.get(id);
  if (!a) { onlyB.push(id); continue; }
  if (!b) { onlyA.push(id); continue; }
  const fields = a.deformerKind === 'rotation'
    ? COMPARE_FIELDS_ROTATION : COMPARE_FIELDS_WARP;
  /** @type {Array<{field: string, A: any, B: any}>} */
  const localDiffs = [];
  for (const f of fields) {
    if (!jsonEq(a[f], b[f])) {
      localDiffs.push({ field: f, A: a[f], B: b[f] });
    }
  }
  // bindings + keyforms get their own counts because they're arrays
  // and could be huge — show only counts in the report.
  bindingsTotal++;
  if (!jsonEq(a.bindings ?? [], b.bindings ?? [])) {
    bindingsDiff++;
    localDiffs.push({ field: 'bindings', A: `[${(a.bindings ?? []).length}]`, B: `[${(b.bindings ?? []).length}]` });
  }
  keyformsTotal++;
  if (!jsonEq(a.keyforms ?? [], b.keyforms ?? [])) {
    keyformsDiff++;
    localDiffs.push({ field: 'keyforms', A: `[${(a.keyforms ?? []).length}]`, B: `[${(b.keyforms ?? []).length}]` });
  }
  if (localDiffs.length > 0) {
    fieldDiffs.push({ id, kind: a.deformerKind, diffs: localDiffs });
  }
}

console.log();
console.log(`Only in filter (A): ${onlyA.length}`);
if (onlyA.length > 0) console.log(' ', onlyA.slice(0, 10).join(', '));
console.log(`Only in synth (B):  ${onlyB.length}`);
if (onlyB.length > 0) console.log(' ', onlyB.slice(0, 10).join(', '));
console.log(`Field-diffs:        ${fieldDiffs.length}`);
console.log(`bindings diff:      ${bindingsDiff}/${bindingsTotal}`);
console.log(`keyforms diff:      ${keyformsDiff}/${keyformsTotal}`);

if (fieldDiffs.length > 0) {
  console.log();
  console.log('First 5 field-diffs:');
  for (const d of fieldDiffs.slice(0, 5)) {
    console.log(`  ${d.id} (${d.kind}):`);
    for (const f of d.diffs.slice(0, 3)) {
      const aStr = typeof f.A === 'object' ? JSON.stringify(f.A).slice(0, 120) : String(f.A);
      const bStr = typeof f.B === 'object' ? JSON.stringify(f.B).slice(0, 120) : String(f.B);
      console.log(`    ${f.field}:`);
      console.log(`      A: ${aStr}`);
      console.log(`      B: ${bStr}`);
    }
  }
}

const ok = onlyA.length === 0 && onlyB.length === 0 && fieldDiffs.length === 0;
console.log();
console.log(ok
  ? 'OK — synth output is structurally identical to node-filter. selectRigSpec switch is safe.'
  : 'DIVERGENCE — switching readers will change rig output. Investigate before shipping Phase 3.B.');
process.exit(ok ? 0 : 1);
