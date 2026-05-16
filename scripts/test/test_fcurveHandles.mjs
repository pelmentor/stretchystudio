// Slice 2.D — tests for src/anim/fcurveHandles.js
//
// Validates the calchandleNurb_intern port against handcrafted reference
// values derived from the Blender algorithm at curve.cc:3067-3305.
//
// Run: node scripts/test/test_fcurveHandles.mjs

import {
  calcHandleForKeyform,
  recalcKeyformHandles,
  recalcActionHandles,
} from '../../src/anim/fcurveHandles.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function near(actual, expected, eps = 1e-4, name) {
  if (Math.abs(actual - expected) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
}

// ── vector handle: 1/3-way back from keyform toward prev/next ───────────
{
  const prev = { time: 0,   value: 0,   handleType: { left: 'vector', right: 'vector' } };
  const mid  = { time: 100, value: 10,  handleType: { left: 'vector', right: 'vector' } };
  const next = { time: 200, value: 30,  handleType: { left: 'vector', right: 'vector' } };
  calcHandleForKeyform(mid, prev, next);
  // dvec_a = mid - prev = (100, 10); vector-left = mid - dvec_a/3 = (66.667, 6.667)
  near(mid.handleLeft.time,  66.6667, 1e-3, 'vector L: time = mid - dvec_a/3');
  near(mid.handleLeft.value, 6.6667,  1e-3, 'vector L: value = mid - dvec_a/3');
  // dvec_b = next - mid = (100, 20); vector-right = mid + dvec_b/3 = (133.333, 16.667)
  near(mid.handleRight.time,  133.3333, 1e-3, 'vector R: time = mid + dvec_b/3');
  near(mid.handleRight.value, 16.6667,  1e-3, 'vector R: value = mid + dvec_b/3');
}

// ── free/free: no-op, handles untouched ─────────────────────────────────
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 80,  value: 4 },
    handleRight: { time: 120, value: 6 },
  };
  calcHandleForKeyform(kf, null, null);
  assert(kf.handleLeft.time === 80,  'free/free: left.time unchanged');
  assert(kf.handleLeft.value === 4,  'free/free: left.value unchanged');
  assert(kf.handleRight.time === 120, 'free/free: right.time unchanged');
  assert(kf.handleRight.value === 6,  'free/free: right.value unchanged');
}

// ── auto-clamped at extremum: handles flatten + autoHandleType = 'locked_final' ─
{
  // Mid keyform at value=10, neighbours at value=0 → mid is a local max.
  // auto_clamped should flatten both handles to value=10.
  const prev = { time: 0,   value: 0  };
  const mid  = { time: 100, value: 10,
    handleType: { left: 'auto_clamped', right: 'auto_clamped' } };
  const next = { time: 200, value: 0  };
  calcHandleForKeyform(mid, prev, next);
  near(mid.handleLeft.value,  10, 1e-9, 'auto_clamped extremum: L value flattens to keyform value');
  near(mid.handleRight.value, 10, 1e-9, 'auto_clamped extremum: R value flattens to keyform value');
  assert(mid.autoHandleType === 'locked_final',
    'auto_clamped extremum: autoHandleType = locked_final');
}

// ── auto monotonic: handles slope through key, autoHandleType = 'normal' ─
{
  // Straight-line keys 0→10→20, mid is NOT an extremum.
  const prev = { time: 0,   value: 0  };
  const mid  = { time: 100, value: 10,
    handleType: { left: 'auto', right: 'auto' } };
  const next = { time: 200, value: 20 };
  calcHandleForKeyform(mid, prev, next);
  assert(mid.autoHandleType === 'normal', 'auto monotonic: autoHandleType stays normal');
  // For a perfectly-linear key sequence, tvec = (1+1, 0.1+0.1) = (2, 0.2)
  // len_a = len_b = 100; len = tvec[0] * 2.5614 = 5.1228
  // h1 lenAdj = 100/5.1228 = 19.521
  // p2_h1 = (100,10) - (2,0.2) * 19.521 = (60.958, 6.0958)
  // For a linear sequence, the handle should produce a straight line — y stays proportional.
  // Verify by checking handle slope matches the key-to-key slope (0.1):
  const slopeL = (mid.value - mid.handleLeft.value) / (mid.time - mid.handleLeft.time);
  near(slopeL, 0.1, 1e-3, 'auto monotonic: left handle slope matches segment slope');
  const slopeR = (mid.handleRight.value - mid.value) / (mid.handleRight.time - mid.time);
  near(slopeR, 0.1, 1e-3, 'auto monotonic: right handle slope matches segment slope');
}

// ── recalcKeyformHandles: walks the whole array, sets handles for all ──
{
  const keyforms = [
    { time: 0,   value: 0,  handleType: { left: 'auto', right: 'auto' } },
    { time: 100, value: 10, handleType: { left: 'auto', right: 'auto' } },
    { time: 200, value: 5,  handleType: { left: 'auto_clamped', right: 'auto_clamped' } },
    { time: 300, value: 15, handleType: { left: 'auto', right: 'auto' } },
  ];
  recalcKeyformHandles(keyforms);
  // All four keyforms should now have handleLeft + handleRight set.
  for (let i = 0; i < keyforms.length; i++) {
    assert(keyforms[i].handleLeft && typeof keyforms[i].handleLeft.time === 'number',
      `recalc[${i}]: handleLeft populated`);
    assert(keyforms[i].handleRight && typeof keyforms[i].handleRight.time === 'number',
      `recalc[${i}]: handleRight populated`);
  }
  // Endpoints use mirror-synthesised neighbours per curve.cc:3095-3114.
  // The mid auto_clamped key at index 2: neighbours are (10, 15) → value=5
  // is below both → extremum (minimum), should flatten.
  near(keyforms[2].handleLeft.value, 5, 1e-9,
    'recalc: mid auto_clamped extremum (min) flattens left');
  near(keyforms[2].handleRight.value, 5, 1e-9,
    'recalc: mid auto_clamped extremum (min) flattens right');
  assert(keyforms[2].autoHandleType === 'locked_final',
    'recalc: extremum autoHandleType = locked_final');
}

// ── <2 keyforms: no-op ──────────────────────────────────────────────────
{
  // Single keyform — recalc should be a no-op (no segments).
  const single = [{ time: 50, value: 1, handleType: { left: 'auto', right: 'auto' } }];
  recalcKeyformHandles(single);
  // handleLeft/Right may be undefined; the contract is just "don't crash".
  passed++; // implicit: didn't throw
}

// ── endpoint mirroring: first keyform with no prev ──────────────────────
{
  // First keyform should get handles derived from the mirror p1 = 2*p2 - p3.
  const first = { time: 0, value: 0, handleType: { left: 'auto', right: 'auto' } };
  const second = { time: 100, value: 10 };
  calcHandleForKeyform(first, null, second);
  assert(first.handleLeft && first.handleRight,
    'endpoint mirror: handles populated for first keyform');
}

// ── recalcActionHandles: walks every fcurve in an action ────────────────
{
  const action = {
    fcurves: [
      {
        id: 'a',
        keyforms: [
          { time: 0,   value: 0,  handleType: { left: 'auto', right: 'auto' } },
          { time: 100, value: 10, handleType: { left: 'auto', right: 'auto' } },
        ],
      },
      {
        id: 'b',
        keyforms: [
          { time: 0,   value: 0, handleType: { left: 'vector', right: 'vector' } },
          { time: 200, value: 5, handleType: { left: 'vector', right: 'vector' } },
        ],
      },
    ],
  };
  recalcActionHandles(action);
  assert(action.fcurves[0].keyforms[0].handleRight, 'recalcAction: fcurve[0][0] handleRight set');
  assert(action.fcurves[1].keyforms[1].handleLeft,  'recalcAction: fcurve[1][1] handleLeft set');
}

// ── null/malformed: no crash ────────────────────────────────────────────
{
  calcHandleForKeyform(null, null, null); passed++;
  recalcKeyformHandles(null); passed++;
  recalcKeyformHandles([]); passed++;
  recalcActionHandles(null); passed++;
  recalcActionHandles({}); passed++;
  recalcActionHandles({ fcurves: null }); passed++;
}

console.log(`fcurveHandles: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
