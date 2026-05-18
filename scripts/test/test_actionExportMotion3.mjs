// Animation Phase 1 Stage 1.F — Per-Action motion3.json export.
//
// Per plan §1.F:
//
//   > test_actionExportMotion3.mjs — each Action exports to one
//   > motion3.json (current path via `resolveActions`)
//
// What this test pins down:
//   - One Action → one .motion3.json (the per-Action contract — Cubism
//     SDK loads one motion file per animation)
//   - Multi-Action: each Action is independently emitted (the exporter
//     loops over `project.actions[]` calling `generateMotion3Json`)
//   - Curve targeting:
//       * `objects["__params__"].values["X"]` → Target='Parameter', Id='X'
//       * `objects["partId"].opacity` → Target='PartOpacity', Id='partId'
//       * `objects["groupId"].rotation` → routed via parameterMap (Object
//         property fcurves NEED a parameterMap entry to map onto a
//         Live2D parameter; without it the curve is dropped)
//   - Meta accounting: Duration / Fps / CurveCount / TotalSegmentCount /
//     TotalPointCount filled correctly per curve count + segment shape
//   - Loop flag honoured (default true; opts.loop=false → false)
//   - Empty action → emits a valid skeleton (Version + Meta + empty
//     Curves array) so the file is parseable by the Cubism SDK loader
//
// What this test is NOT:
//   - The segment-encoder unit test → see `test_motion3json.mjs`
//     (covers `encodeKeyframesToSegments` / `countSegmentsAndPoints`)
//   - The byte-fidelity gate vs. Hiyori reference → that's the manual
//     Cubism Viewer .moc3/.motion3 round-trip in Phase 1.G
//
// # PHASE-SCOPE WARNING (Stage 1.F audit-fix D-7 — Phase 4 NLA prep)
//
// Today's "per-Action contract — each Action exports INDEPENDENTLY" is
// correct for Phase 1's single-Action-at-a-time playback model AND for
// the Live2D motion3.json file format (one motion = one file). Once
// Phase 4 lands NLA strips (Blender `NlaStrip` per `DNA_anim_types.h:425-499`
// — blendmode / extendmode / start / end / repeat / scale / influence),
// an Action may be sliced/blended across multiple strips before export,
// and a single motion3.json may aggregate multiple Action contributions
// through the AnimData.nla_tracks stack. Sister marker on the can3 side
// (test_actionExportCan3.mjs) and on `animationCompile.js` (Stage 1.F-pre
// audit-fix D-4). The "one Action → one motion3" assertions WILL change
// shape; update this test in lockstep with the Phase 4 exporter rewire.
//
// Run: node scripts/test/test_actionExportMotion3.mjs

import { generateMotion3Json } from '../../src/io/live2d/motion3json.js';

let passed = 0, failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
}

function near(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

/**
 * Build a minimal action with given fcurves[] and metadata.
 */
function makeAction({ id = 'a1', name = 'A1', fps = 30, duration = 1000, fcurves = [], flag = 0 } = {}) {
  return {
    id, name, fps, duration,
    fcurves: fcurves.map((fc) => ({
      arrayIndex: 0, modifiers: [], extrapolation: 'constant',
      ...fc,
    })),
    audioTracks: [], flag, meta: { source: 'authored' },
  };
}

function paramFcurve(paramId, kfs) {
  return {
    id: `param:${paramId}`,
    rnaPath: `objects["__params__"].values["${paramId}"]`,
    keyforms: kfs.map((k) => ({ easing: 'linear', type: 'linear', ...k })),
  };
}

function nodeFcurve(nodeId, property, kfs) {
  return {
    id: `${nodeId}.${property}`,
    rnaPath: `objects["${nodeId}"].${property}`,
    keyforms: kfs.map((k) => ({ easing: 'linear', type: 'linear', ...k })),
  };
}

// ── 1. Single-action, single param-fcurve → one Parameter curve ────────────

{
  const action = makeAction({
    id: 'idle', name: 'Idle', fps: 30, duration: 1000,
    fcurves: [paramFcurve('ParamAngleX', [
      { time: 0, value: 0 },
      { time: 1000, value: 30 },
    ])],
  });

  const m = generateMotion3Json(action);

  assertEq(m.Version, 3, '1: Version=3 (Live2D motion3 v3)');
  assert(near(m.Meta.Duration, 1.0), '1a: Duration=1.0s (1000ms / 1000)');
  assertEq(m.Meta.Fps, 30, '1b: Fps=30 from action.fps');
  // 3.D — no Cycles modifier present → Loop=false (was hardcoded true
  // pre-3.D; the legacy "Live2D loops by convention" default is
  // replaced by per-fcurve Cycles signal per plan §3.D).
  assertEq(m.Meta.Loop, false, '1c: Loop=false when no Cycles modifier on fcurves');
  assertEq(m.Meta.CurveCount, 1, '1d: CurveCount=1');
  assertEq(m.Curves.length, 1, '1e: 1 curve emitted');
  assertEq(m.Curves[0].Target, 'Parameter', '1f: Target=Parameter');
  assertEq(m.Curves[0].Id, 'ParamAngleX', '1g: Id=ParamAngleX');
  assert(Array.isArray(m.Curves[0].Segments), '1h: Segments is an array');
}

// ── 2. opacity-fcurve → PartOpacity target via default mapping ─────────────

{
  const action = makeAction({
    id: 'fade', name: 'Fade', fps: 30, duration: 500,
    fcurves: [nodeFcurve('hairBackPart', 'opacity', [
      { time: 0, value: 1 },
      { time: 500, value: 0 },
    ])],
  });

  const m = generateMotion3Json(action);
  assertEq(m.Curves[0].Target, 'PartOpacity', '2: opacity → Target=PartOpacity');
  assertEq(m.Curves[0].Id, 'hairBackPart', '2a: Id=nodeId for PartOpacity');
}

// ── 3. node.rotation fcurve REQUIRES parameterMap entry ────────────────────

{
  const action = makeAction({
    id: 'wave', name: 'Wave', fps: 30, duration: 500,
    fcurves: [nodeFcurve('leftArm', 'rotation', [
      { time: 0, value: 0 },
      { time: 500, value: 45 },
    ])],
  });

  // Without parameterMap → dropped silently (Stage 1.F invariant).
  const empty = generateMotion3Json(action);
  assertEq(empty.Curves.length, 0,
    '3: rotation w/o parameterMap → no curves emitted');

  // With parameterMap entry → routes to Parameter curve.
  const parameterMap = new Map([
    ['leftArm.rotation', 'ParamRotation_leftArm'],
  ]);
  const mapped = generateMotion3Json(action, { parameterMap });
  assertEq(mapped.Curves.length, 1, '3a: rotation w/ parameterMap → 1 curve');
  assertEq(mapped.Curves[0].Target, 'Parameter', '3b: Target=Parameter');
  assertEq(mapped.Curves[0].Id, 'ParamRotation_leftArm', '3c: Id from map value');
}

// ── 4. Meta segment+point counts match Curves' segment payload ─────────────

{
  const action = makeAction({
    id: 'multi', name: 'Multi',
    fcurves: [
      paramFcurve('ParamA', [
        { time: 0, value: 0 },
        { time: 500, value: 1 },     // 1 linear segment
        { time: 1000, value: 0 },    // 1 linear segment = 2 segments total
      ]),
      paramFcurve('ParamB', [
        { time: 0, value: 0 },
        { time: 1000, value: 1 },    // 1 linear segment
      ]),
    ],
  });

  const m = generateMotion3Json(action);
  assertEq(m.Curves.length, 2, '4: 2 curves emitted');
  // Total segments = 2 (ParamA) + 1 (ParamB) = 3
  assertEq(m.Meta.TotalSegmentCount, 3,
    '4a: TotalSegmentCount sums across curves (2+1)');
  // Total points = 1 first-point + 2 (ParamA segs) + 1 first-point + 1
  // (ParamB seg) = 5 (linear segs add 1 point each)
  assertEq(m.Meta.TotalPointCount, 5,
    '4b: TotalPointCount sums across curves (3+2)');
}

// ── 5. Loop is driven by per-fcurve Cycles modifier (Slice 3.D) ───────────

{
  // Per `motion3json.js` module JSDoc "Loop semantics — Slice 3.D":
  //   - No Cycles modifier on any fcurve → Loop=false
  //   - ACT_CYCLIC flag bit currently NOT read (still reserved; will be
  //     wired in lockstep with the ActionsEditor Cyclic-toggle UI)
  //   - Uniform Cycles {before='none', after='repeat', afterCycles=0}
  //     across ALL fcurves → Loop=true; original keyforms emitted as-is
  //   - Mixed (some cycle, some don't) → Loop=false; cycling fcurves
  //     baked via `evaluateFCurve`
  const noCycles = makeAction({
    flag: 0,
    fcurves: [paramFcurve('P', [{ time: 0, value: 0 }, { time: 500, value: 1 }])],
  });
  assertEq(generateMotion3Json(noCycles).Meta.Loop, false,
    '5: Loop=false when no Cycles modifier on any fcurve');

  // ACT_CYCLIC bit alone is NOT yet a signal (deferred wiring).
  const cyclicFlagOnly = makeAction({
    flag: 1 << 13,
    fcurves: [paramFcurve('P', [{ time: 0, value: 0 }, { time: 500, value: 1 }])],
  });
  assertEq(generateMotion3Json(cyclicFlagOnly).Meta.Loop, false,
    '5a: Loop=false even with ACT_CYCLIC bit when no Cycles modifier (flag wiring deferred)');

  // Uniform Cycles {before='none', after='repeat', afterCycles=0} on every fcurve → Loop=true.
  const uniformlyLooping = makeAction({
    fcurves: [
      {
        ...paramFcurve('P', [{ time: 0, value: 0 }, { time: 500, value: 1 }]),
        modifiers: [
          { type: 'cycles', data: { after: 'repeat', afterCycles: 0 } },
        ],
      },
      {
        ...paramFcurve('Q', [{ time: 0, value: 0 }, { time: 500, value: 2 }]),
        modifiers: [
          { type: 'cycles', data: { after: 'repeat' } }, // sparse afterCycles defaults to 0
        ],
      },
    ],
  });
  assertEq(generateMotion3Json(uniformlyLooping).Meta.Loop, true,
    '5b: Loop=true when every fcurve has spec Cycles modifier');

  // 'repeat_offset' (gradient-offset) does NOT count as a clean loop.
  const offsetRepeat = makeAction({
    fcurves: [{
      ...paramFcurve('P', [{ time: 0, value: 0 }, { time: 500, value: 1 }]),
      modifiers: [{ type: 'cycles', data: { after: 'repeat_offset' } }],
    }],
  });
  assertEq(generateMotion3Json(offsetRepeat).Meta.Loop, false,
    '5c: Loop=false when after=repeat_offset (gradient offset is not a pure loop)');

  // Non-zero afterCycles → bounded repeat, not infinite loop.
  const boundedRepeat = makeAction({
    fcurves: [{
      ...paramFcurve('P', [{ time: 0, value: 0 }, { time: 500, value: 1 }]),
      modifiers: [{ type: 'cycles', data: { after: 'repeat', afterCycles: 3 } }],
    }],
  });
  assertEq(generateMotion3Json(boundedRepeat).Meta.Loop, false,
    '5d: Loop=false when afterCycles>0 (bounded repeat, not infinite)');

  // Mixed: one fcurve cycles, another doesn't → Loop=false (cycling one gets baked).
  const mixed = makeAction({
    fps: 30, duration: 500,
    fcurves: [
      {
        ...paramFcurve('Looping', [{ time: 0, value: 0 }, { time: 250, value: 1 }]),
        modifiers: [{ type: 'cycles', data: { after: 'repeat' } }],
      },
      paramFcurve('Static', [{ time: 0, value: 0 }, { time: 500, value: 1 }]),
    ],
  });
  const mixedResult = generateMotion3Json(mixed);
  assertEq(mixedResult.Meta.Loop, false,
    '5e: Loop=false when mix of cycling + non-cycling fcurves');
  // Looping fcurve was baked → its segment count is well above the
  // pre-bake 1 segment (250ms cycle over 500ms duration at 30fps = ~15+ samples).
  const loopingCurve = mixedResult.Curves.find((c) => c.Id === 'Looping');
  assert(loopingCurve && loopingCurve.Segments.length > 5,
    '5f: cycling fcurve baked into multi-segment curve when Loop=false');

  // Muted Cycles modifier does NOT count.
  const mutedCycles = makeAction({
    fcurves: [{
      ...paramFcurve('P', [{ time: 0, value: 0 }, { time: 500, value: 1 }]),
      modifiers: [{ type: 'cycles', muted: true, data: { after: 'repeat' } }],
    }],
  });
  assertEq(generateMotion3Json(mutedCycles).Meta.Loop, false,
    '5g: Loop=false when Cycles modifier is muted');

  // Range-restricted Cycles modifier does NOT count (scoped, not whole-curve).
  const restrictedCycles = makeAction({
    fcurves: [{
      ...paramFcurve('P', [{ time: 0, value: 0 }, { time: 500, value: 1 }]),
      modifiers: [{
        type: 'cycles',
        useRestrictedRange: true,
        sfra: 0, efra: 250,
        data: { after: 'repeat' },
      }],
    }],
  });
  assertEq(generateMotion3Json(restrictedCycles).Meta.Loop, false,
    '5h: Loop=false when Cycles modifier is range-restricted');
}

// ── 6. Empty action → valid skeleton with zero curves ──────────────────────

{
  const action = makeAction({ fcurves: [] });
  const m = generateMotion3Json(action);
  assertEq(m.Version, 3, '6: empty action still has Version=3');
  assertEq(m.Curves.length, 0, '6a: 0 curves emitted');
  assertEq(m.Meta.CurveCount, 0, '6b: Meta.CurveCount=0');
  assertEq(m.Meta.TotalSegmentCount, 0, '6c: Meta.TotalSegmentCount=0');
  assertEq(m.Meta.TotalPointCount, 0, '6d: Meta.TotalPointCount=0');
  assertEq(m.Meta.UserDataCount, 0, '6e: UserDataCount=0 (no user data shipped)');
}

// ── 7. Per-Action contract: each action exported INDEPENDENTLY ─────────────

{
  // Two distinct actions — caller (exporter.js / ExportModal.jsx) loops
  // over project.actions[] calling generateMotion3Json once per action.
  const a1 = makeAction({
    id: 'idle', name: 'Idle', fps: 30, duration: 1000,
    fcurves: [paramFcurve('ParamA', [{ time: 0, value: 0 }])],
  });
  const a2 = makeAction({
    id: 'wave', name: 'Wave', fps: 60, duration: 500,
    fcurves: [paramFcurve('ParamB', [{ time: 0, value: 1 }])],
  });

  const m1 = generateMotion3Json(a1);
  const m2 = generateMotion3Json(a2);

  assertEq(m1.Curves[0].Id, 'ParamA', '7: action1 emits ParamA only');
  assertEq(m2.Curves[0].Id, 'ParamB', '7a: action2 emits ParamB only');
  // Per-action Meta isolation — fps + duration NOT bled across
  assertEq(m1.Meta.Fps, 30, '7b: action1 Fps=30');
  assertEq(m2.Meta.Fps, 60, '7c: action2 Fps=60 (no bleed from action1)');
  assert(near(m1.Meta.Duration, 1.0), '7d: action1 Duration=1.0s');
  assert(near(m2.Meta.Duration, 0.5), '7e: action2 Duration=0.5s');
}

// ── 8. fcurve with only one keyform produces a valid 2-float segment ───────

{
  const action = makeAction({
    fcurves: [paramFcurve('ParamX', [{ time: 500, value: 0.7 }])],
  });
  const m = generateMotion3Json(action);
  assertEq(m.Curves.length, 1, '8: single-kf fcurve still emits a curve');
  assertEq(m.Curves[0].Segments.length, 2,
    '8a: single-kf segment array = [time, value] (2 floats)');
  assert(near(m.Curves[0].Segments[0], 0.5), '8b: time in seconds (500ms→0.5)');
  assert(near(m.Curves[0].Segments[1], 0.7), '8c: value preserved');
  // Stage 1.F audit-fix G-11: lock down the segments-vs-points contract
  // for 1-kf curves. Per `countSegmentsAndPoints` (motion3json.js:231),
  // a 2-float array has 0 segment-types (segCount=0) and 1 anchor point
  // (ptCount=1). Phase 1.G byte-fidelity gate cares about Meta accuracy.
  assertEq(m.Meta.TotalSegmentCount, 0,
    '8d: single-kf curve contributes 0 segments (no segment-type byte)');
  assertEq(m.Meta.TotalPointCount, 1,
    '8e: single-kf curve contributes 1 anchor point');
}

// ── 9. Untargetable fcurve dropped: rnaPath malformed → null target ────────

{
  // FCurve where decodeFCurveTarget returns null (no addressable target).
  // Per Stage 1.F invariant, the writer skips these silently — they were
  // already filtered by the v36 migration's trackToFCurveInline guard,
  // but defence-in-depth here.
  const action = makeAction({
    fcurves: [{
      id: 'bad',
      // Garbage rnaPath that decodeFCurveTarget cannot parse.
      rnaPath: 'not.a.valid.rna.path',
      arrayIndex: 0, modifiers: [], extrapolation: 'constant',
      keyforms: [{ time: 0, value: 0, easing: 'linear', type: 'linear' }],
    }],
  });
  const m = generateMotion3Json(action);
  assertEq(m.Curves.length, 0, '9: untargetable fcurve dropped silently');
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nactionExportMotion3: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
