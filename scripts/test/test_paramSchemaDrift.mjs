// Hole I-2 — binding-vs-param schema drift detection.
//
// Properties verified:
//   1. Sync project (binding.keys === param.keys, in range) → no drift.
//   2. Mismatched keys (different length) → 'keys-mismatch'.
//   3. Mismatched keys (same length, different values) → 'keys-mismatch'.
//   4. In-range mismatch detected; out-of-range also detected.
//   5. Out-of-range only (keys match length+values within range, but
//      max > param.max) → 'out-of-range'.
//   6. Dangling parameterId (binding refs a deleted param) → SKIPPED
//      (paramReferences.js / Hole I-3 handles that case).
//   7. No-keys param (some legacy params) → no false positive.
//   8. Multiple bindings, mixed drift states → all reported correctly.
//
// Run: node scripts/test/test_paramSchemaDrift.mjs

import { findBindingSchemaDrift } from '../../src/io/live2d/rig/paramSchemaDrift.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function makeProject({ paramKeys = [-30, 0, 30], paramRange = { min: -30, max: 30 }, bindings = [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30] }] } = {}) {
  return {
    parameters: [
      { id: 'ParamAngleZ', name: 'AngleZ', min: paramRange.min, max: paramRange.max, default: 0, keys: paramKeys },
    ],
    nodes: [
      {
        id: 'd1', type: 'deformer', deformerKind: 'warp',
        bindings,
      },
    ],
  };
}

// ── Test 1: synced project — no drift ──
{
  const drift = findBindingSchemaDrift(makeProject());
  assert(drift.length === 0, `Test 1: synced project → empty drift (got ${drift.length})`);
}

// ── Test 2: mismatched keys (different length) ──
{
  const drift = findBindingSchemaDrift(makeProject({
    paramKeys: [-30, 0, 30],
    bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 15, 30] }],
  }));
  assert(drift.length === 1, `Test 2: 1 drift entry (got ${drift.length})`);
  assert(drift[0]?.kinds.includes('keys-mismatch'), `Test 2: kind keys-mismatch flagged`);
}

// ── Test 3: mismatched keys (same length, different values) ──
{
  const drift = findBindingSchemaDrift(makeProject({
    paramKeys: [-45, 0, 45],
    paramRange: { min: -45, max: 45 },
    bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30] }],
  }));
  assert(drift.length === 1, `Test 3: 1 drift entry`);
  assert(drift[0]?.kinds.includes('keys-mismatch'), `Test 3: keys-mismatch flagged on value drift`);
}

// ── Test 4: in-range mismatch + out-of-range ──
{
  // Param shrunk to ±15, bindings still on ±30 → both kinds.
  const drift = findBindingSchemaDrift(makeProject({
    paramKeys: [-15, 0, 15],
    paramRange: { min: -15, max: 15 },
    bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30] }],
  }));
  assert(drift.length === 1, `Test 4: 1 drift entry`);
  assert(drift[0]?.kinds.includes('keys-mismatch'), `Test 4: keys-mismatch flagged`);
  assert(drift[0]?.kinds.includes('out-of-range'), `Test 4: out-of-range flagged`);
}

// ── Test 5: out-of-range only (keys match value-wise but param.max shrunk) ──
{
  // Note: if binding.keys = param.keys, keys-mismatch can't fire. Only
  // possible to get out-of-range alone if param.max < max(binding.keys)
  // AND param.keys still contains those keys. Edge case: param.keys is
  // [-30, 0, 30] but param.range is [-20, 20] (inconsistent). Synthesize
  // that case directly.
  const project = {
    parameters: [{ id: 'ParamAngleZ', min: -20, max: 20, keys: [-30, 0, 30], default: 0 }],
    nodes: [{ id: 'd1', type: 'deformer', deformerKind: 'warp',
              bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30] }] }],
  };
  const drift = findBindingSchemaDrift(project);
  assert(drift.length === 1, `Test 5: 1 drift entry`);
  assert(!drift[0]?.kinds.includes('keys-mismatch'), `Test 5: keys-mismatch NOT flagged (sync values)`);
  assert(drift[0]?.kinds.includes('out-of-range'), `Test 5: out-of-range flagged on shrunk range`);
}

// ── Test 6: dangling parameterId — skipped ──
{
  const project = {
    parameters: [],
    nodes: [{ id: 'd1', type: 'deformer', deformerKind: 'warp',
              bindings: [{ parameterId: 'ParamGhost', keys: [-30, 0, 30] }] }],
  };
  const drift = findBindingSchemaDrift(project);
  assert(drift.length === 0, `Test 6: dangling param skipped (paramReferences I-3 owns it; got ${drift.length})`);
}

// ── Test 7: param with no keys array — no drift reported ──
{
  // Some legacy params don't carry their own `keys` array. Don't false-
  // positive against them.
  const project = {
    parameters: [{ id: 'ParamX', min: 0, max: 1, default: 0 }],  // no keys
    nodes: [{ id: 'd1', type: 'deformer', deformerKind: 'warp',
              bindings: [{ parameterId: 'ParamX', keys: [0, 1] }] }],
  };
  const drift = findBindingSchemaDrift(project);
  assert(drift.length === 0, `Test 7: param without keys array → no drift (got ${drift.length})`);
}

// ── Test 8: multiple bindings, mixed drift ──
{
  const project = {
    parameters: [
      { id: 'ParamA', min: -30, max: 30, keys: [-30, 0, 30], default: 0 },
      { id: 'ParamB', min: -10, max: 10, keys: [-10, 0, 10], default: 0 },
      { id: 'ParamC', min: 0,   max: 1,  keys: [0, 1],       default: 0 },
    ],
    nodes: [
      { id: 'd1', type: 'deformer', deformerKind: 'warp', bindings: [
        { parameterId: 'ParamA', keys: [-30, 0, 30] },     // sync
        { parameterId: 'ParamB', keys: [-15, 0, 15] },     // out-of-range + keys-mismatch
        { parameterId: 'ParamC', keys: [0, 1] },           // sync
      ]},
      { id: 'd2', type: 'deformer', deformerKind: 'rotation', bindings: [
        { parameterId: 'ParamA', keys: [-45, 0, 45] },     // out-of-range + keys-mismatch
      ]},
    ],
  };
  const drift = findBindingSchemaDrift(project);
  assert(drift.length === 2, `Test 8: 2 drift entries (got ${drift.length})`);
  const d1B = drift.find((d) => d.deformerId === 'd1' && d.bindingIndex === 1);
  const d2A = drift.find((d) => d.deformerId === 'd2' && d.bindingIndex === 0);
  assert(d1B != null, `Test 8: d1[binding 1] reported`);
  assert(d2A != null, `Test 8: d2[binding 0] reported`);
  assert(d1B?.kinds.includes('out-of-range'), `Test 8: d1[1] out-of-range`);
  assert(d2A?.kinds.includes('out-of-range'), `Test 8: d2[0] out-of-range`);
}

// ── Test 9: report payload shape ──
{
  const drift = findBindingSchemaDrift(makeProject({
    paramKeys: [-15, 0, 15],
    paramRange: { min: -15, max: 15 },
    bindings: [{ parameterId: 'ParamAngleZ', keys: [-30, 0, 30] }],
  }));
  const d = drift[0];
  assert(d.deformerId === 'd1', `Test 9: deformerId surfaced`);
  assert(d.bindingIndex === 0, `Test 9: bindingIndex surfaced`);
  assert(d.parameterId === 'ParamAngleZ', `Test 9: parameterId surfaced`);
  assert(Array.isArray(d.bindingKeys) && d.bindingKeys.length === 3, `Test 9: bindingKeys array`);
  assert(Array.isArray(d.paramKeys) && d.paramKeys.length === 3, `Test 9: paramKeys array`);
  assert(d.paramRange?.min === -15 && d.paramRange?.max === 15, `Test 9: paramRange surfaced`);
}

console.log(`\nparamSchemaDrift: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
