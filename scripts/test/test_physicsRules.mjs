// v3 Phase 0F.39 - structural tests for PHYSICS_RULES in
// src/io/live2d/cmo3/physics.js
//
// PHYSICS_RULES is the canonical default physics ruleset that
// drives hair / clothing / bust / arm sway in every export. It's
// a static const, so behavioural tests aren't needed — but a
// structural lock-in catches accidental breakage of the schema
// (missing fields, type drift) when someone tweaks a rule.
//
// Run: node scripts/test/test_physicsRules.mjs

import { PHYSICS_RULES } from '../../src/io/live2d/cmo3/physics.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Top-level shape ──────────────────────────────────────────────

assert(Array.isArray(PHYSICS_RULES), 'is array');
assert(PHYSICS_RULES.length >= 5, 'at least 5 rules (hair / clothing / bust / arms)');

// ── Per-rule structural validation ───────────────────────────────

const ALLOWED_INPUT_TYPES = new Set(['SRC_TO_X', 'SRC_TO_Y', 'SRC_TO_G_ANGLE']);

for (const rule of PHYSICS_RULES) {
  // Required scalar fields
  if (typeof rule.id !== 'string' || rule.id.length === 0) {
    failed++; console.error(`FAIL: rule.id ${JSON.stringify(rule)}`); break;
  }
  if (typeof rule.name !== 'string' || rule.name.length === 0) {
    failed++; console.error(`FAIL: rule.name ${rule.id}`); break;
  }
  if (typeof rule.category !== 'string') {
    failed++; console.error(`FAIL: rule.category ${rule.id}`); break;
  }

  // inputs[]: each has paramId + type + weight
  if (!Array.isArray(rule.inputs) || rule.inputs.length === 0) {
    failed++; console.error(`FAIL: rule.inputs ${rule.id}`); break;
  }
  for (const inp of rule.inputs) {
    if (typeof inp.paramId !== 'string' || !inp.paramId.startsWith('Param')) {
      failed++; console.error(`FAIL: ${rule.id} input.paramId ${inp.paramId}`);
      break;
    }
    if (!ALLOWED_INPUT_TYPES.has(inp.type)) {
      failed++; console.error(`FAIL: ${rule.id} input.type ${inp.type}`);
      break;
    }
    if (typeof inp.weight !== 'number' || inp.weight < 0) {
      failed++; console.error(`FAIL: ${rule.id} input.weight ${inp.weight}`);
      break;
    }
  }

  // vertices[]: each is a pendulum vertex
  if (!Array.isArray(rule.vertices) || rule.vertices.length < 2) {
    failed++; console.error(`FAIL: ${rule.id} needs ≥2 vertices`); break;
  }
  for (const v of rule.vertices) {
    if (typeof v.x !== 'number' || typeof v.y !== 'number') {
      failed++; console.error(`FAIL: ${rule.id} vertex coord`); break;
    }
    if (typeof v.mobility !== 'number' || v.mobility < 0 || v.mobility > 1) {
      failed++; console.error(`FAIL: ${rule.id} vertex.mobility ${v.mobility}`);
      break;
    }
    if (typeof v.delay !== 'number' || v.delay < 0) {
      failed++; console.error(`FAIL: ${rule.id} vertex.delay`); break;
    }
    if (typeof v.acceleration !== 'number') {
      failed++; console.error(`FAIL: ${rule.id} vertex.acceleration`); break;
    }
    if (typeof v.radius !== 'number' || v.radius < 0) {
      failed++; console.error(`FAIL: ${rule.id} vertex.radius`); break;
    }
  }

  // normalization: 6 numeric fields
  const n = rule.normalization;
  if (!n) { failed++; console.error(`FAIL: ${rule.id} normalization missing`); break; }
  for (const k of ['posMin', 'posMax', 'posDef', 'angleMin', 'angleMax', 'angleDef']) {
    if (typeof n[k] !== 'number') {
      failed++; console.error(`FAIL: ${rule.id} normalization.${k}`); break;
    }
  }
  if (n.posMin > n.posMax) {
    failed++; console.error(`FAIL: ${rule.id} normalization.posMin > posMax`);
    break;
  }
  if (n.angleMin > n.angleMax) {
    failed++; console.error(`FAIL: ${rule.id} normalization.angleMin > angleMax`);
    break;
  }
  if (n.posDef < n.posMin || n.posDef > n.posMax) {
    failed++; console.error(`FAIL: ${rule.id} normalization.posDef out of range`);
    break;
  }
  if (n.angleDef < n.angleMin || n.angleDef > n.angleMax) {
    failed++;
    console.error(`FAIL: ${rule.id} normalization.angleDef out of range`);
    break;
  }
}
passed++;

// ── IDs are unique ──────────────────────────────────────────────

{
  const ids = new Set();
  let dup = false;
  for (const r of PHYSICS_RULES) {
    if (ids.has(r.id)) { dup = true; break; }
    ids.add(r.id);
  }
  assert(!dup, 'all rule IDs unique');
}

// ── Each rule names something useful ────────────────────────────

{
  // Look for the canonical Hiyori setup: at least one hair / clothing
  // /  arm rule should be present.
  const categories = new Set(PHYSICS_RULES.map(r => r.category));
  assert(categories.has('hair'), 'has at least one hair rule');
  assert(categories.size >= 2, 'has multiple categories');
}

// ── Output: either flat outputs[] or boneOutputs (resolved later) ──

for (const rule of PHYSICS_RULES) {
  const hasFlat = Array.isArray(rule.outputs) && rule.outputs.length > 0;
  const hasBone = Array.isArray(rule.boneOutputs) && rule.boneOutputs.length > 0;
  const hasOutputParam = typeof rule.outputParamId === 'string';
  if (!hasFlat && !hasBone && !hasOutputParam) {
    failed++;
    console.error(`FAIL: ${rule.id} no outputs, boneOutputs, or outputParamId`);
    break;
  }
}
passed++;

console.log(`physicsRules: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
