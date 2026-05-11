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
function makeAction({ id = 'a1', name = 'A1', fps = 30, duration = 1000, fcurves = [] } = {}) {
  return {
    id, name, fps, duration,
    fcurves: fcurves.map((fc) => ({
      arrayIndex: 0, modifiers: [], extrapolation: 'constant',
      ...fc,
    })),
    audioTracks: [], flag: 0, meta: { source: 'authored' },
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
  assertEq(m.Meta.Loop, true, '1c: Loop default true');
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

// ── 5. Loop flag override via opts ─────────────────────────────────────────

{
  const action = makeAction({ fcurves: [paramFcurve('P', [{ time: 0, value: 0 }])] });
  const looped = generateMotion3Json(action, { loop: true });
  const oneshot = generateMotion3Json(action, { loop: false });
  assertEq(looped.Meta.Loop, true, '5: loop=true honoured');
  assertEq(oneshot.Meta.Loop, false, '5a: loop=false honoured');
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
