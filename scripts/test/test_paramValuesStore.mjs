// v3 Phase 0F.17 - tests for src/store/paramValuesStore.js
// Run: node scripts/test/test_paramValuesStore.mjs

import { useParamValuesStore } from '../../src/store/paramValuesStore.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function get() { return useParamValuesStore.getState(); }

function reset() { get().reset(); }

// ── Initial empty ──────────────────────────────────────────────────

reset();
{
  const s = get();
  assert(typeof s.values === 'object' && s.values !== null, 'values is object');
  assert(Object.keys(s.values).length === 0, 'values starts empty');
}

// ── setParamValue ──────────────────────────────────────────────────

{
  reset();
  get().setParamValue('ParamX', 5);
  assert(get().values.ParamX === 5, 'setParamValue: writes value');

  get().setParamValue('ParamY', 7);
  assert(get().values.ParamX === 5 && get().values.ParamY === 7,
    'setParamValue: preserves prior keys');

  // Updating returns a NEW values reference (so consumers re-render)
  const before = get().values;
  get().setParamValue('ParamX', 99);
  assert(get().values !== before, 'setParamValue: fresh values reference');
  assert(get().values.ParamX === 99, 'setParamValue: overwrites existing');
}

// ── setMany ────────────────────────────────────────────────────────

{
  reset();
  get().setMany({ A: 1, B: 2 });
  assert(get().values.A === 1 && get().values.B === 2, 'setMany: writes multiple');

  // setMany merges with existing
  get().setMany({ B: 99, C: 3 });
  assert(get().values.A === 1, 'setMany: preserves untouched keys');
  assert(get().values.B === 99, 'setMany: overwrites existing keys');
  assert(get().values.C === 3, 'setMany: adds new keys');

  // Empty update is a no-op (functionally) but still a fresh ref
  const before = get().values;
  get().setMany({});
  assert(get().values !== before, 'setMany: fresh reference even on no-op');
}

// ── resetToDefaults ───────────────────────────────────────────────

{
  reset();
  get().setMany({ A: 99, B: 99 });
  get().resetToDefaults([
    { id: 'A', default: 1 },
    { id: 'B' },              // missing default → 0
    { id: 'C', default: 5 },  // not previously set
  ]);
  assert(get().values.A === 1, 'resetToDefaults: A → its default');
  assert(get().values.B === 0, 'resetToDefaults: missing default → 0');
  assert(get().values.C === 5, 'resetToDefaults: adds new param at default');
  // Prior keys NOT in the spec are wiped (reset replaces everything)
  get().setParamValue('Stale', 999);
  get().resetToDefaults([{ id: 'A', default: 1 }]);
  assert(!('Stale' in get().values), 'resetToDefaults: drops keys not in spec');
}

{
  reset();
  // null / undefined parameters → empty values
  get().resetToDefaults(null);
  assert(Object.keys(get().values).length === 0, 'resetToDefaults: null → empty');
  get().setMany({ A: 1 });
  get().resetToDefaults(undefined);
  assert(Object.keys(get().values).length === 0, 'resetToDefaults: undefined → empty');
}

// ── reset ──────────────────────────────────────────────────────────

{
  get().setMany({ A: 1, B: 2 });
  get().reset();
  assert(Object.keys(get().values).length === 0, 'reset: wipes everything');
}

console.log(`paramValuesStore: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
