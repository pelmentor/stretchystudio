// scripts/test/test_keyingSetMenu.mjs — Phase 7 Slice 7.C substrate.
//
// Verifies:
//   §1 pickDefaultKeyingSet — every selection/mode branch + degenerate inputs
//   §2 buildLiveResolver — paramValuesStore-aware __params__ routing + fallthrough
//   §3 applyKeyingSet integration — live resolver overrides static defaults
//   §4 menu enumeration sanity — listKeyingSets order matches BUILTIN_KEYING_SET_IDS

import { pickDefaultKeyingSet } from '../../src/anim/keyingSetDefault.js';
import { buildLiveResolver } from '../../src/anim/insertKeyframeResolver.js';
import {
  applyKeyingSet,
  INSERTKEY_FLAGS,
} from '../../src/anim/insertKeyframe.js';
import {
  listKeyingSets,
  BUILTIN_KEYING_SET_IDS,
  addKeyingSet,
} from '../../src/anim/keyingSets.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; } else { fail += 1; console.error(`FAIL: ${msg}`); }
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) console.error(`expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
  ok(same, msg);
}

function makeProject() {
  return {
    nodes: [
      {
        id: '__scene__',
        type: 'scene',
        name: 'Scene',
        animData: { actionId: 'sceneAct' },
      },
      {
        id: 'partA',
        type: 'part',
        name: 'PartA',
        animData: { actionId: 'partAct' },
        blendShapes: [
          { id: 'shapeAlpha' },
          { id: 'shapeBeta' },
        ],
        blendShapeValues: { shapeAlpha: 0, shapeBeta: 0.4 },
      },
      {
        id: 'partB',
        type: 'part',
        name: 'PartB',
      },
      {
        id: 'boneArm',
        type: 'group',
        name: 'Arm',
        boneRole: 'leftElbow',
        animData: { actionId: 'boneAct' },
        pose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      },
      {
        id: 'plainGroup',
        type: 'group',
        name: 'Group',
        // no boneRole → non-bone group; picker should skip past it
      },
    ],
    actions: [
      { id: 'sceneAct', name: 'SceneAction', fcurves: [] },
      { id: 'partAct',  name: 'PartAction',  fcurves: [] },
      { id: 'boneAct',  name: 'BoneAction',  fcurves: [] },
    ],
    parameters: [
      { id: 'ParamAngleZ', default: 0,   min: -30, max: 30 },
      { id: 'ParamSmile',  default: 0.2, min: 0,   max: 1 },
    ],
    keyingSets: [],
    activeKeyingSetId: null,
  };
}

// ── §1 pickDefaultKeyingSet ──────────────────────────────────────────
console.log('\n§1 pickDefaultKeyingSet branches');
{
  const proj = makeProject();

  // §1.1 null/undefined inputs
  eq(pickDefaultKeyingSet(null), null, '§1.1 null ctx → null');
  eq(pickDefaultKeyingSet({ project: null, selection: [] }), null, '§1.1 null project → null');
  eq(pickDefaultKeyingSet({ project: proj, selection: null }), null, '§1.1 null selection → null');
  eq(pickDefaultKeyingSet({ project: proj, selection: [] }), null, '§1.1 empty selection → null');

  // §1.2 BlendShape mode wins regardless of selection
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['boneArm'], activeBlendShapeId: 'shapeAlpha' }),
    'BlendShape',
    '§1.2 activeBlendShapeId + matching owner → BlendShape',
  );
  // Stale activeBlendShapeId (no matching owner) falls through to selection rules
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['boneArm'], activeBlendShapeId: 'shapeMissing' }),
    'Rotation',
    '§1.2 stale activeBlendShapeId → falls through to bone rule',
  );
  // BlendShape wins even when selection is empty (active shape is the
  // "selection" in BlendShape mode)
  eq(
    pickDefaultKeyingSet({ project: proj, selection: [], activeBlendShapeId: 'shapeBeta' }),
    'BlendShape',
    '§1.2 BlendShape wins with empty selection',
  );

  // §1.3 bone-role group → Rotation
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['boneArm'] }),
    'Rotation',
    '§1.3 bone group → Rotation',
  );

  // §1.4 meshed part → LocRotScale
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['partA'] }),
    'LocRotScale',
    '§1.4 meshed part → LocRotScale',
  );
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['partB'] }),
    'LocRotScale',
    '§1.4 part without blend shapes → LocRotScale',
  );

  // §1.5 LAST→FIRST walk (matches SS active-item semantic)
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['boneArm', 'partA'] }),
    'LocRotScale',
    '§1.5 last item wins (part after bone)',
  );
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['partA', 'boneArm'] }),
    'Rotation',
    '§1.5 last item wins (bone after part)',
  );

  // §1.6 non-bone group skipped, next selection inspected
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['partA', 'plainGroup'] }),
    'LocRotScale',
    '§1.6 non-bone group skipped → falls back to earlier part',
  );

  // §1.7 unknown id silently skipped
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['ghost', 'partA'] }),
    'LocRotScale',
    '§1.7 unknown id skipped',
  );
  eq(
    pickDefaultKeyingSet({ project: proj, selection: ['ghost'] }),
    null,
    '§1.7 only-unknown selection → null',
  );
}

// ── §2 buildLiveResolver ──────────────────────────────────────────────
console.log('\n§2 buildLiveResolver');
{
  const proj = makeProject();

  // §2.1 live store overrides static default
  const live = { ParamAngleZ: 12.5, ParamSmile: 0.8 };
  const r = buildLiveResolver(proj, live);
  eq(r('objects["__params__"].values["ParamAngleZ"]'), 12.5, '§2.1 live ParamAngleZ → 12.5');
  eq(r('objects["__params__"].values["ParamSmile"]'),  0.8,  '§2.1 live ParamSmile → 0.8');

  // §2.2 missing live entry → falls through to default-resolver
  // (which returns project.parameters[*].default for __params__)
  const partial = { ParamAngleZ: 7 };
  const r2 = buildLiveResolver(proj, partial);
  eq(r2('objects["__params__"].values["ParamAngleZ"]'), 7, '§2.2 live ParamAngleZ wins');
  eq(r2('objects["__params__"].values["ParamSmile"]'), 0.2, '§2.2 missing live ParamSmile → default 0.2');

  // §2.3 non-__params__ path always routes through evaluateRnaPath
  const r3 = buildLiveResolver(proj, live);
  proj.nodes.find((n) => n.id === 'partA').transform = { x: 99, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  eq(r3('objects["partA"].transform.x'), 99, '§2.3 non-__params__ path uses evaluateRnaPath');

  // §2.4 null paramValues → behaves like default resolver
  const r4 = buildLiveResolver(proj, null);
  eq(r4('objects["__params__"].values["ParamSmile"]'), 0.2, '§2.4 null paramValues → default');

  // §2.5 malformed input
  eq(r('foo bar'), undefined, '§2.5 garbage path → undefined');
  eq(r(''), undefined, '§2.5 empty path → undefined');
  // @ts-ignore -- test the runtime guard
  eq(r(null), undefined, '§2.5 null path → undefined');

  // §2.6 NaN/Infinity live value → fall through to default
  const badLive = { ParamSmile: NaN, ParamAngleZ: Infinity };
  const r5 = buildLiveResolver(proj, badLive);
  eq(r5('objects["__params__"].values["ParamSmile"]'), 0.2, '§2.6 NaN live → default');
  eq(r5('objects["__params__"].values["ParamAngleZ"]'), 0,  '§2.6 Infinity live → default');
}

// ── §3 applyKeyingSet integration with live resolver ─────────────────
console.log('\n§3 applyKeyingSet + live resolver');
{
  const proj = makeProject();
  // AllParams keying set targets __params__ paths exclusively.
  // Without the live resolver, the keyed value = project.parameters
  // [*].default (0 for ParamAngleZ, 0.2 for ParamSmile).
  // With the live resolver, the keyed value = live store value.

  // §3.1 default resolver bakes static defaults
  const projDefault = makeProject();
  applyKeyingSet(projDefault, 'AllParams', [], 1000, INSERTKEY_FLAGS.NOFLAGS);
  const sceneActDefault = projDefault.actions.find((a) => a.id === 'sceneAct');
  const fcAngleDefault = sceneActDefault.fcurves.find((f) => f.rnaPath.includes('ParamAngleZ'));
  ok(fcAngleDefault, '§3.1 default-resolver created ParamAngleZ fcurve');
  eq(fcAngleDefault.keyforms[0].value, 0, '§3.1 default-resolver keyed value = 0 (static default)');

  // §3.2 live resolver overrides
  const projLive = makeProject();
  const live = { ParamAngleZ: 15.5, ParamSmile: 0.9 };
  const resolver = buildLiveResolver(projLive, live);
  applyKeyingSet(projLive, 'AllParams', [], 1000, INSERTKEY_FLAGS.NOFLAGS, { resolveValue: resolver });
  const sceneActLive = projLive.actions.find((a) => a.id === 'sceneAct');
  const fcAngleLive = sceneActLive.fcurves.find((f) => f.rnaPath.includes('ParamAngleZ'));
  const fcSmileLive = sceneActLive.fcurves.find((f) => f.rnaPath.includes('ParamSmile'));
  ok(fcAngleLive, '§3.2 live-resolver created ParamAngleZ fcurve');
  ok(fcSmileLive, '§3.2 live-resolver created ParamSmile fcurve');
  eq(fcAngleLive.keyforms[0].value, 15.5, '§3.2 live-resolver keyed ParamAngleZ = 15.5');
  eq(fcSmileLive.keyforms[0].value, 0.9,  '§3.2 live-resolver keyed ParamSmile = 0.9');

  // §3.3 mixed path: LocRotScale on partA uses evaluateRnaPath
  // (non-__params__ paths bypass the live overlay).
  const projMixed = makeProject();
  projMixed.nodes.find((n) => n.id === 'partA').transform = { x: 42, y: -7, rotation: 0.5, scaleX: 1, scaleY: 1, opacity: 1 };
  const resolverMixed = buildLiveResolver(projMixed, { ParamAngleZ: 99 });
  applyKeyingSet(projMixed, 'LocRotScale', ['partA'], 1000, INSERTKEY_FLAGS.NOFLAGS, { resolveValue: resolverMixed });
  const partAct = projMixed.actions.find((a) => a.id === 'partAct');
  const fcX = partAct.fcurves.find((f) => f.rnaPath.endsWith('.transform.x'));
  const fcY = partAct.fcurves.find((f) => f.rnaPath.endsWith('.transform.y'));
  const fcRot = partAct.fcurves.find((f) => f.rnaPath.endsWith('.transform.rotation'));
  ok(fcX && fcY && fcRot, '§3.3 LocRotScale created x/y/rotation fcurves');
  eq(fcX.keyforms[0].value, 42,   '§3.3 transform.x = 42 (from project)');
  eq(fcY.keyforms[0].value, -7,   '§3.3 transform.y = -7 (from project)');
  eq(fcRot.keyforms[0].value, 0.5, '§3.3 transform.rotation = 0.5 (from project)');
}

// ── §4 menu enumeration sanity ───────────────────────────────────────
console.log('\n§4 listKeyingSets order + user-defined append');
{
  const proj = makeProject();
  const sets = listKeyingSets(proj);
  ok(sets.length === BUILTIN_KEYING_SET_IDS.length, '§4 listKeyingSets returns all built-ins');
  for (let i = 0; i < BUILTIN_KEYING_SET_IDS.length; i++) {
    eq(sets[i].id, BUILTIN_KEYING_SET_IDS[i], `§4 set[${i}] id matches BUILTIN_KEYING_SET_IDS[${i}]`);
    ok(sets[i].isBuiltin === true, `§4 set[${i}] isBuiltin=true`);
  }

  // User-defined set appends after built-ins
  addKeyingSet(proj, {
    id: 'CustomTorso',
    label: 'Custom Torso',
    paths: [{ path: 'objects["partA"].transform.x' }],
  });
  const sets2 = listKeyingSets(proj);
  ok(sets2.length === BUILTIN_KEYING_SET_IDS.length + 1, '§4 user set appended');
  eq(sets2[sets2.length - 1].id, 'CustomTorso', '§4 user set appears last');
  ok(sets2[sets2.length - 1].isBuiltin === false, '§4 user set isBuiltin=false');

  // Shadowing attempt (re-using a built-in id) silently dropped per
  // listKeyingSets contract — addKeyingSet may store it but list
  // skips. Add directly to project.keyingSets to bypass addKeyingSet
  // throw.
  proj.keyingSets.push({ id: 'LocRotScale', label: 'Shadow', paths: [] });
  const sets3 = listKeyingSets(proj);
  ok(
    sets3.filter((s) => s.id === 'LocRotScale').length === 1,
    '§4 shadowing built-in id silently dropped',
  );
}

// ── §5 execApplyKeyingSet guard sequence (operator-level smoke) ──────
// Audit-fix LOW-1 (2026-05-19 sweep #80): close the test-coverage gap
// on the operator wiring layer. The substrate tests cover
// applyKeyingSet + buildLiveResolver + pickDefaultKeyingSet as pure
// functions; this section exercises the Zustand-store guard sequence
// inside execApplyKeyingSet that wraps them. Each guard branch is
// observable via the project draft NOT being mutated (the function
// toasts then returns before the updateProject recipe runs).
console.log('\n§5 execApplyKeyingSet guard sequence');
{
  const { execApplyKeyingSet } = await import('../../src/v3/operators/insertKey.js');
  const { useProjectStore } = await import('../../src/store/projectStore.js');
  const { useAnimationStore } = await import('../../src/store/animationStore.js');
  const { useParamValuesStore } = await import('../../src/store/paramValuesStore.js');
  const { useEditorStore } = await import('../../src/store/editorStore.js');

  function fcurveCount(project) {
    if (!project || !Array.isArray(project.actions)) return 0;
    return project.actions.reduce(
      (acc, a) => acc + (Array.isArray(a.fcurves) ? a.fcurves.length : 0),
      0,
    );
  }

  // §5.1 null project → guard returns before recipe
  useProjectStore.setState({ project: null, hasUnsavedChanges: false });
  useAnimationStore.setState({ currentTime: 1000 });
  useParamValuesStore.setState({ values: {} });
  useEditorStore.setState({ selection: ['partA'] });
  execApplyKeyingSet('LocRotScale');
  ok(useProjectStore.getState().project === null, '§5.1 null project → no mutation (project still null)');

  // §5.2 empty/non-string setId → guard returns before recipe
  useProjectStore.setState({ project: makeProject() });
  const before52 = fcurveCount(useProjectStore.getState().project);
  execApplyKeyingSet('');
  eq(fcurveCount(useProjectStore.getState().project), before52, '§5.2a empty setId → no fcurves added');
  execApplyKeyingSet(null);
  eq(fcurveCount(useProjectStore.getState().project), before52, '§5.2b null setId → no fcurves added');

  // §5.3 unknown setId → getKeyingSet returns null, guard returns
  useProjectStore.setState({ project: makeProject() });
  const before53 = fcurveCount(useProjectStore.getState().project);
  execApplyKeyingSet('NotARealKeyingSet');
  eq(fcurveCount(useProjectStore.getState().project), before53, '§5.3 unknown setId → no fcurves added');

  // §5.4 non-finite time → guard returns
  useProjectStore.setState({ project: makeProject() });
  useAnimationStore.setState({ currentTime: NaN });
  const before54 = fcurveCount(useProjectStore.getState().project);
  execApplyKeyingSet('AllParams');
  eq(fcurveCount(useProjectStore.getState().project), before54, '§5.4a NaN currentTime → no fcurves added');
  useAnimationStore.setState({ currentTime: Infinity });
  execApplyKeyingSet('AllParams');
  eq(fcurveCount(useProjectStore.getState().project), before54, '§5.4b Infinity currentTime → no fcurves added');

  // §5.5 happy path — guards pass, project mutates with live-resolver values
  useProjectStore.setState({ project: makeProject() });
  useAnimationStore.setState({ currentTime: 2000 });
  useParamValuesStore.setState({ values: { ParamAngleZ: 17.5, ParamSmile: 0.7 } });
  useEditorStore.setState({ selection: [] });
  execApplyKeyingSet('AllParams');
  const projAfter = useProjectStore.getState().project;
  const sceneAct = projAfter.actions.find((a) => a.id === 'sceneAct');
  const fcAngle = sceneAct.fcurves.find((f) => f.rnaPath.includes('ParamAngleZ'));
  const fcSmile = sceneAct.fcurves.find((f) => f.rnaPath.includes('ParamSmile'));
  ok(fcAngle, '§5.5 happy path created ParamAngleZ fcurve');
  ok(fcSmile, '§5.5 happy path created ParamSmile fcurve');
  eq(fcAngle.keyforms[0].value, 17.5, '§5.5 ParamAngleZ keyed at live value 17.5');
  eq(fcSmile.keyforms[0].value, 0.7,  '§5.5 ParamSmile keyed at live value 0.7');
  eq(fcAngle.keyforms[0].time, 2000,  '§5.5 ParamAngleZ keyed at currentTime 2000');

  // §5.6 LocRotScale on selected part — exercises the selection path
  useProjectStore.setState({ project: makeProject() });
  useProjectStore.getState().updateProject((p) => {
    const n = p.nodes.find((x) => x.id === 'partA');
    n.transform = { x: 11, y: 22, rotation: 0.3, scaleX: 1, scaleY: 1, opacity: 1 };
  });
  useAnimationStore.setState({ currentTime: 500 });
  useEditorStore.setState({ selection: ['partA'] });
  execApplyKeyingSet('LocRotScale');
  const partAct = useProjectStore.getState().project.actions.find((a) => a.id === 'partAct');
  const fcX = partAct.fcurves.find((f) => f.rnaPath.endsWith('.transform.x'));
  const fcY = partAct.fcurves.find((f) => f.rnaPath.endsWith('.transform.y'));
  ok(fcX && fcY, '§5.6 LocRotScale created x/y on selected part');
  eq(fcX.keyforms[0].value, 11, '§5.6 transform.x keyed at 11');
  eq(fcY.keyforms[0].value, 22, '§5.6 transform.y keyed at 22');
}

// ── §6 execSetActiveKeyingSet (Slice 7.I active-set toggle) ──────────
// The menu's per-row dot dispatches this operator. Logic-test it through
// the project store (same harness shape as §5). Mirrors Blender's
// ANIM_OT_keying_set_active_set; SS deviation = TOGGLE (re-pick clears).
console.log('\n§6 execSetActiveKeyingSet toggle');
{
  const { execSetActiveKeyingSet } = await import('../../src/v3/operators/insertKey.js');
  const { useProjectStore } = await import('../../src/store/projectStore.js');

  // §6.1 null project → no throw, no mutation
  useProjectStore.setState({ project: null, hasUnsavedChanges: false });
  execSetActiveKeyingSet('LocRotScale');
  ok(useProjectStore.getState().project === null, '§6.1 null project → no mutation');

  // §6.2 empty/garbage setId → guard returns, active stays null
  useProjectStore.setState({ project: makeProject() });
  execSetActiveKeyingSet('');
  eq(useProjectStore.getState().project.activeKeyingSetId, null, '§6.2a empty setId → active unchanged (null)');
  execSetActiveKeyingSet(null);
  eq(useProjectStore.getState().project.activeKeyingSetId, null, '§6.2b null setId → active unchanged (null)');

  // §6.3 unknown setId → guard returns, active stays null
  execSetActiveKeyingSet('NotARealKeyingSet');
  eq(useProjectStore.getState().project.activeKeyingSetId, null, '§6.3 unknown setId → active unchanged (null)');

  // §6.4 set a valid built-in active
  execSetActiveKeyingSet('LocRotScale');
  eq(useProjectStore.getState().project.activeKeyingSetId, 'LocRotScale', '§6.4 sets active to LocRotScale');

  // §6.5 picking a DIFFERENT set switches active (not toggle-off)
  execSetActiveKeyingSet('AllParams');
  eq(useProjectStore.getState().project.activeKeyingSetId, 'AllParams', '§6.5 switches active to AllParams');

  // §6.6 re-picking the active set toggles it OFF (SS deviation)
  execSetActiveKeyingSet('AllParams');
  eq(useProjectStore.getState().project.activeKeyingSetId, null, '§6.6 re-pick active → cleared to null');

  // §6.7 toggling a user-defined set works through the same path
  useProjectStore.setState({ project: makeProject() });
  useProjectStore.getState().updateProject((p) => {
    p.keyingSets.push({ id: 'CustomTorso', label: 'Custom Torso', paths: [{ path: 'objects["partA"].transform.x' }] });
  });
  execSetActiveKeyingSet('CustomTorso');
  eq(useProjectStore.getState().project.activeKeyingSetId, 'CustomTorso', '§6.7 sets user-defined set active');
}

// ── summary ──────────────────────────────────────────────────────────
console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
