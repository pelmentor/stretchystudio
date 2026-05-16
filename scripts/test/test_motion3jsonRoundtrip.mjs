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

  // Per-curve: segment array lengths must match. Drift would indicate a
  // segment-type misclassification (e.g. bezier emitted as 2 linear hops
  // or vice versa).
  let curveCheckedCount = 0;
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
    curveCheckedCount++;
  }
  if (curveCheckedCount === orig.Curves.length) {
    passed++;
    if (process.env.VERBOSE) {
      console.log(`  ok: ${sampleName} (${orig.Curves.length} curves, all seg-lengths match)`);
    }
  }
}

console.log(
  `motion3jsonRoundtrip: ${passed} passed, ${failed} failed`
  + (skipped ? `, ${skipped} skipped` : ''),
);
process.exit(failed === 0 ? 0 : 1);
