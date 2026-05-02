// Phase 5 — preferencesStore unit tests.
//
// Covers user-global persistence flags + Phase B additions:
//   - mlEnabled (boolean toggle, localStorage-backed)
//   - proportionalEdit (object preset, GAP-015 Phase B)
//   - viewLayerPresets (named-preset dict, GAP-016 Phase B)
//
// The store loads from localStorage on first access and write-throughs
// on every setter. In Node these tests run with a mock localStorage so
// we can verify both the in-memory state AND the persisted shape.
//
// Run: node scripts/test/test_preferencesStore.mjs

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── localStorage mock ────────────────────────────────────────────────
// Has to be installed BEFORE importing the store; the store reads
// localStorage at module-load time. globalThis works in Node 18+.
const _store = new Map();
globalThis.localStorage = {
  getItem(k) { return _store.has(k) ? _store.get(k) : null; },
  setItem(k, v) { _store.set(k, String(v)); },
  removeItem(k) { _store.delete(k); },
  clear() { _store.clear(); },
};

const { usePreferencesStore } = await import('../../src/store/preferencesStore.js');

function get() { return usePreferencesStore.getState(); }

// ── Initial state ──────────────────────────────────────────────────
{
  const s = get();
  assert(s.mlEnabled === true, 'initial: mlEnabled defaults to true (back-compat)');
  assert(s.proportionalEdit && s.proportionalEdit.enabled === false,
    'initial: proportionalEdit.enabled defaults to false');
  assert(s.proportionalEdit.radius === 100,
    'initial: proportionalEdit.radius defaults to 100');
  assert(s.proportionalEdit.falloff === 'smooth',
    'initial: proportionalEdit.falloff defaults to smooth');
  assert(s.proportionalEdit.connectedOnly === false,
    'initial: proportionalEdit.connectedOnly defaults to false');
  assert(s.viewLayerPresets && Object.keys(s.viewLayerPresets).length === 0,
    'initial: viewLayerPresets defaults to empty');
}

// ── setMlEnabled writes through to localStorage ────────────────────
{
  get().setMlEnabled(false);
  assert(get().mlEnabled === false, 'setMlEnabled(false): in-memory updated');
  assert(_store.get('v3.prefs.mlEnabled') === 'false',
    'setMlEnabled(false): localStorage written');
  get().setMlEnabled(true);
  assert(get().mlEnabled === true, 'setMlEnabled(true): in-memory updated');
}

// ── setProportionalEdit: partial merge + persist ───────────────────
{
  get().setProportionalEdit({ enabled: true, radius: 250 });
  const s = get().proportionalEdit;
  assert(s.enabled === true, 'setProportionalEdit: enabled updated');
  assert(s.radius === 250, 'setProportionalEdit: radius updated');
  // Other fields preserved (partial merge).
  assert(s.falloff === 'smooth', 'setProportionalEdit: falloff preserved');
  assert(s.connectedOnly === false, 'setProportionalEdit: connectedOnly preserved');
  // Persisted shape includes ALL fields, not just the updated ones.
  const persisted = JSON.parse(_store.get('v3.prefs.proportionalEdit'));
  assert(persisted.enabled === true && persisted.radius === 250
    && persisted.falloff === 'smooth' && persisted.connectedOnly === false,
    'setProportionalEdit: localStorage carries full shape after partial update');

  get().setProportionalEdit({ falloff: 'sphere', connectedOnly: true });
  assert(get().proportionalEdit.falloff === 'sphere',
    'setProportionalEdit: second partial update merges with prior');
  assert(get().proportionalEdit.connectedOnly === true,
    'setProportionalEdit: connectedOnly toggled');
  // Earlier-set fields still present.
  assert(get().proportionalEdit.radius === 250,
    'setProportionalEdit: radius preserved across two updates');
}

// ── setViewLayerPreset: named save + apply ─────────────────────────
{
  const layers1 = {
    image: true, wireframe: true, vertices: true, edgeOutline: true,
    skeleton: false, irisClipping: true, warpGrids: false, rotationPivots: false,
  };
  get().setViewLayerPreset('My Modeling', layers1);
  assert('My Modeling' in get().viewLayerPresets,
    'setViewLayerPreset: name registered');
  const stored = get().viewLayerPresets['My Modeling'];
  assert(stored.wireframe === true && stored.vertices === true && stored.skeleton === false,
    'setViewLayerPreset: layers saved verbatim');
  // Persisted as JSON.
  const persisted = JSON.parse(_store.get('v3.prefs.viewLayerPresets'));
  assert(persisted['My Modeling']?.wireframe === true,
    'setViewLayerPreset: localStorage written');

  // Empty / whitespace name = no-op.
  const before = JSON.stringify(get().viewLayerPresets);
  get().setViewLayerPreset('', layers1);
  get().setViewLayerPreset('   ', layers1);
  assert(JSON.stringify(get().viewLayerPresets) === before,
    'setViewLayerPreset: empty / whitespace name no-op');

  // Names trimmed before storage.
  get().setViewLayerPreset('  Trimmed  ', layers1);
  assert('Trimmed' in get().viewLayerPresets,
    'setViewLayerPreset: name trimmed before storage');

  // Overwrite-on-conflict.
  const layers2 = { ...layers1, wireframe: false };
  get().setViewLayerPreset('My Modeling', layers2);
  assert(get().viewLayerPresets['My Modeling'].wireframe === false,
    'setViewLayerPreset: overwrites existing name');
}

// ── deleteViewLayerPreset ──────────────────────────────────────────
{
  get().deleteViewLayerPreset('My Modeling');
  assert(!('My Modeling' in get().viewLayerPresets),
    'deleteViewLayerPreset: name removed');
  // Persisted shape reflects the delete.
  const persisted = JSON.parse(_store.get('v3.prefs.viewLayerPresets'));
  assert(!('My Modeling' in persisted),
    'deleteViewLayerPreset: localStorage updated');
  // No-op for unknown names.
  const before = JSON.stringify(get().viewLayerPresets);
  get().deleteViewLayerPreset('definitely_not_a_preset');
  assert(JSON.stringify(get().viewLayerPresets) === before,
    'deleteViewLayerPreset: unknown name no-op');
}

// ── lockObjectModes (Blender's Lock Object Modes preference) ──────
{
  // Default is true (matches Blender behaviour).
  // Already loaded fresh at top — assert default and exercise setter.
  const initial = get().lockObjectModes;
  assert(typeof initial === 'boolean', 'lockObjectModes: type bool');

  get().setLockObjectModes(false);
  assert(get().lockObjectModes === false, 'setLockObjectModes(false): stored');
  assert(_store.get('v3.prefs.lockObjectModes') === 'false',
    'setLockObjectModes: persisted to localStorage');

  get().setLockObjectModes(true);
  assert(get().lockObjectModes === true, 'setLockObjectModes(true): stored');

  // Coerces non-bool inputs (mirror setMlEnabled)
  get().setLockObjectModes(0);
  assert(get().lockObjectModes === false, 'setLockObjectModes(0): coerced to false');
  get().setLockObjectModes('on');
  assert(get().lockObjectModes === true, 'setLockObjectModes("on"): coerced to true');
}

// ── lastToolByMode: persistence per editMode ──────────────────────
{
  // Default shape includes one entry per known editMode key.
  const ltm = get().lastToolByMode;
  assert(ltm && ltm.object === 'select', 'lastToolByMode: object → select default');
  assert(ltm.mesh === 'brush',           'lastToolByMode: mesh → brush default');
  assert(ltm.skeleton === 'joint_drag',  'lastToolByMode: skeleton → joint_drag default');
  assert(ltm.blendShape === 'brush',     'lastToolByMode: blendShape → brush default');

  // setLastToolForMode merges, persists, in-memory updated.
  get().setLastToolForMode('mesh', 'add_vertex');
  assert(get().lastToolByMode.mesh === 'add_vertex',
    'setLastToolForMode: mesh updated to add_vertex');
  assert(get().lastToolByMode.object === 'select',
    'setLastToolForMode: untouched modes preserved');
  const persisted = JSON.parse(_store.get('v3.prefs.lastToolByMode'));
  assert(persisted.mesh === 'add_vertex' && persisted.object === 'select',
    'setLastToolForMode: localStorage carries full shape');

  // Identical write is a no-op (Zustand short-circuit).
  const beforeRef = get().lastToolByMode;
  get().setLastToolForMode('mesh', 'add_vertex');
  assert(get().lastToolByMode === beforeRef,
    'setLastToolForMode: identical value preserves identity');

  // Defensive guards: non-string args are rejected.
  get().setLastToolForMode(null, 'brush');
  get().setLastToolForMode('mesh', 42);
  assert(get().lastToolByMode.mesh === 'add_vertex',
    'setLastToolForMode: malformed args ignored');
}

// ── Persistence survives across hypothetical reloads (re-import) ───
// We can't re-import the same module with a fresh load, but we can
// verify the localStorage shape is what a future load would consume.
{
  // Reset store to a known shape, persist, re-read raw.
  get().setProportionalEdit({ enabled: false, radius: 75, falloff: 'linear', connectedOnly: false });
  get().setViewLayerPreset('Persisted', {
    image: true, wireframe: false, vertices: false, edgeOutline: true,
    skeleton: true, irisClipping: true, warpGrids: false, rotationPivots: false,
  });
  const peRaw = JSON.parse(_store.get('v3.prefs.proportionalEdit'));
  const vlpRaw = JSON.parse(_store.get('v3.prefs.viewLayerPresets'));
  assert(peRaw.radius === 75 && peRaw.falloff === 'linear',
    'persistence: proportionalEdit roundtrips');
  assert(vlpRaw.Persisted?.skeleton === true,
    'persistence: viewLayerPresets roundtrip');
}

console.log(`\npreferencesStore: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
