// Animation Phase 1 Stage 1.F — Per-Action .can3 export.
//
// Per plan §1.F:
//
//   > test_actionExportCan3.mjs — each Action exports to one .can3
//
// What this test pins down:
//   - One Action → one CSceneSource inside the bundled .can3 archive.
//     (A single .can3 archive holds N scenes per Cubism Editor's
//     "Animation Project" convention; the per-Action contract is "each
//     action is its own scene." Multiple actions ship in one .can3.)
//   - Scene name uses the sanitised `action.name` (non-alphanumeric →
//     underscore per `sceneEmit.js` line 70).
//   - Multi-action: N actions → N CSceneSource entries, all with
//     distinct sceneGuids, all referenced from the shared CAnimation's
//     `_scenes` carray_list.
//   - paramInfoList unifies `deformerParamMap` entries (rotation deformers
//     emitted as ParamRotation_*) AND param-target fcurves (idle generator
//     / AI motion; first-class Live2D parameter animation).
//   - Action with empty fcurves still produces a CSceneSource (resting
//     pose), so multi-action exports never "skip" actions on empty input.
//   - CAFF wrapper validity: `unpackCaff` round-trips the output and
//     returns main.xml.
//
// What this test is NOT:
//   - The CAFF binary-level fidelity gate vs. Hiyori reference → that's
//     the manual Cubism Editor `.can3` load test in Phase 1.G.
//   - The per-scene effect-emission deep test → that's covered by the
//     existing `test_can3*` suite (xmlbuilder + trackAttrs).
//
// Run: node scripts/test/test_actionExportCan3.mjs

import { generateCan3 } from '../../src/io/live2d/can3writer.js';
import { unpackCaff } from '../../src/io/live2d/caffUnpacker.js';

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

function makeAction({ id, name, fps = 30, duration = 1000, fcurves = [] }) {
  return {
    id, name, fps, duration,
    fcurves: fcurves.map((fc) => ({
      arrayIndex: 0, modifiers: [], extrapolation: 'constant',
      ...fc,
    })),
    audioTracks: [], flag: 0, meta: { source: 'authored' },
  };
}

function paramFc(paramId, kfs) {
  return {
    id: `param:${paramId}`,
    rnaPath: `objects["__params__"].values["${paramId}"]`,
    keyforms: kfs.map((k) => ({ easing: 'linear', type: 'linear', ...k })),
  };
}

function nodeFc(nodeId, property, kfs) {
  return {
    id: `${nodeId}.${property}`,
    rnaPath: `objects["${nodeId}"].${property}`,
    keyforms: kfs.map((k) => ({ easing: 'linear', type: 'linear', ...k })),
  };
}

/** Extract the main.xml string from a can3 byte buffer. */
async function extractMainXml(can3Bytes) {
  const archive = await unpackCaff(can3Bytes);
  const main = archive.files.find((f) => f.path === 'main.xml');
  if (!main) throw new Error('main.xml not found in CAFF archive');
  return new TextDecoder().decode(main.content);
}

/** Count occurrences of a substring (for sceneCount inspection). */
function count(s, sub) {
  let n = 0, i = 0;
  while ((i = s.indexOf(sub, i)) !== -1) { n++; i += sub.length; }
  return n;
}

// ── 1. Single-action can3 ── 1 CSceneSource, 1 CAnimation, 1 model.cmo3 ref

{
  const action = makeAction({
    id: 'idle', name: 'Idle',
    fcurves: [paramFc('ParamAngleX', [
      { time: 0, value: 0 },
      { time: 1000, value: 30 },
    ])],
  });

  const can3 = await generateCan3({
    actions: [action],
    deformerParamMap: new Map(),
    cmo3FileName: 'model.cmo3',
    canvasW: 1024, canvasH: 1024,
  });

  // CAFF wrapper validity
  assert(can3 instanceof Uint8Array, '1: returns a Uint8Array');
  assert(can3.byteLength > 1000, '1a: non-trivial byte output');
  // CAFF magic
  const magic = String.fromCharCode(can3[0], can3[1], can3[2], can3[3]);
  assertEq(magic, 'CAFF', '1b: CAFF magic header present');

  const xml = await extractMainXml(can3);
  // Match only DEFINITION sites: `<CSceneSource exportMotionFile="true"
  // xs.id="#NN">`. The `xs.id` attribute is present only on definitions;
  // references use `xs.ref` (which dwarfs the count to ~10 per scene).
  assertEq(count(xml, '<CSceneSource exportMotionFile="true"'), 1,
    '1c: exactly 1 CSceneSource definition (xs.id site)');
  assertEq(count(xml, '<s xs.n="sceneName">Idle</s>'), 1,
    '1d: sceneName=Idle present in XML');
  assertEq(count(xml, '<CAnimation xs.id'), 1,
    '1e: exactly 1 CAnimation definition');
  assert(xml.includes('model.cmo3'), '1f: cmo3FileName referenced');
}

// ── 2. Multi-action can3 — N actions → N CSceneSource ──────────────────────

{
  const actions = [
    makeAction({ id: 'idle', name: 'Idle', fcurves: [paramFc('ParamA', [{ time: 0, value: 0 }])] }),
    makeAction({ id: 'wave', name: 'Wave', fcurves: [paramFc('ParamB', [{ time: 0, value: 0 }])] }),
    makeAction({ id: 'blink', name: 'Blink', fcurves: [paramFc('ParamC', [{ time: 0, value: 0 }])] }),
  ];

  const can3 = await generateCan3({
    actions, deformerParamMap: new Map(),
    cmo3FileName: 'model.cmo3', canvasW: 1024, canvasH: 1024,
  });

  const xml = await extractMainXml(can3);
  assertEq(count(xml, '<CSceneSource exportMotionFile="true"'), 3,
    '2: 3 CSceneSource definitions for 3 actions');
  assert(xml.includes('<s xs.n="sceneName">Idle</s>'), '2a: Idle scene');
  assert(xml.includes('<s xs.n="sceneName">Wave</s>'), '2b: Wave scene');
  assert(xml.includes('<s xs.n="sceneName">Blink</s>'), '2c: Blink scene');

  // Per-action sceneGuid uniqueness — three CSceneGuid DEFINITIONS
  // (the ones with `uuid="..." note="..." xs.id="..."`; refs are
  // `<CSceneGuid xs.n="guid" xs.ref="...">`).
  const sceneGuidDefs = count(xml, '<CSceneGuid uuid=');
  assertEq(sceneGuidDefs, 3,
    `2d: 3 CSceneGuid definitions (got ${sceneGuidDefs})`);
}

// ── 3. sceneName sanitisation: non-alphanumeric → underscore ───────────────

{
  const action = makeAction({
    id: 'a', name: 'Hello World! @#$',
    fcurves: [paramFc('P', [{ time: 0, value: 0 }])],
  });
  const can3 = await generateCan3({
    actions: [action], deformerParamMap: new Map(),
    cmo3FileName: 'model.cmo3', canvasW: 1024, canvasH: 1024,
  });
  const xml = await extractMainXml(can3);
  // sceneEmit.js line 70: `.replace(/[^a-zA-Z0-9_-]/g, '_')`
  // 'Hello World! @#$' → 'Hello_World______'
  assert(xml.includes('<s xs.n="sceneName">Hello_World'),
    '3: non-alphanumeric chars sanitised to underscore');
  // No literal '!' / '@' / '#' / '$' inside sceneName tag
  const sceneNameStart = xml.indexOf('<s xs.n="sceneName">');
  const sceneNameEnd = xml.indexOf('</s>', sceneNameStart);
  const sceneNameContent = xml.substring(sceneNameStart, sceneNameEnd);
  assert(!sceneNameContent.includes('!'), '3a: no ! survived in sceneName');
  assert(!sceneNameContent.includes('@'), '3b: no @ survived in sceneName');
}

// ── 4. paramInfoList unifies deformerParamMap + param-fcurves ──────────────

{
  // Rotation deformer params come via deformerParamMap; param-target
  // fcurves come via action.fcurves[]. Both should emit CParameterGuid
  // entries (one per unique paramId).
  const action = makeAction({
    id: 'a', name: 'A',
    fcurves: [paramFc('ParamBreath', [{ time: 0, value: 0 }])],
  });
  const dpm = new Map([
    ['leftArm', { paramId: 'ParamRotation_leftArm', min: -30, max: 30, rest: 0 }],
  ]);

  const can3 = await generateCan3({
    actions: [action], deformerParamMap: dpm,
    cmo3FileName: 'model.cmo3', canvasW: 1024, canvasH: 1024,
  });

  const xml = await extractMainXml(can3);
  // Both paramIds should appear as `note=` attrs in CParameterGuid entries
  // (the `note` is set by xmlbuilder.shared('CParameterGuid', { note: info.paramId })).
  assert(xml.includes('ParamRotation_leftArm'),
    '4: deformerParamMap param surfaces in XML');
  assert(xml.includes('ParamBreath'),
    '4a: param-fcurve paramId surfaces in XML');
}

// ── 5. Action with empty fcurves still produces a CSceneSource ─────────────

{
  // Rest-pose case: the writer emits a single-keyframe MutableSequence
  // pinned at info.rest per sceneEmit.js line 119-124. The scene MUST
  // exist so multi-action exports never silently skip an action.
  const action = makeAction({ id: 'rest', name: 'RestPose', fcurves: [] });
  const dpm = new Map([
    ['leftArm', { paramId: 'ParamRotation_leftArm', min: -30, max: 30, rest: 0 }],
  ]);
  const can3 = await generateCan3({
    actions: [action], deformerParamMap: dpm,
    cmo3FileName: 'model.cmo3', canvasW: 1024, canvasH: 1024,
  });
  const xml = await extractMainXml(can3);
  assertEq(count(xml, '<CSceneSource exportMotionFile="true"'), 1,
    '5: empty-fcurve action still emits 1 CSceneSource');
  assert(xml.includes('<s xs.n="sceneName">RestPose</s>'),
    '5a: sceneName preserved');
  // The rotation param should still emit its CMvAttrF entry (with rest
  // value from the deformerParamMap), so the scene is loadable in Cubism
  // Editor without crashing.
  assert(xml.includes('ParamRotation_leftArm'),
    '5b: deformer param emits even on empty action');
}

// ── 6. fps + duration carried through to scene movieInfo / Root track ──────

{
  const action = makeAction({
    id: 'fps60', name: 'Fps60', fps: 60, duration: 2000,
    fcurves: [paramFc('P', [{ time: 0, value: 0 }])],
  });
  const can3 = await generateCan3({
    actions: [action], deformerParamMap: new Map(),
    cmo3FileName: 'model.cmo3', canvasW: 1024, canvasH: 1024,
  });
  const xml = await extractMainXml(can3);
  // movieInfo.fps from action.fps
  assert(xml.includes('<d xs.n="fps">60.0</d>'),
    '6: action.fps → CMvMovieInfo.fps');
  // durationFrames = round(2000 * 60 / 1000) = 120
  assert(xml.includes('<i xs.n="duration">120</i>'),
    '6a: action.duration + fps → 120 frames');
}

// ── 7. modelName is referenced in CAnimation.name ──────────────────────────

{
  const action = makeAction({ id: 'a', name: 'A', fcurves: [paramFc('P', [{ time: 0, value: 0 }])] });
  const can3 = await generateCan3({
    actions: [action], deformerParamMap: new Map(),
    cmo3FileName: 'shelby.cmo3', canvasW: 1024, canvasH: 1024,
    modelName: 'Shelby Export',
  });
  const xml = await extractMainXml(can3);
  assert(xml.includes('Shelby Export'),
    '7: modelName surfaces in CAnimation');
  assert(xml.includes('shelby.cmo3'),
    '7a: cmo3FileName surfaces as resource ref');
}

// ── 8. Canvas dimensions reach movieInfo bounds ────────────────────────────

{
  const action = makeAction({ id: 'a', name: 'A', fcurves: [paramFc('P', [{ time: 0, value: 0 }])] });
  const can3 = await generateCan3({
    actions: [action], deformerParamMap: new Map(),
    cmo3FileName: 'model.cmo3', canvasW: 800, canvasH: 600,
  });
  const xml = await extractMainXml(can3);
  // model track bounds line: <f xs.n="width">800.0</f> / height=600.0
  assert(xml.includes('<f xs.n="width">800.0</f>'),
    '8: canvasW reaches model track bounds');
  assert(xml.includes('<f xs.n="height">600.0</f>'),
    '8a: canvasH reaches model track bounds');
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nactionExportCan3: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
