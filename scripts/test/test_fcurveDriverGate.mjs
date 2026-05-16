// @ts-check
/**
 * Animation Phase 5 Slice 5.D -- driver-gate helpers.
 *
 * Verifies `hasDriver` + `clearDriver` from `src/anim/driverGate.js`
 * which sit underneath the FCurveEditor's edit-disabled gate. The
 * editor-level integration (pointer-down bail, operator skip, banner
 * render) is browser-only and not assertion-tested here; this module
 * covers the pure substrate so the gate is auditable in isolation.
 */

import { hasDriver, clearDriver } from '../../src/anim/driverGate.js';
import { evaluateDriver } from '../../src/anim/driver.js';
import { evaluateFCurve } from '../../src/anim/fcurve.js';

let passed = 0;
let failed = 0;

function eq(actual, expected, label) {
  const ok = actual === expected;
  if (ok) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function approx(actual, expected, tol, label) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
}

// ── hasDriver: null/undefined-safe ─────────────────────────────────────
eq(hasDriver(null),      false, 'hasDriver(null)');
eq(hasDriver(undefined), false, 'hasDriver(undefined)');
eq(hasDriver({}),        false, 'hasDriver({})');

// ── hasDriver: falsy `driver` values are also "no driver" ──────────────
eq(hasDriver({ driver: null }),      false, 'hasDriver({driver:null})');
eq(hasDriver({ driver: undefined }), false, 'hasDriver({driver:undefined})');
eq(hasDriver({ driver: 0 }),         false, 'hasDriver({driver:0})');

// ── hasDriver: any truthy `driver` is "driven" (even an empty object) ──
eq(hasDriver({ driver: {} }),                              true, 'hasDriver(empty driver object)');
eq(hasDriver({ driver: { type: 'scripted' } }),            true, 'hasDriver(scripted driver, no expr)');
eq(hasDriver({ driver: { type: 'sum', variables: [] } }),  true, 'hasDriver(sum driver, empty vars)');

// ── clearDriver: removes when present ──────────────────────────────────
{
  const fc = { id: 'x', driver: { type: 'scripted', expression: '1', variables: [] } };
  const removed = clearDriver(fc);
  eq(removed, true, 'clearDriver returns true on removal');
  eq('driver' in fc, false, 'fcurve.driver field gone after clearDriver');
}

// ── clearDriver: idempotent no-op when absent ──────────────────────────
{
  const fc = { id: 'y', keyforms: [{ time: 0, value: 5 }] };
  const removed = clearDriver(fc);
  eq(removed, false, 'clearDriver returns false when no driver');
  eq(fc.id, 'y', 'fcurve untouched');
  eq(fc.keyforms.length, 1, 'fcurve.keyforms untouched');
}

// ── clearDriver: null/undefined-safe ───────────────────────────────────
eq(clearDriver(null),      false, 'clearDriver(null)');
eq(clearDriver(undefined), false, 'clearDriver(undefined)');

// ── Round-trip: driven curve evaluates to driver output, clearing
//    reveals the underlying keyform value (the WHOLE point of the
//    edit-disabled gate -- keyforms are masked while the driver is up).
{
  const project = { nodes: [], parameters: [] };
  const fc = {
    id: 'fc-driven',
    rnaPath: '',
    keyforms: [
      { time: 0,    value: 10 },
      { time: 1000, value: 20 },
    ],
    driver: { type: 'scripted', expression: '42', variables: [] },
  };
  // With driver attached: evaluateFCurve returns the driver output, not
  // the lerp between 10 and 20.
  approx(evaluateFCurve(fc, 500, { project }), 42, 1e-9, 'driven curve overrides keyforms');
  // Direct driver eval matches.
  approx(evaluateDriver(fc.driver, { project }), 42, 1e-9, 'evaluateDriver(scripted constant)');
  // Clear the driver -> the same time samples the keyforms.
  eq(clearDriver(fc), true, 'clearDriver succeeds');
  approx(evaluateFCurve(fc, 500, { project }), 15, 0.5, 'after clearDriver, keyforms drive eval');
  eq(hasDriver(fc), false, 'hasDriver false after clear');
}

console.log(`\n${passed} passed / ${failed} failed`);
if (failed > 0) process.exit(1);
