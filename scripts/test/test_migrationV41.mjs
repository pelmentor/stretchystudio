// Tests for migration v41 — Animation Phase 3 Slice 3.A: FCurve.modifiers[]
// substrate. Run: node scripts/test/test_migrationV41.mjs

import { migrateFModifiers } from '../../src/store/migrations/v41_fmodifiers.js';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '../../src/store/projectMigrations.js';
import {
  FMODIFIER_TYPES,
  isFModifierType,
  getFCurveModifiers,
} from '../../src/anim/fmodifiers.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

// ── 1. Direct migrator: empty project → safe no-op ─────────────────
{
  const r = migrateFModifiers({});
  eq(r.fcurvesScanned, 0, '1: empty project fcurvesScanned=0');
}

// ── 2. Direct migrator: null project → safe no-op ──────────────────
{
  const r = migrateFModifiers(null);
  eq(r.fcurvesScanned, 0, '2: null project safe');
}

// ── 3. Direct migrator: project with fcurves leaves them untouched ─
{
  const project = {
    actions: [
      {
        id: 'act1',
        fcurves: [
          { id: 'fc1', rnaPath: 'objects["nodeA"].transform.x', keyforms: [] },
          { id: 'fc2', rnaPath: 'objects["nodeA"].transform.y', keyforms: [] },
        ],
      },
    ],
  };
  const before = JSON.stringify(project);
  const r = migrateFModifiers(project);
  eq(r.fcurvesScanned, 2, '3: scans 2 fcurves');
  eq(JSON.stringify(project), before, '3: project unchanged (no-op by design)');
  assert(project.actions[0].fcurves[0].modifiers === undefined,
    '3: fcurve.modifiers stays absent (sparse default)');
}

// ── 4. Direct migrator: idempotent re-run ──────────────────────────
{
  const project = {
    actions: [
      {
        id: 'act1',
        fcurves: [
          {
            id: 'fc1', rnaPath: 'objects["nodeA"].transform.x', keyforms: [],
            // simulate v41-aware code that has already written a modifier
            modifiers: [{
              id: 'm1', type: 'cycles', data: { after: 'repeat', afterCycles: 0 },
            }],
          },
        ],
      },
    ],
  };
  const before = JSON.stringify(project);
  migrateFModifiers(project);
  migrateFModifiers(project);
  eq(JSON.stringify(project), before, '4: idempotent — modifier data preserved across re-runs');
}

// ── 5. Full migrateProject: pre-v41 save bumps to current ──────────
{
  const project = {
    schemaVersion: 40,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    textures: [], nodes: [], animations: [], parameters: [], physics_groups: [],
    actions: [
      {
        id: 'act1',
        fcurves: [
          { id: 'fc1', rnaPath: 'objects["nodeA"].transform.x', keyforms: [] },
        ],
      },
    ],
  };
  migrateProject(project);
  eq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    `5: bumps to current (${CURRENT_SCHEMA_VERSION}), got ${project.schemaVersion}`);
  assert(CURRENT_SCHEMA_VERSION >= 41, '5: CURRENT_SCHEMA_VERSION advanced to at least 41');
  // FCurve still loads without a modifiers array (sparse)
  assert(project.actions[0].fcurves[0].modifiers === undefined,
    '5: pre-v41 fcurve loaded with modifiers absent (sparse)');
}

// ── 6. Action with no fcurves → safe ───────────────────────────────
{
  const project = { actions: [{ id: 'act1' /* no fcurves */ }] };
  const r = migrateFModifiers(project);
  eq(r.fcurvesScanned, 0, '6: action without fcurves scans 0');
}

// ── 7. Missing actions array → safe ────────────────────────────────
{
  const project = { /* no actions, no nodes */ };
  const r = migrateFModifiers(project);
  eq(r.fcurvesScanned, 0, '7: missing actions safe');
}

// ── 8. CURRENT_SCHEMA_VERSION sanity ───────────────────────────────
{
  // Catches drift where the constant in projectSchemaVersion.js is
  // bumped but the corresponding MIGRATIONS[N] entry is never added
  // (or vice versa). Walks one fresh project through migrateProject and
  // asserts the final version matches the constant exactly.
  const project = { schemaVersion: 1 };
  migrateProject(project);
  eq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    `8: walker reaches CURRENT_SCHEMA_VERSION=${CURRENT_SCHEMA_VERSION}`);
}

// ── 9. FMODIFIER_TYPES constant — 6 supported types in expected order ─
{
  eq(Array.isArray(FMODIFIER_TYPES) || Object.isFrozen(FMODIFIER_TYPES), true,
    '9: FMODIFIER_TYPES exported');
  eq(FMODIFIER_TYPES.length, 6, '9: exactly 6 types ship in Phase 3');
  // Order matches Blender's eFModifier_Types enum order
  // (DNA_anim_enums.h:24-39): GENERATOR=1, ENVELOPE=3, CYCLES=4,
  // NOISE=5, LIMITS=8, STEPPED=9.
  eq(FMODIFIER_TYPES[0], 'generator', '9: order — generator first (Blender =1)');
  eq(FMODIFIER_TYPES[1], 'envelope', '9: order — envelope second (=3)');
  eq(FMODIFIER_TYPES[2], 'cycles', '9: order — cycles third (=4)');
  eq(FMODIFIER_TYPES[3], 'noise', '9: order — noise fourth (=5)');
  eq(FMODIFIER_TYPES[4], 'limits', '9: order — limits fifth (=8)');
  eq(FMODIFIER_TYPES[5], 'stepped', '9: order — stepped sixth (=9)');
}

// ── 10. FMODIFIER_TYPES is immutable (frozen) ──────────────────────
{
  assert(Object.isFrozen(FMODIFIER_TYPES),
    '10: FMODIFIER_TYPES is Object.freeze()ed');
}

// ── 11. isFModifierType type guard ─────────────────────────────────
{
  eq(isFModifierType('cycles'), true, '11: cycles is a type');
  eq(isFModifierType('noise'), true, '11: noise is a type');
  eq(isFModifierType('generator'), true, '11: generator is a type');
  eq(isFModifierType('limits'), true, '11: limits is a type');
  eq(isFModifierType('stepped'), true, '11: stepped is a type');
  eq(isFModifierType('envelope'), true, '11: envelope is a type');
  // Deferred types are NOT valid (until a follow-up plan adds them)
  eq(isFModifierType('function_generator'), false,
    '11: function_generator is deferred — not a valid type');
  eq(isFModifierType('smooth'), false,
    '11: smooth is deferred — not a valid type');
  // Removed / invented types
  eq(isFModifierType('filter'), false, '11: filter (Blender-removed) rejected');
  eq(isFModifierType('python'), false, '11: python (Blender-removed) rejected');
  eq(isFModifierType('extrapolate'), false,
    '11: extrapolate (plan-v1 invented mode) rejected');
  eq(isFModifierType('expanded'), false,
    '11: expanded (plan-v1 invented Generator mode) rejected');
  // Garbage
  eq(isFModifierType(undefined), false, '11: undefined rejected');
  eq(isFModifierType(null), false, '11: null rejected');
  eq(isFModifierType(42), false, '11: number rejected');
  eq(isFModifierType({}), false, '11: object rejected');
  eq(isFModifierType(''), false, '11: empty string rejected');
}

// ── 12. getFCurveModifiers reader — sparse defaults to empty array ─
{
  eq(getFCurveModifiers(null).length, 0, '12: null fcurve → []');
  eq(getFCurveModifiers(undefined).length, 0, '12: undefined fcurve → []');
  eq(getFCurveModifiers({}).length, 0, '12: empty fcurve → []');
  eq(getFCurveModifiers({ modifiers: undefined }).length, 0,
    '12: modifiers=undefined → []');
  eq(getFCurveModifiers({ modifiers: null }).length, 0,
    '12: modifiers=null → []');
  eq(getFCurveModifiers({ modifiers: 'not-an-array' }).length, 0,
    '12: modifiers=string → []');
  eq(getFCurveModifiers({ modifiers: [] }).length, 0,
    '12: modifiers=[] → []');
}

// ── 13. getFCurveModifiers reader — returns the actual array when present ─
{
  const mods = [
    { id: 'm1', type: 'cycles', data: { after: 'repeat', afterCycles: 0 } },
    { id: 'm2', type: 'noise', data: { strength: 1 } },
  ];
  const fc = { modifiers: mods };
  const got = getFCurveModifiers(fc);
  eq(got, mods, '13: returns the actual modifiers array by reference');
  eq(got.length, 2, '13: returns 2 modifiers');
}

console.log(`\nmigrationV41: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
