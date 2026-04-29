// v3 Phase 0F.35 - tests for src/io/live2d/idle/paramDefaults.js
//
// Idle motion preset registry. Mostly data, but `isImplicitlySkipped`,
// `getPresetTable`, `getParamConfig`, and the structural shape of
// PRESETS / PARAM_DEFAULTS are worth locking in - silent corruption
// of these tables breaks every /idle export.
//
// Run: node scripts/test/test_paramDefaults.mjs

import {
  PRESETS,
  PRESET_NAMES,
  getPresetTable,
  isImplicitlySkipped,
  PERSONALITY_PRESETS,
  PARAM_DEFAULTS,
  getParamConfig,
  IDLE_PARAMS,
  LISTENING_PARAMS,
  TALKING_IDLE_PARAMS,
  EMBARRASSED_HOLD_PARAMS,
} from '../../src/io/live2d/idle/paramDefaults.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── PRESETS structural validation ────────────────────────────────

{
  // Each preset has params + label + description + cycleType
  for (const [name, entry] of Object.entries(PRESETS)) {
    if (typeof entry.label !== 'string') {
      failed++; console.error(`FAIL: PRESETS.${name}.label`); break;
    }
    if (typeof entry.description !== 'string') {
      failed++; console.error(`FAIL: PRESETS.${name}.description`); break;
    }
    if (typeof entry.params !== 'object') {
      failed++; console.error(`FAIL: PRESETS.${name}.params`); break;
    }
    if (entry.cycleType !== 'loop' && entry.cycleType !== 'hold') {
      failed++; console.error(`FAIL: PRESETS.${name}.cycleType`); break;
    }
  }
  passed++;

  // PRESETS is frozen
  assert(Object.isFrozen(PRESETS), 'PRESETS frozen');

  // 4 known presets
  assert('idle' in PRESETS, 'PRESETS contains idle');
  assert('listening' in PRESETS, 'PRESETS contains listening');
  assert('talkingIdle' in PRESETS, 'PRESETS contains talkingIdle');
  assert('embarrassedHold' in PRESETS, 'PRESETS contains embarrassedHold');
}

// ── PRESET_NAMES ─────────────────────────────────────────────────

assert(Array.isArray(PRESET_NAMES), 'PRESET_NAMES is array');
assert(Object.isFrozen(PRESET_NAMES), 'PRESET_NAMES frozen');
assert(PRESET_NAMES.length === Object.keys(PRESETS).length,
  'PRESET_NAMES length matches PRESETS');

// ── getPresetTable ───────────────────────────────────────────────

assert(getPresetTable('idle') === PRESETS.idle, 'getPresetTable: idle');
assert(getPresetTable('listening') === PRESETS.listening,
  'getPresetTable: listening');
assert(getPresetTable('banana') === null,
  'getPresetTable: unknown → null');
assert(getPresetTable('') === null, 'getPresetTable: empty → null');
assert(getPresetTable(null) === null, 'getPresetTable: null → null');

// ── isImplicitlySkipped ─────────────────────────────────────────

assert(isImplicitlySkipped('ParamRotation_neck') === true,
  'skip: ParamRotation_neck');
assert(isImplicitlySkipped('ParamRotation_leftElbow') === true,
  'skip: ParamRotation_leftElbow');
assert(isImplicitlySkipped('ParamRotation_') === true,
  'skip: empty suffix still matches prefix');
assert(isImplicitlySkipped('ParamAngleX') === false,
  'skip: standard param NOT skipped');
assert(isImplicitlySkipped('ParamSmile') === false,
  'skip: variant NOT skipped');
assert(isImplicitlySkipped('') === false, 'skip: empty → false');
assert(isImplicitlySkipped('Rotation_neck') === false,
  'skip: must START with ParamRotation_, not contain');

// ── PERSONALITY_PRESETS ──────────────────────────────────────────

{
  assert(Array.isArray(PERSONALITY_PRESETS), 'PERSONALITY_PRESETS is array');
  for (const p of ['calm', 'energetic', 'tired', 'nervous', 'confident']) {
    if (!PERSONALITY_PRESETS.includes(p)) {
      failed++; console.error(`FAIL: PERSONALITY_PRESETS missing ${p}`); break;
    }
  }
  passed++;
}

// ── PARAM_DEFAULTS backwards-compat alias ────────────────────────

assert(PARAM_DEFAULTS === IDLE_PARAMS,
  'PARAM_DEFAULTS aliases IDLE_PARAMS (backwards-compat)');

// ── getParamConfig ──────────────────────────────────────────────

{
  // Real param from idle preset
  const knownIds = Object.keys(IDLE_PARAMS);
  if (knownIds.length > 0) {
    const first = knownIds[0];
    assert(getParamConfig(first) === IDLE_PARAMS[first],
      `getParamConfig: returns idle entry for ${first}`);
  }

  // Unknown → null
  assert(getParamConfig('NotARealParam') === null,
    'getParamConfig: unknown → null');
  assert(getParamConfig('') === null, 'getParamConfig: empty → null');
}

// ── Each preset's param table has min/max/rest fields ────────────

{
  for (const [name, table] of Object.entries({
    idle: IDLE_PARAMS,
    listening: LISTENING_PARAMS,
    talkingIdle: TALKING_IDLE_PARAMS,
    embarrassedHold: EMBARRASSED_HOLD_PARAMS,
  })) {
    for (const [paramId, def] of Object.entries(table)) {
      if (typeof def.defaultMin !== 'number' ||
          typeof def.defaultMax !== 'number' ||
          typeof def.defaultRest !== 'number') {
        failed++;
        console.error(`FAIL: ${name}.${paramId} missing defaultMin/Max/Rest`);
        break;
      }
      if (def.defaultMin > def.defaultMax) {
        failed++;
        console.error(`FAIL: ${name}.${paramId} defaultMin > defaultMax`);
        break;
      }
    }
  }
  passed++;
}

// ── PRESETS entries reference the right tables (smoke check) ─────

assert(PRESETS.idle.params === IDLE_PARAMS, 'preset idle → IDLE_PARAMS');
assert(PRESETS.listening.params === LISTENING_PARAMS,
  'preset listening → LISTENING_PARAMS');
assert(PRESETS.talkingIdle.params === TALKING_IDLE_PARAMS,
  'preset talkingIdle → TALKING_IDLE_PARAMS');
assert(PRESETS.embarrassedHold.params === EMBARRASSED_HOLD_PARAMS,
  'preset embarrassedHold → EMBARRASSED_HOLD_PARAMS');

console.log(`paramDefaults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
