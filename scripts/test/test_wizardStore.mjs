// GAP-001 — wizardStore unit tests.
//
// Covers the PSD wizard's lifecycle data layer: pendingPsd /
// step / preImportSnapshot / meshAllParts setters + reset +
// patchPendingPsd merge semantics.
//
// Run: node scripts/test/test_wizardStore.mjs

import { useWizardStore } from '../../src/store/wizardStore.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function get() { return useWizardStore.getState(); }

// Reset before each block — each test gets a clean store.
function reset() {
  useWizardStore.setState({
    pendingPsd: null,
    step: null,
    preImportSnapshot: null,
    meshAllParts: true,
  });
}

// ── Initial state ──────────────────────────────────────────────────
{
  reset();
  const s = get();
  assert(s.pendingPsd === null, 'initial: pendingPsd null');
  assert(s.step === null, 'initial: step null');
  assert(s.preImportSnapshot === null, 'initial: preImportSnapshot null');
  assert(s.meshAllParts === true, 'initial: meshAllParts defaults to true');
}

// ── setPendingPsd / setStep ───────────────────────────────────────
{
  reset();
  const psd = { psdW: 800, psdH: 1024, layers: [], partIds: [] };
  get().setPendingPsd(psd);
  get().setStep('review');
  assert(get().pendingPsd === psd, 'setPendingPsd: stored');
  assert(get().step === 'review', 'setStep: stored');
}

// ── setPreImportSnapshot ──────────────────────────────────────────
{
  reset();
  const snap = JSON.stringify({ nodes: [{ id: 'a' }] });
  get().setPreImportSnapshot(snap);
  assert(get().preImportSnapshot === snap, 'setPreImportSnapshot: stored');
  get().setPreImportSnapshot(null);
  assert(get().preImportSnapshot === null, 'setPreImportSnapshot(null): cleared');
}

// ── setMeshAllParts coerces to boolean ─────────────────────────────
{
  reset();
  get().setMeshAllParts(true);
  assert(get().meshAllParts === true, 'setMeshAllParts(true): true');
  get().setMeshAllParts(false);
  assert(get().meshAllParts === false, 'setMeshAllParts(false): false');
  get().setMeshAllParts(0);
  assert(get().meshAllParts === false, 'setMeshAllParts(0): coerces to false');
  get().setMeshAllParts('yes');
  assert(get().meshAllParts === true, 'setMeshAllParts("yes"): coerces to true');
}

// ── patchPendingPsd: merges fields ─────────────────────────────────
{
  reset();
  const psd = { psdW: 800, psdH: 1024, layers: ['a'], partIds: ['p1'] };
  get().setPendingPsd(psd);
  get().patchPendingPsd({ layers: ['a', 'b'], partIds: ['p1', 'p2'] });
  const cur = get().pendingPsd;
  assert(cur.psdW === 800 && cur.psdH === 1024,
    'patchPendingPsd: dimensions preserved');
  assert(cur.layers.length === 2 && cur.partIds.length === 2,
    'patchPendingPsd: arrays replaced');
  // Patch is a no-op if no pendingPsd exists.
  get().setPendingPsd(null);
  get().patchPendingPsd({ layers: ['x'] });
  assert(get().pendingPsd === null,
    'patchPendingPsd: no-op when pendingPsd is null');
}

// ── reset clears everything ────────────────────────────────────────
{
  reset();
  get().setPendingPsd({ psdW: 1, psdH: 1, layers: [], partIds: [] });
  get().setStep('adjust');
  get().setPreImportSnapshot('snap');
  get().setMeshAllParts(false);
  get().reset();
  const s = get();
  assert(s.pendingPsd === null, 'reset: pendingPsd null');
  assert(s.step === null, 'reset: step null');
  assert(s.preImportSnapshot === null, 'reset: preImportSnapshot null');
  assert(s.meshAllParts === true, 'reset: meshAllParts back to true');
}

console.log(`\nwizardStore: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
