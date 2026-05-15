// Tests for migration v39 — Animation Phase 2.A BezTriple keyform shape.
//
// v39 converts every `project.actions[i].fcurves[j].keyforms[k]` from
// the legacy `{ time, value, easing?, type? }` to the Blender-BezTriple
// shape with `interpolation` discriminator + `handleLeft/Right` slots.
//
// Run: node scripts/test/test_migration_v39.mjs

import { migrateBezTripleKeyforms } from '../../src/store/migrations/v39_beztriple_keyforms.js';
import { CURRENT_SCHEMA_VERSION } from '../../src/store/projectSchemaVersion.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}

// ── schema version sanity ──────────────────────────────────────────────────
{
  assert(CURRENT_SCHEMA_VERSION === 39, 'CURRENT_SCHEMA_VERSION bumped to 39');
}

// ── legacy {time, value} (no easing/type) → linear vector handles ──────────
{
  const project = {
    actions: [{
      fcurves: [{
        keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 30 }],
      }],
    }],
  };
  migrateBezTripleKeyforms(project);
  const k = project.actions[0].fcurves[0].keyforms[0];
  assert(k.interpolation === 'linear', 'no easing/type → interpolation=linear');
  assertEq(k.handleType, { left: 'vector', right: 'vector' }, 'no easing → vector handles');
  assertEq(k.handleLeft, { time: 0, value: 0 }, 'handleLeft default = keyform pos');
  assertEq(k.handleRight, { time: 0, value: 0 }, 'handleRight default = keyform pos');
  assert(k.flag === 0, 'flag default = 0');
  assert(k.easing === undefined, 'legacy easing field dropped');
  assert(k.type === undefined, 'legacy type field dropped');
}

// ── legacy easing 'linear' → interpolation=linear ──────────────────────────
{
  const project = {
    actions: [{ fcurves: [{ keyforms: [{ time: 0, value: 0, easing: 'linear' }] }] }],
  };
  migrateBezTripleKeyforms(project);
  const k = project.actions[0].fcurves[0].keyforms[0];
  assert(k.interpolation === 'linear', "easing='linear' → interpolation=linear");
  assertEq(k.handleType, { left: 'vector', right: 'vector' }, 'linear → vector handles');
}

// ── legacy easing 'stepped' / 'constant' / 'hold' → interpolation=constant ─
{
  for (const easing of ['stepped', 'constant', 'hold', 'inverse-stepped']) {
    const project = {
      actions: [{ fcurves: [{ keyforms: [{ time: 0, value: 5, easing }] }] }],
    };
    migrateBezTripleKeyforms(project);
    const k = project.actions[0].fcurves[0].keyforms[0];
    assert(k.interpolation === 'constant', `easing='${easing}' → interpolation=constant`);
    assertEq(k.handleType, { left: 'vector', right: 'vector' }, `${easing} → vector handles`);
  }
}

// ── legacy type 'constant' → interpolation=constant ────────────────────────
{
  const project = {
    actions: [{ fcurves: [{ keyforms: [{ time: 0, value: 5, type: 'constant' }] }] }],
  };
  migrateBezTripleKeyforms(project);
  const k = project.actions[0].fcurves[0].keyforms[0];
  assert(k.interpolation === 'constant', "type='constant' → interpolation=constant");
}

// ── legacy easing 'ease' / 'ease-both' / 'ease-in-out' → bezier auto/auto ──
{
  for (const easing of ['ease', 'ease-both', 'ease-in-out', 'bezier']) {
    const project = {
      actions: [{ fcurves: [{ keyforms: [{ time: 0, value: 5, easing }] }] }],
    };
    migrateBezTripleKeyforms(project);
    const k = project.actions[0].fcurves[0].keyforms[0];
    assert(k.interpolation === 'bezier', `easing='${easing}' → interpolation=bezier`);
    assertEq(k.handleType, { left: 'auto', right: 'auto' }, `${easing} → auto/auto handles`);
  }
}

// ── legacy easing 'ease-in' → bezier free/auto ─────────────────────────────
{
  const project = {
    actions: [{ fcurves: [{ keyforms: [{ time: 0, value: 5, easing: 'ease-in' }] }] }],
  };
  migrateBezTripleKeyforms(project);
  const k = project.actions[0].fcurves[0].keyforms[0];
  assert(k.interpolation === 'bezier', "easing='ease-in' → interpolation=bezier");
  assertEq(k.handleType, { left: 'free', right: 'auto' }, 'ease-in → free/auto handles');
}

// ── legacy easing 'ease-out' → bezier auto/free ────────────────────────────
{
  const project = {
    actions: [{ fcurves: [{ keyforms: [{ time: 0, value: 5, easing: 'ease-out' }] }] }],
  };
  migrateBezTripleKeyforms(project);
  const k = project.actions[0].fcurves[0].keyforms[0];
  assert(k.interpolation === 'bezier', "easing='ease-out' → interpolation=bezier");
  assertEq(k.handleType, { left: 'auto', right: 'free' }, 'ease-out → auto/free handles');
}

// ── legacy easing [c1,c2,c3,c4] cubic-bezier coefficients → bezier free/free
{
  const project = {
    actions: [{ fcurves: [{ keyforms: [{ time: 0, value: 5, easing: [0.42, 0, 0.58, 1] }] }] }],
  };
  migrateBezTripleKeyforms(project);
  const k = project.actions[0].fcurves[0].keyforms[0];
  assert(k.interpolation === 'bezier', '[c1..c4] → interpolation=bezier');
  assertEq(k.handleType, { left: 'free', right: 'free' }, '[c1..c4] → free/free handles');
  assertEq(k.handleRight, { time: 0.42, value: 0 }, '[c1..c4] → handleRight = (c1, c2)');
  assertEq(k.handleLeft, { time: 0.58, value: 1 }, '[c1..c4] → handleLeft = (c3, c4)');
}

// ── idempotency: re-running migration on v39 keyforms is a no-op ───────────
{
  const project = {
    actions: [{
      fcurves: [{
        keyforms: [{
          time: 0, value: 5,
          handleLeft: { time: -1, value: 5 }, handleRight: { time: 1, value: 5 },
          handleType: { left: 'auto', right: 'auto' },
          interpolation: 'bezier', flag: 0,
        }],
      }],
    }],
  };
  const before = JSON.stringify(project);
  migrateBezTripleKeyforms(project);
  const after = JSON.stringify(project);
  assert(before === after, 'idempotent on v39 keyforms');
}

// ── no actions field → no-op ───────────────────────────────────────────────
{
  const project = { schemaVersion: 38 };
  migrateBezTripleKeyforms(project);
  assertEq(project, { schemaVersion: 38 }, 'no actions → no-op');
}

// ── action with empty fcurves[] → no-op ────────────────────────────────────
{
  const project = { actions: [{ fcurves: [] }] };
  migrateBezTripleKeyforms(project);
  assertEq(project, { actions: [{ fcurves: [] }] }, 'empty fcurves → no-op');
}

// ── multiple actions × multiple fcurves × multiple keyforms ────────────────
{
  const project = {
    actions: [
      { fcurves: [
        { keyforms: [{ time: 0, value: 0, easing: 'linear' }, { time: 1000, value: 1, easing: 'ease-both' }] },
        { keyforms: [{ time: 0, value: 5, easing: 'hold' }] },
      ]},
      { fcurves: [
        { keyforms: [{ time: 500, value: 0.5, type: 'constant' }] },
      ]},
    ],
  };
  migrateBezTripleKeyforms(project);
  assert(project.actions[0].fcurves[0].keyforms[0].interpolation === 'linear', 'a0.f0.k0 linear');
  assert(project.actions[0].fcurves[0].keyforms[1].interpolation === 'bezier', 'a0.f0.k1 bezier');
  assert(project.actions[0].fcurves[1].keyforms[0].interpolation === 'constant', 'a0.f1.k0 constant');
  assert(project.actions[1].fcurves[0].keyforms[0].interpolation === 'constant', 'a1.f0.k0 constant');
}

// ── malformed keyform (missing time/value) is left untouched ───────────────
{
  const broken = { time: 'not a number', value: 5 };
  const project = { actions: [{ fcurves: [{ keyforms: [broken] }] }] };
  migrateBezTripleKeyforms(project);
  assertEq(project.actions[0].fcurves[0].keyforms[0], broken,
    'malformed keyform left untouched (validation lives elsewhere)');
}

console.log(`migration_v39: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
