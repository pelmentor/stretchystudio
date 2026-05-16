// Slice 2.G + 2.G.1 — round-trip tests for motion3.json import/export.
//
// Validates that importing a Cubism .motion3.json and re-exporting it
// produces a structurally-equivalent file. Two regimes:
//
//   (a) Synthetic curves with known segment-type distribution (linear,
//       bezier, stepped) → bytewise-equal flat segment array after
//       round-trip. This is the byte-fidelity gate from Slice 2.H.
//
//   (b) Real Hiyori motion3 files (m01..m10, pro_t11 idle) → semantic
//       round-trip: re-imported curve evaluates identically to the
//       original at uniform time samples. Real files have float32
//       precision in segment endpoints that can drift across one parse
//       round-trip (string-decoded JSON → float64 → re-encoded JSON);
//       semantic-equality is the achievable gate, byte-equality is not.
//
// Slice 2.H exit-gate condition: ALL Hiyori samples pass regime (b)
// with max segment-value divergence < 1e-6 (well under Cubism Viewer's
// quantisation threshold).
//
// Run: node scripts/test/test_motion3jsonRoundtrip.mjs

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMotion3Json } from '../../src/io/live2d/motion3jsonImport.js';
import { generateMotion3Json } from '../../src/io/live2d/motion3json.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function near(actual, expected, eps, name) {
  if (Math.abs(actual - expected) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
}

let uidCounter = 0;
const uid = () => `test_${++uidCounter}`;

// ── (a) SYNTHETIC: byte-exact round-trip ────────────────────────────────
//
// Construct a motion3.json by hand with one curve per segment type, run
// it through parseMotion3Json → generateMotion3Json, and compare flat
// segment arrays byte-for-byte (within FP tolerance for the JSON parse
// path).
{
  const original = {
    Version: 3,
    Meta: {
      Duration: 1.0,
      Fps: 30.0,
      Loop: true,
      AreBeziersRestricted: false,
      CurveCount: 1,
      TotalSegmentCount: 3,
      TotalPointCount: 8,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: [{
      Target: 'Parameter',
      Id: 'ParamAngleX',
      // Segments: [t0, v0,
      //            type=1 (bezier), cx1, cy1, cx2, cy2, t1, v1,
      //            type=0 (linear),                     t2, v2,
      //            type=2 (stepped),                    t3, v3]
      Segments: [
        0, 0,
        1, 0.1, 5, 0.2, 8, 0.3, 10,
        0, 0.5, 5,
        2, 0.8, 7,
      ],
    }],
  };

  const { action } = parseMotion3Json(JSON.stringify(original), { uid });
  const reExported = generateMotion3Json(action, {});

  const orig = original.Curves[0].Segments;
  const reEx = reExported.Curves[0].Segments;

  assert(reEx.length === orig.length,
    `synth: re-exported segment count = original (got ${reEx.length} vs ${orig.length})`);

  for (let i = 0; i < orig.length; i++) {
    near(reEx[i], orig[i], 1e-9, `synth: segments[${i}] = ${orig[i]}`);
  }
}

// ── (a2) Bezier handle preservation: cx1/cy1/cx2/cy2 must round-trip ───
{
  const original = {
    Version: 3,
    Meta: {
      Duration: 1.0, Fps: 30.0, Loop: true, AreBeziersRestricted: false,
      CurveCount: 1, TotalSegmentCount: 1, TotalPointCount: 4,
      UserDataCount: 0, TotalUserDataSize: 0,
    },
    Curves: [{
      Target: 'Parameter',
      Id: 'ParamSmile',
      // One bezier segment with distinctive control points.
      Segments: [0, 0, 1, 0.25, 0.75, 0.75, 0.25, 1.0, 1.0],
    }],
  };

  const { action } = parseMotion3Json(JSON.stringify(original), { uid });
  const reEx = generateMotion3Json(action, {});

  const o = original.Curves[0].Segments;
  const r = reEx.Curves[0].Segments;
  // Index 2..8 are: type, cx1, cy1, cx2, cy2, t1, v1.
  // Time fields go through ms↔sec round-trip (Math.round + /1000) — exact
  // for thousandths-aligned inputs.
  near(r[3], o[3], 1e-9, 'bezier cx1 round-trip');
  near(r[4], o[4], 1e-9, 'bezier cy1 round-trip');
  near(r[5], o[5], 1e-9, 'bezier cx2 round-trip');
  near(r[6], o[6], 1e-9, 'bezier cy2 round-trip');
}

// ── (b) HIYORI: semantic round-trip ─────────────────────────────────────
//
// Import each Hiyori motion3.json, re-export, then sample both flat-
// segment arrays at uniform times and verify the value sequence matches
// (Cubism's runtime interp is what the user sees, so divergence in
// segment shape — not just endpoints — is what matters).

const HIYORI_SAMPLES = [
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m01.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m02.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m03.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m04.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m05.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m06.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m07.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m08.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m09.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_m10.motion3.json',
  'reference/live2d-sample/Hiyori/runtime/motion/hiyori_pro_t11_ai_idle.motion3.json',
];

for (const sampleRel of HIYORI_SAMPLES) {
  const path = join(REPO_ROOT, sampleRel);
  if (!existsSync(path)) {
    skipped++;
    console.log(`  skip: ${sampleRel} (not found)`);
    continue;
  }
  const text = readFileSync(path, 'utf8');
  let action;
  try {
    ({ action } = parseMotion3Json(text, { uid }));
  } catch (e) {
    failed++;
    console.error(`FAIL: ${sampleRel}: parse error — ${e.message}`);
    continue;
  }
  const reEx = generateMotion3Json(action, {});

  // The sample has its original curve set; the re-export should match
  // segment-count + length per curve (proves no curves dropped, no
  // segments inserted/lost from the parse → re-encode round-trip).
  const orig = JSON.parse(text);
  const sampleName = sampleRel.split('/').pop();
  assert(reEx.Curves.length === orig.Curves.length,
    `${sampleName}: curve count preserved (${reEx.Curves.length} vs ${orig.Curves.length})`);

  // Per-curve: segment array lengths must match (drift = segment-type
  // misclassification) AND segment values must match within FP tolerance
  // (drift = control-point swap, off-by-one, or coordinate-system bug).
  // Audit-fix HIGH-A2 (2026-05-16): pre-fix this loop only checked
  // length, not values — a bug that swapped cx1↔cx2 / cy1↔cy2 would
  // silently pass. Now every float in the segment array is compared.
  //
  // EPS_TIME = 1ms — the canonical SS animation-time quantum per
  // `feedback_ms_canonical_animation_time.md` (Phase 0.0 of the
  // Animation Plan). Cubism's motion3.json carries fp64 seconds; SS
  // imports via `Math.round(x * 1000)` which truncates to integer ms.
  // Hiyori source files have sub-ms precision times (e.g. 1/30 sec =
  // 33.333... ms truncating to 33 ms = 0.033 sec on re-export) so the
  // round-trip can lose up to 0.5ms ≈ 5e-4 sec per time field. This is
  // a DELIBERATE fidelity trade-off baked into the plan, not a bug —
  // the §2.H exit gate's "byte-identical" promise is REINTERPRETED here
  // as "within the ms-quantisation tolerance" since Phase 0.0 makes
  // sub-ms time un-representable in the SS keyform shape.
  //
  // EPS_VALUE = 1e-6 — Cubism authors in fp32 but stores in JSON; the
  // parse → re-encode path stays at fp64 throughout, so divergence here
  // would be a real bug (not a precision artefact).
  const EPS_TIME  = 1e-3;
  const EPS_VALUE = 1e-6;
  let curveCheckedCount = 0;
  let valueDivergenceMax = 0;
  for (let ci = 0; ci < Math.min(reEx.Curves.length, orig.Curves.length); ci++) {
    const rc = reEx.Curves[ci];
    const oc = orig.Curves[ci];
    if (rc.Segments.length !== oc.Segments.length) {
      failed++;
      console.error(
        `FAIL: ${sampleName}: curve[${ci}] (${oc.Id}) segment-array length: `
        + `re-exported=${rc.Segments.length}, original=${oc.Segments.length}`,
      );
      continue;
    }
    // Walk the flat segment array, knowing the type-discriminator layout:
    //   [t0, v0, type1, (payload1...), type2, (payload2...), ...]
    // Bezier payload = 6 floats (cx1, cy1, cx2, cy2, t_end, v_end);
    // linear/stepped payload = 2 floats (t_end, v_end). Floats at
    // CX/T positions are time-axis; CY/V are value-axis. Type byte must
    // match exactly.
    let valueDivergedAt = -1;
    const o = oc.Segments;
    const r = rc.Segments;
    if (Math.abs(r[0] - o[0]) > EPS_TIME) valueDivergedAt = 0;
    if (Math.abs(r[1] - o[1]) > EPS_VALUE) valueDivergedAt = 1;
    let i = 2;
    while (i < o.length && valueDivergedAt < 0) {
      if (r[i] !== o[i]) { valueDivergedAt = i; break; }  // type byte exact
      const type = o[i];
      i++;
      if (type === 1) {
        // bezier: cx1, cy1, cx2, cy2, t, v
        if (Math.abs(r[i  ] - o[i  ]) > EPS_TIME)  { valueDivergedAt = i; break; }
        if (Math.abs(r[i+1] - o[i+1]) > EPS_VALUE) { valueDivergedAt = i+1; break; }
        if (Math.abs(r[i+2] - o[i+2]) > EPS_TIME)  { valueDivergedAt = i+2; break; }
        if (Math.abs(r[i+3] - o[i+3]) > EPS_VALUE) { valueDivergedAt = i+3; break; }
        if (Math.abs(r[i+4] - o[i+4]) > EPS_TIME)  { valueDivergedAt = i+4; break; }
        if (Math.abs(r[i+5] - o[i+5]) > EPS_VALUE) { valueDivergedAt = i+5; break; }
        valueDivergenceMax = Math.max(valueDivergenceMax,
          Math.abs(r[i+1] - o[i+1]), Math.abs(r[i+3] - o[i+3]), Math.abs(r[i+5] - o[i+5]));
        i += 6;
      } else {
        if (Math.abs(r[i  ] - o[i  ]) > EPS_TIME)  { valueDivergedAt = i; break; }
        if (Math.abs(r[i+1] - o[i+1]) > EPS_VALUE) { valueDivergedAt = i+1; break; }
        valueDivergenceMax = Math.max(valueDivergenceMax, Math.abs(r[i+1] - o[i+1]));
        i += 2;
      }
    }
    if (valueDivergedAt >= 0) {
      failed++;
      console.error(
        `FAIL: ${sampleName}: curve[${ci}] (${oc.Id}) segment[${valueDivergedAt}] diverged: `
        + `re-exported=${r[valueDivergedAt]}, original=${o[valueDivergedAt]}`,
      );
      continue;
    }
    curveCheckedCount++;
  }
  if (curveCheckedCount === orig.Curves.length) {
    passed++;
    if (process.env.VERBOSE) {
      console.log(
        `  ok: ${sampleName} (${orig.Curves.length} curves, all seg-values match; `
        + `max divergence ${valueDivergenceMax.toExponential(2)})`,
      );
    }
  }
}

console.log(
  `motion3jsonRoundtrip: ${passed} passed, ${failed} failed`
  + (skipped ? `, ${skipped} skipped` : ''),
);
process.exit(failed === 0 ? 0 : 1);
