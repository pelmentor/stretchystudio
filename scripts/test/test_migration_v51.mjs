// Tests for migration v51 — bump parameter.decimalPlaces from 1 to 3 for
// continuous params (standard / bone / rotation_deformer roles).
// Run: node scripts/test/test_migration_v51.mjs

import { migrateDecimalPlacesThree } from '../../src/store/migrations/v51_decimal_places_three.js';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '../../src/store/projectMigrations.js';

let passed = 0, failed = 0;
const failures = [];
function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}

// 1: null / non-array safe
{
  assert(migrateDecimalPlacesThree(null) === null, '1: null project is null');
  assert(migrateDecimalPlacesThree({}).parameters === undefined,
    '1: missing parameters field is a no-op');
  const p = { parameters: 'not-an-array' };
  eq(JSON.stringify(migrateDecimalPlacesThree(p)), JSON.stringify(p),
    '1: non-array parameters is a no-op');
}

// 2: standard role with decimalPlaces=1 bumps to 3
{
  const project = { parameters: [
    { id: 'ParamBreath', role: 'standard', decimalPlaces: 1 },
    { id: 'ParamAngleX', role: 'standard', decimalPlaces: 1 },
  ] };
  migrateDecimalPlacesThree(project);
  eq(project.parameters[0].decimalPlaces, 3, '2: ParamBreath bumped 1→3');
  eq(project.parameters[1].decimalPlaces, 3, '2: ParamAngleX bumped 1→3');
}

// 3: bone + rotation_deformer roles bump too
{
  const project = { parameters: [
    { id: 'ParamRotation_arm_l', role: 'bone', decimalPlaces: 1 },
    { id: 'ParamRotation_neck', role: 'rotation_deformer', decimalPlaces: 1 },
  ] };
  migrateDecimalPlacesThree(project);
  eq(project.parameters[0].decimalPlaces, 3, '3: bone role bumped');
  eq(project.parameters[1].decimalPlaces, 3, '3: rotation_deformer role bumped');
}

// 4: opacity + variant roles are NOT bumped (they're 0/1 toggles)
{
  const project = { parameters: [
    { id: 'ParamOpacity', role: 'opacity', decimalPlaces: 1 },
    { id: 'ParamSmile', role: 'variant', decimalPlaces: 1 },
  ] };
  migrateDecimalPlacesThree(project);
  eq(project.parameters[0].decimalPlaces, 1, '4: opacity stays at 1');
  eq(project.parameters[1].decimalPlaces, 1, '4: variant stays at 1');
}

// 5: already at 3 (or higher) — idempotent
{
  const project = { parameters: [
    { id: 'ParamBreath', role: 'standard', decimalPlaces: 3 },
    { id: 'ParamAngleX', role: 'standard', decimalPlaces: 4 },
  ] };
  migrateDecimalPlacesThree(project);
  eq(project.parameters[0].decimalPlaces, 3, '5: dp=3 unchanged');
  eq(project.parameters[1].decimalPlaces, 4, '5: dp=4 unchanged');
}

// 6: no role + non-opacity id — gets bumped (legacy stored params)
{
  const project = { parameters: [
    { id: 'ParamBreath', decimalPlaces: 1 /* no role */ },
  ] };
  migrateDecimalPlacesThree(project);
  eq(project.parameters[0].decimalPlaces, 3, '6: role-less ParamBreath bumped');
}

// 7: no role but id === ParamOpacity — left alone
{
  const project = { parameters: [
    { id: 'ParamOpacity', decimalPlaces: 1 /* no role */ },
  ] };
  migrateDecimalPlacesThree(project);
  eq(project.parameters[0].decimalPlaces, 1, '7: ParamOpacity preserved at 1');
}

// 8: missing decimalPlaces field treated as 1 → bumped to 3
{
  const project = { parameters: [
    { id: 'ParamBreath', role: 'standard' /* no decimalPlaces */ },
  ] };
  migrateDecimalPlacesThree(project);
  eq(project.parameters[0].decimalPlaces, 3, '8: missing dp bumped to 3');
}

// 9: malformed entries skipped without throwing
{
  const project = { parameters: [
    null,
    undefined,
    'not-an-object',
    { id: 'ParamBreath', role: 'standard', decimalPlaces: 1 },
  ] };
  migrateDecimalPlacesThree(project);
  eq(project.parameters[3].decimalPlaces, 3, '9: real param still bumped past malformed siblings');
}

// 10: Full migrateProject from pre-v51 schema bumps to current
{
  const project = {
    schemaVersion: 50,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    textures: [], nodes: [], animations: [], physics_groups: [],
    parameters: [
      { id: 'ParamBreath', role: 'standard', decimalPlaces: 1, min: 0, max: 1, default: 0, name: 'Breath', repeat: false },
      { id: 'ParamOpacity', role: 'opacity', decimalPlaces: 1, min: 0, max: 1, default: 1, name: 'Opacity', repeat: false },
    ],
  };
  migrateProject(project);
  eq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    `10: bumps to current (${CURRENT_SCHEMA_VERSION}), got ${project.schemaVersion}`);
  assert(CURRENT_SCHEMA_VERSION >= 51, '10: CURRENT_SCHEMA_VERSION advanced to at least 51');
  eq(project.parameters[0].decimalPlaces, 3, '10: ParamBreath bumped through full migrate');
  eq(project.parameters[1].decimalPlaces, 1, '10: ParamOpacity preserved through full migrate');
}

console.log(`\nmigration_v51: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
