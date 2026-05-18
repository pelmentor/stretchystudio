// Animation Phase 3 Slice 3.G — FModifier save → load → save round-trip.
//
// Plan §3.G Phase 3 exit gate item 3:
//   "Round-trip: cycle-modifier on save → load → save preserves the modifier."
//
// Sister-coverage:
//   - test_motion3jsonCyclesExport.mjs §14/§15 cover the OPPOSITE direction
//     (Cubism-authored JSON → SS → JSON). This file covers SS-authored
//     action → export → import → re-export, which is the user-facing
//     direction (a user authors Cycles in the modifier panel, exports for
//     Cubism Viewer, re-imports the same motion3.json into a new project).
//   - test_motion3jsonNoiseExport.mjs §6 pins Noise determinism within a
//     single export. This file pins it across the full round-trip and
//     across the SS project save layer (JSON.parse(JSON.stringify)).
//
// What this file gates:
//   - Loop-preserving round-trip: SS Cycles-uniform → JSON Loop=true →
//     imported Cycles-uniform → JSON Loop=true (motion3.json byte-identical
//     across the two exports + Cycles modifier present on every imported
//     fcurve).
//   - Loop=false round-trip: SS no-Cycles → JSON Loop=false → imported
//     no-modifiers → JSON Loop=false (motion3.json byte-identical).
//   - Lossy mixed-Cycles round-trip (DOCUMENTED): SS some-Cycles → JSON
//     Loop=false (cycling fcurves baked) → imported no-modifiers → JSON
//     Loop=false. Audible behaviour preserved; cycling intent lost in
//     the SECOND export (no Cycles modifier left to re-bake from). Tests
//     post-stabilisation byte-identity (export-2 ≡ export-3) since the
//     first export's sub-ms bake times collapse to integer ms on import
//     per the SS ms-canonical time policy.
//   - Cycles+Noise hybrid round-trip: SS Cycles+Noise → JSON Loop=true
//     with Noise baked + Cycles preserved → imported gets Cycles
//     synthesised on the (baked) fcurves → post-stabilisation
//     byte-identity (the SS deviation documented in plan §3.E: Cubism
//     replays the same baked noise samples each loop).
//
// # Time precision note (load-bearing for §3/§4/§5 idempotence framing)
//
// SS canonical time is INTEGER MILLISECONDS (feedback_ms_canonical_animation_time
// — Phase 0.0 of the parity plan). The bake helper samples at `stepMs =
// 1000/fps`, which is fractional for non-divisor FPS (e.g. 30fps →
// 33.333... ms). The first motion3.json export carries those fractional
// times verbatim (seconds with full fp precision); importing snaps them
// to integer ms via `Math.round(seg[0] * 1000)`. So a single round-trip
// is NOT byte-identical for baked outputs — the second export carries
// times like `0.033` instead of `0.03333...`. After stabilisation (i.e.
// from the second export onward), subsequent round-trips ARE
// byte-identical. The §3c/§4d/§5b assertions test that idempotence
// rather than the impossible single-pass byte-identity.
//   - SS project save layer: JSON.parse(JSON.stringify(action)) preserves
//     the modifier stack byte-identically (the project store serialises
//     pure data — pin this so future v* schema bumps that introduce class
//     instances on actions surface the regression here).
//
// Run: node scripts/test/test_fmodifierRoundTrip.mjs

import { generateMotion3Json } from '../../src/io/live2d/motion3json.js';
import { parseMotion3Json } from '../../src/io/live2d/motion3jsonImport.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}
function assertEq(actual, expected, name) {
  if (actual === expected) { passed++; return; }
  failed++;
  failures.push(`${name}\n  actual:   ${actual}\n  expected: ${expected}`);
  console.error(`FAIL: ${name}\n  actual:   ${actual}\n  expected: ${expected}`);
}

function paramFcurve(paramId, kfs, modifiers) {
  const fc = {
    id: `param:${paramId}`,
    rnaPath: `objects["__params__"].values["${paramId}"]`,
    keyforms: kfs.map((k) => ({
      easing: 'linear', type: 'linear', interpolation: 'linear',
      ...k,
    })),
  };
  if (modifiers) fc.modifiers = modifiers;
  return fc;
}

function makeAction(props = {}) {
  return {
    id: 'a', name: 'A', fps: 30, duration: 1000, audioTracks: [],
    fcurves: [], meta: {}, flag: 0,
    ...props,
  };
}

function makeUid() {
  let counter = 0;
  return () => `id_${counter++}`;
}

// ── 1. SS-authored Cycles-uniform → JSON → import → re-export ───────────
{
  // The shape of the SS-authored Cycles modifier must match what
  // motion3jsonImport.js synthesises (data.after='repeat', sparse-default
  // before+afterCycles). If we author with EXACTLY that shape, the two
  // motion3.json exports should be byte-identical (the `id` field lives on
  // the SS fcurve.modifiers[] objects but never appears in motion3.json).
  const action = makeAction({
    fps: 30, duration: 1000,
    fcurves: [
      paramFcurve('ParamA',
        [{ time: 0, value: 0 }, { time: 1000, value: 1 }],
        [{ id: 'mod_a', type: 'cycles', data: { after: 'repeat' } }]),
      paramFcurve('ParamB',
        [{ time: 0, value: 0 }, { time: 1000, value: 0.5 }],
        [{ id: 'mod_b', type: 'cycles', data: { after: 'repeat' } }]),
    ],
  });

  const exportedOne = generateMotion3Json(action);
  assertEq(exportedOne.Meta.Loop, true,
    '1: SS-uniform-Cycles first export → Loop=true');

  const { action: imported, warnings } = parseMotion3Json(
    JSON.stringify(exportedOne),
    { uid: makeUid() },
  );
  assertEq(warnings.length, 0, '1a: clean import (no warnings)');

  // Every imported fcurve carries the synthesised Cycles modifier.
  for (const fc of imported.fcurves) {
    assert(Array.isArray(fc.modifiers) && fc.modifiers.length === 1
      && fc.modifiers[0].type === 'cycles'
      && fc.modifiers[0].data?.after === 'repeat',
      `1b: imported fcurve ${fc.id} has head-of-stack Cycles {after:'repeat'}`);
    assert(typeof fc.modifiers[0].id === 'string' && fc.modifiers[0].id.length > 0,
      `1c: imported fcurve ${fc.id} Cycles modifier has stable id`);
  }

  const exportedTwo = generateMotion3Json(imported);
  assertEq(exportedTwo.Meta.Loop, true,
    '1d: re-export preserves Loop=true');

  // Byte-identity of the motion3.json across the round-trip is the
  // load-bearing claim. JSON.stringify with no formatting args gives a
  // deterministic serialisation provided the field order is preserved.
  assertEq(JSON.stringify(exportedTwo), JSON.stringify(exportedOne),
    '1e: motion3.json BYTE-IDENTICAL across save → load → save');
}

// ── 2. SS no-Cycles → JSON Loop=false → import → re-export Loop=false ──
{
  const action = makeAction({
    fps: 30, duration: 1000,
    fcurves: [
      paramFcurve('ParamA', [{ time: 0, value: 0 }, { time: 1000, value: 1 }]),
      paramFcurve('ParamB', [{ time: 0, value: 0 }, { time: 1000, value: 2 }]),
    ],
  });

  const exportedOne = generateMotion3Json(action);
  assertEq(exportedOne.Meta.Loop, false,
    '2: SS no-Cycles first export → Loop=false');

  const { action: imported, warnings } = parseMotion3Json(
    JSON.stringify(exportedOne),
    { uid: makeUid() },
  );
  assertEq(warnings.length, 0, '2a: clean import');

  for (const fc of imported.fcurves) {
    assert(!fc.modifiers || fc.modifiers.length === 0,
      `2b: imported fcurve ${fc.id} has NO modifiers (Loop=false ⇒ no synthesis)`);
  }

  const exportedTwo = generateMotion3Json(imported);
  assertEq(JSON.stringify(exportedTwo), JSON.stringify(exportedOne),
    '2c: motion3.json BYTE-IDENTICAL across save → load → save (Loop=false trivial)');
}

// ── 3. Mixed-Cycles (LOSSY case, documented) ─────────────────────────────
{
  // When the Cycles modifier is on SOME but not ALL fcurves, the export
  // gate (`actionHasUniformLoopingCycles`) refuses Loop=true and the bake
  // gate fires for the Cycles-carrying fcurves. The motion3.json carries
  // baked keyforms but no Loop flag — on re-import, NO fcurve gets a
  // synthesised Cycles modifier (Loop=false ⇒ no signal). The second
  // export is byte-identical to the first because the bake already
  // collapsed the modifier into explicit segments — there's nothing left
  // to re-bake.
  //
  // This is the documented LOSSY case: the *intent* of "this curve
  // cycles" is lost in the JSON round-trip (Cubism's format can't
  // express per-fcurve cycling), but the *audible behaviour* — the
  // motion the Cubism runtime plays — is preserved bit-for-bit.
  const action = makeAction({
    fps: 30, duration: 1000,
    fcurves: [
      paramFcurve('Cycling',
        [{ time: 0, value: 0 }, { time: 500, value: 1 }],
        [{ id: 'mod_c', type: 'cycles', data: { after: 'repeat' } }]),
      paramFcurve('Static',
        [{ time: 0, value: 0 }, { time: 1000, value: 2 }]),
    ],
  });

  const exportedOne = generateMotion3Json(action);
  assertEq(exportedOne.Meta.Loop, false,
    '3: mixed-Cycles first export → Loop=false');
  // The Cycling fcurve got baked (more segments than original 2 kfs).
  const cyclingOne = exportedOne.Curves.find((c) => c.Id === 'Cycling');
  assert(cyclingOne.Segments.length > 5,
    '3a: Cycling fcurve baked (>5 floats = >1 segment after 2-kf header)');

  const { action: imported } = parseMotion3Json(
    JSON.stringify(exportedOne),
    { uid: makeUid() },
  );
  for (const fc of imported.fcurves) {
    assert(!fc.modifiers || fc.modifiers.length === 0,
      `3b: imported fcurve ${fc.id} has no modifiers (Loop=false, intent lost)`);
  }

  // Post-stabilisation idempotence: integer-ms time grid is fixed
  // from export-2 onward (the SS canonical ms snap happened on import-1).
  const exportedTwo = generateMotion3Json(imported);
  const { action: importedTwo } = parseMotion3Json(
    JSON.stringify(exportedTwo),
    { uid: makeUid() },
  );
  const exportedThree = generateMotion3Json(importedTwo);
  assertEq(JSON.stringify(exportedThree), JSON.stringify(exportedTwo),
    '3c: post-stabilisation idempotence — export-3 ≡ export-2 (audible behaviour preserved on every subsequent round-trip)');
}

// ── 4. Cycles + Noise hybrid → Loop=true + Noise baked ──────────────────
{
  // Plan §3.E SS deviation: Cubism replays the same baked noise samples
  // each loop iteration (Blender re-evaluates noise per cycle). This is
  // the format constraint — motion3.json has no live-noise primitive.
  // The round-trip should be byte-identical because Noise is
  // deterministic (no PRNG state; size+phase+offset+depth fully specify
  // the sample sequence).
  const action = makeAction({
    fps: 30, duration: 1000,
    fcurves: [
      paramFcurve('Hybrid',
        [{ time: 0, value: 0 }, { time: 1000, value: 1 }],
        [
          { id: 'mod_cyc', type: 'cycles', data: { after: 'repeat' } },
          { id: 'mod_noi', type: 'noise', data: { size: 1, strength: 0.5, blendType: 'add' } },
        ]),
      paramFcurve('PureCycles',
        [{ time: 0, value: 0 }, { time: 1000, value: 0.5 }],
        [{ id: 'mod_c2', type: 'cycles', data: { after: 'repeat' } }]),
    ],
  });

  const exportedOne = generateMotion3Json(action);
  assertEq(exportedOne.Meta.Loop, true,
    '4: Cycles+Noise hybrid first export → Loop=true (uniform Cycles satisfies predicate)');
  // Hybrid baked (Noise trigger fires regardless of Loop); PureCycles
  // ships as-authored (Loop=true ⇒ no Cycles-bake; no Noise ⇒ no Noise-bake).
  const hybridOne = exportedOne.Curves.find((c) => c.Id === 'Hybrid');
  const pureOne = exportedOne.Curves.find((c) => c.Id === 'PureCycles');
  assert(hybridOne.Segments.length > 5,
    '4a: Hybrid baked (Noise trigger fires under Loop=true)');
  // 5 = [t0, v0] header + [type=0 (linear), t1, v1] for a 2-keyform linear segment.
  // (Encoded per encodeKeyframesToSegments in motion3json.js.)
  assertEq(pureOne.Segments.length, 5,
    '4b: PureCycles ships as-authored under Loop=true (no bake)');

  const { action: imported } = parseMotion3Json(
    JSON.stringify(exportedOne),
    { uid: makeUid() },
  );
  // Loop=true ⇒ Cycles synthesised on EVERY imported fcurve (including
  // the one that was baked from a Cycles+Noise stack — the Noise intent
  // is lost but the baked samples now ARE the curve).
  for (const fc of imported.fcurves) {
    assert(Array.isArray(fc.modifiers) && fc.modifiers.length === 1
      && fc.modifiers[0].type === 'cycles',
      `4c: imported fcurve ${fc.id} carries Cycles (Loop=true synthesis)`);
  }

  // Post-stabilisation idempotence (same time-grid story as §3).
  const exportedTwo = generateMotion3Json(imported);
  const { action: importedTwo } = parseMotion3Json(
    JSON.stringify(exportedTwo),
    { uid: makeUid() },
  );
  const exportedThree = generateMotion3Json(importedTwo);
  assertEq(JSON.stringify(exportedThree), JSON.stringify(exportedTwo),
    '4d: Cycles+Noise post-stabilisation idempotence (Noise determinism + Loop preservation)');
}

// ── 5. Noise-only (no Cycles) → Loop=false, bake → import → equality ────
{
  // Per plan §3.E the Noise trigger fires unconditionally — a Noise-only
  // fcurve always bakes regardless of Loop status. On re-import without
  // Loop=true the imported action has no Cycles signal but carries the
  // baked Noise samples in keyforms — the second export should match the
  // first (no modifiers to re-bake; the bake is already in the segments).
  const action = makeAction({
    fps: 30, duration: 500,
    fcurves: [
      paramFcurve('Noisy',
        [{ time: 0, value: 0 }, { time: 500, value: 1 }],
        [{ id: 'mod_n', type: 'noise', data: { size: 1.5, strength: 0.3, blendType: 'add' } }]),
    ],
  });

  const exportedOne = generateMotion3Json(action);
  assertEq(exportedOne.Meta.Loop, false,
    '5: Noise-only no-Cycles first export → Loop=false');
  const noisyOne = exportedOne.Curves.find((c) => c.Id === 'Noisy');
  assert(noisyOne.Segments.length > 5,
    '5a: Noisy fcurve baked');

  const { action: imported } = parseMotion3Json(
    JSON.stringify(exportedOne),
    { uid: makeUid() },
  );
  // Post-stabilisation idempotence (same time-grid story as §3/§4).
  const exportedTwo = generateMotion3Json(imported);
  const { action: importedTwo } = parseMotion3Json(
    JSON.stringify(exportedTwo),
    { uid: makeUid() },
  );
  const exportedThree = generateMotion3Json(importedTwo);
  assertEq(JSON.stringify(exportedThree), JSON.stringify(exportedTwo),
    '5b: Noise-only post-stabilisation idempotence (determinism + no Loop signal to lose)');
}

// ── 6. SS project-store layer: JSON.parse(JSON.stringify) preserves stack
{
  // The SS project store serialises actions as plain JSON. The modifier
  // stack — including type/data/muted/disabled/useInfluence/influence/
  // useRestrictedRange/sfra/efra fields — must round-trip byte-identical
  // through the serialiser. This pins the SS-side save/load layer (the
  // companion to the motion3.json layer covered above).
  //
  // Audit-fix MED-2 (2026-05-18): scope of this test is **plain-data
  // shape preservation under JSON.parse(JSON.stringify)** — it pins
  // that the SS modifier stack survives a JSON-serialised project
  // round-trip with field-order and field-value fidelity. What it does
  // NOT catch: a future schema bump that introduces a class instance
  // with a custom `toJSON` method (would silently round-trip to a
  // mangled shape but stringify to the same bytes), a key added by a
  // post-parse migration that wasn't in the authored modifier, or a
  // field-order divergence on a runtime that doesn't preserve insertion
  // order. V8 + modern Node preserves insertion order so the
  // string-compare is sound today; a property-by-property deep-equal
  // would be tighter if those concerns become live.
  const originalModifiers = [
    {
      id: 'mod_1',
      type: 'cycles',
      data: { before: 'none', after: 'repeat', afterCycles: 0 },
      muted: false,
      useInfluence: false,
    },
    {
      id: 'mod_2',
      type: 'noise',
      data: { size: 1.0, strength: 0.5, offset: 0, phase: 0, depth: 0, lacunarity: 2, roughness: 0.5, blendType: 'replace' },
      useRestrictedRange: false,
    },
    {
      id: 'mod_3',
      type: 'limits',
      data: { useMaxY: true, maxY: 1.0 },
      muted: true,
    },
  ];
  const action = makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 1000, value: 1 }],
      originalModifiers)],
  });

  const serialised = JSON.stringify(action);
  const restored = JSON.parse(serialised);
  const restoredMods = restored.fcurves[0].modifiers;

  assertEq(restoredMods.length, originalModifiers.length,
    '6: project-store round-trip preserves modifier count');
  for (let i = 0; i < originalModifiers.length; i++) {
    assertEq(JSON.stringify(restoredMods[i]), JSON.stringify(originalModifiers[i]),
      `6${String.fromCharCode(97 + i)}: modifier[${i}] (${originalModifiers[i].type}) byte-identical after project-store round-trip`);
  }
}

// ── 7. Two consecutive saves of the SAME action are byte-identical ──────
{
  // Determinism gate: re-running generateMotion3Json on the SAME action
  // produces byte-identical JSON. Not strictly a round-trip but the
  // load-bearing precondition for §1-§5's byte-identity claims.
  const action = makeAction({
    fps: 30, duration: 1000,
    fcurves: [
      paramFcurve('Det',
        [{ time: 0, value: 0 }, { time: 1000, value: 1 }],
        [
          { id: 'mod_c', type: 'cycles', data: { after: 'repeat' } },
          { id: 'mod_n', type: 'noise', data: { size: 2, strength: 0.4, blendType: 'add' } },
        ]),
    ],
  });
  const a = generateMotion3Json(action);
  const b = generateMotion3Json(action);
  assertEq(JSON.stringify(a), JSON.stringify(b),
    '7: two consecutive saves of identical action are byte-identical');
}

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\nfmodifierRoundTrip: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
