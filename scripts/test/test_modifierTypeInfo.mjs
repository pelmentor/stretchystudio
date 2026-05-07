// Phase D-3a — modifierTypeInfo registry tests.
//
// Pins:
//   - Registry shape (warp + rotation entries, deformVerts callable).
//   - isModifierEnabled() truth table across mode bitmask + enabled flag.
//   - **Audit Gap C**: MODE_RENDER-only modifier is skipped in viewport
//     (REALTIME) but applied on export (RENDER).
//
// Run: node scripts/test/test_modifierTypeInfo.mjs

import {
  MODIFIER_TYPES,
  isModifierEnabled,
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
  MODIFIER_MODE_EDITMODE,
} from '../../src/anim/modifierTypeInfo.js';

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
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// ---- Registry shape ----

assert(MODIFIER_TYPES.warp != null, 'registry: warp entry');
assert(MODIFIER_TYPES.rotation != null, 'registry: rotation entry');
assertEq(typeof MODIFIER_TYPES.warp.deformVerts, 'function',
  'registry: warp.deformVerts is function');
assertEq(typeof MODIFIER_TYPES.rotation.deformVerts, 'function',
  'registry: rotation.deformVerts is function');
assertEq(MODIFIER_TYPES.warp.name, 'Warp', 'warp.name');
assertEq(MODIFIER_TYPES.rotation.name, 'Rotation', 'rotation.name');

// ---- isModifierEnabled — null + missing ----

assertEq(isModifierEnabled(null, MODIFIER_MODE_REALTIME), false,
  'isEnabled(null) = false');
assertEq(isModifierEnabled(undefined, MODIFIER_MODE_REALTIME), false,
  'isEnabled(undefined) = false');

// ---- enabled flag gates everything ----

{
  const mod = { mode: MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER, enabled: false };
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_REALTIME), false,
    'enabled:false → REALTIME blocked');
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_RENDER), false,
    'enabled:false → RENDER blocked');
}

// ---- Mode bitmask truth table ----

{
  // REALTIME-only modifier.
  const mod = { mode: MODIFIER_MODE_REALTIME, enabled: true };
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_REALTIME), true,
    'REALTIME-only allows REALTIME');
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_RENDER), false,
    'REALTIME-only blocks RENDER');
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_EDITMODE), false,
    'REALTIME-only blocks EDITMODE');
}

{
  // RENDER-only — Audit Gap C pin.
  const mod = { mode: MODIFIER_MODE_RENDER, enabled: true };
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_REALTIME), false,
    'AUDIT-GAP-C: RENDER-only is SKIPPED in viewport (REALTIME)');
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_RENDER), true,
    'AUDIT-GAP-C: RENDER-only is APPLIED on export (RENDER)');
}

{
  // Default (REALTIME|RENDER).
  const mod = {
    mode: MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER, enabled: true,
  };
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_REALTIME), true,
    'REALTIME|RENDER allows REALTIME');
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_RENDER), true,
    'REALTIME|RENDER allows RENDER');
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_EDITMODE), false,
    'REALTIME|RENDER blocks EDITMODE');
}

// ---- Missing mode field falls back to v21 default ----

{
  // A pre-v21 record with no `mode` field. isEnabled treats this as
  // (REALTIME|RENDER) — matches v21 migration's DEFAULT_MIGRATED_MODE.
  const mod = { enabled: true }; // mode missing
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_REALTIME), true,
    'missing mode → defaults to REALTIME enabled');
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_RENDER), true,
    'missing mode → defaults to RENDER enabled');
  assertEq(isModifierEnabled(mod, MODIFIER_MODE_EDITMODE), false,
    'missing mode → defaults to EDITMODE disabled (matches v21 default)');
}

// ---- deformVerts return shape (D-3b: {positions, isCanvasFinal}) ----

{
  // Empty outputs map → no lifted grid + no key state → fallback returns
  // input positions unchanged with isCanvasFinal=false.
  const mod = { type: 'warp', deformerId: 'foo', enabled: true };
  const positions = new Float32Array([1, 2, 3, 4]);
  const result = MODIFIER_TYPES.warp.deformVerts(
    mod,
    /** @type {any} */ ({ project: {}, outputs: new Map() }),
    {}, positions,
  );
  assertEq(result.isCanvasFinal, false,
    'no lifted grid + no key state → isCanvasFinal=false');
  assert(result.positions === positions,
    'no lifted grid + no key state → positions pass-through (no copy)');
}

{
  // Rotation modifier with no MATRIX_BUILD output → pass-through.
  const mod = { type: 'rotation', deformerId: 'rot', enabled: true };
  const positions = new Float32Array([10, 20, 30, 40]);
  const result = MODIFIER_TYPES.rotation.deformVerts(
    mod,
    /** @type {any} */ ({ project: {}, outputs: new Map() }),
    {}, positions,
  );
  assertEq(result.isCanvasFinal, false,
    'rotation: no matrix → isCanvasFinal=false');
  assert(result.positions === positions,
    'rotation: no matrix → positions pass-through');
}

// ---- Result ----

console.log(`modifierTypeInfo: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
