// scripts/test/test_autoKeyDispatch.mjs — Phase 7 Slice 7.D substrate.
//
// Verifies:
//   §1 getAutoKeyMode — coalesce sparse field, reject unknown values
//   §2 pickActiveSetIdForAutoKey — active KS wins, fallback to LocRotScale
//   §3 runAutoKey('all') — dispatches synthetic K-key (legacy path)
//   §4 runAutoKey('activeSet') — invokes execApplyKeyingSet with active
//   §5 runAutoKey('available') — invokes execApplyKeyingSet('Available')
//   §6 sparse storage — autoKeyMode 'all' coalesces from missing field

import {
  AUTOKEY_MODES,
  getAutoKeyMode,
  pickActiveSetIdForAutoKey,
  runAutoKey,
} from '../../src/anim/autoKeyDispatch.js';

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

// Window stub for synthetic-K-dispatch verification.
// Node 20+ has KeyboardEvent global; if not, we stub it.
if (typeof globalThis.KeyboardEvent === 'undefined') {
  globalThis.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.key = init.key;
      this.code = init.code;
    }
  };
}
const dispatched = [];
globalThis.window = globalThis.window ?? {
  dispatchEvent(ev) {
    dispatched.push({ type: ev.type, key: ev.key, code: ev.code });
    return true;
  },
};
if (!globalThis.window.dispatchEvent) {
  globalThis.window.dispatchEvent = (ev) => {
    dispatched.push({ type: ev.type, key: ev.key, code: ev.code });
    return true;
  };
}
function resetDispatched() { dispatched.length = 0; }

function makeProject() {
  return {
    nodes: [
      { id: '__scene__', type: 'scene', name: 'Scene', animData: { actionId: 'sceneAct' } },
      {
        id: 'partA',
        type: 'part',
        name: 'PartA',
        animData: { actionId: 'partAct' },
      },
    ],
    actions: [
      { id: 'sceneAct', name: 'SceneAction', fcurves: [] },
      { id: 'partAct',  name: 'PartAction',  fcurves: [] },
    ],
    parameters: [
      { id: 'ParamSmile', default: 0.3, min: 0, max: 1 },
    ],
    keyingSets: [],
    activeKeyingSetId: null,
  };
}

// ── §1 getAutoKeyMode ────────────────────────────────────────────────
console.log('\n§1 getAutoKeyMode coalescing');
{
  eq(getAutoKeyMode(null), 'all', '§1.1 null project → all');
  eq(getAutoKeyMode(undefined), 'all', '§1.1 undefined → all');
  eq(getAutoKeyMode({}), 'all', '§1.1 missing field → all');
  eq(getAutoKeyMode({ autoKeyMode: null }), 'all', '§1.1 null field → all');
  eq(getAutoKeyMode({ autoKeyMode: undefined }), 'all', '§1.1 undefined field → all');

  eq(getAutoKeyMode({ autoKeyMode: 'all' }), 'all', '§1.2 explicit all');
  eq(getAutoKeyMode({ autoKeyMode: 'activeSet' }), 'activeSet', '§1.2 activeSet passes through');
  eq(getAutoKeyMode({ autoKeyMode: 'available' }), 'available', '§1.2 available passes through');

  // Unknown value coalesces to 'all' with console.warn (silence test stderr)
  const origWarn = console.warn;
  let warned = '';
  console.warn = (msg) => { warned = msg; };
  try {
    eq(getAutoKeyMode({ autoKeyMode: 'bogus' }), 'all', '§1.3 unknown value → all');
    ok(warned.includes('bogus'), '§1.3 unknown value logs warning');
  } finally {
    console.warn = origWarn;
  }

  // Frozen tuple sanity
  ok(Object.isFrozen(AUTOKEY_MODES), '§1.4 AUTOKEY_MODES is frozen');
  eq(AUTOKEY_MODES.length, 3, '§1.4 AUTOKEY_MODES has 3 entries');
}

// ── §2 pickActiveSetIdForAutoKey ─────────────────────────────────────
console.log('\n§2 pickActiveSetIdForAutoKey');
{
  // No project / no active → LocRotScale fallback
  eq(pickActiveSetIdForAutoKey(null), 'LocRotScale', '§2.1 null project → LocRotScale');
  eq(pickActiveSetIdForAutoKey({}), 'LocRotScale', '§2.1 empty project → LocRotScale');
  eq(pickActiveSetIdForAutoKey({ activeKeyingSetId: null }), 'LocRotScale', '§2.1 null active → LocRotScale');

  // Built-in active wins
  const proj = makeProject();
  proj.activeKeyingSetId = 'Rotation';
  eq(pickActiveSetIdForAutoKey(proj), 'Rotation', '§2.2 active built-in wins');

  proj.activeKeyingSetId = 'BlendShape';
  eq(pickActiveSetIdForAutoKey(proj), 'BlendShape', '§2.2 BlendShape active wins');

  // Unknown active id → getActiveKeyingSet returns null → fallback
  proj.activeKeyingSetId = 'GhostSet';
  eq(pickActiveSetIdForAutoKey(proj), 'LocRotScale', '§2.3 stale active id → LocRotScale fallback');
}

// ── §3 runAutoKey('all') — synthetic K-key dispatch ──────────────────
console.log('\n§3 runAutoKey all mode');
{
  resetDispatched();
  const r = runAutoKey({ autoKeyMode: 'all' });
  eq(r.mode, 'all', '§3.1 returns mode=all');
  eq(r.dispatched, 'synthetic-K-keydown', '§3.1 returns synthetic-K dispatch');
  eq(dispatched.length, 1, '§3.2 dispatched exactly one event');
  eq(dispatched[0].type, 'keydown', '§3.2 event type=keydown');
  eq(dispatched[0].key, 'K', '§3.2 event key=K');
  eq(dispatched[0].code, 'KeyK', '§3.2 event code=KeyK');

  // Default mode (sparse) also dispatches K
  resetDispatched();
  runAutoKey({});
  eq(dispatched.length, 1, '§3.3 sparse autoKeyMode (=all default) dispatches K');
  eq(dispatched[0].key, 'K', '§3.3 sparse default → K event');
}

// ── §4 runAutoKey('activeSet') — execApplyKeyingSet integration ──────
console.log('\n§4 runAutoKey activeSet mode');
{
  // execApplyKeyingSet reads from useProjectStore — to verify it was
  // invoked without mocking the operator surface, we set up the store
  // and check that the project draft was mutated.
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

  // §4.1 explicit active = Rotation → execApplyKeyingSet writes rotation channel
  const proj41 = makeProject();
  proj41.activeKeyingSetId = 'Rotation';
  proj41.autoKeyMode = 'activeSet';
  useProjectStore.setState({ project: proj41, hasUnsavedChanges: false });
  useAnimationStore.setState({ currentTime: 1000 });
  useParamValuesStore.setState({ values: {} });
  useEditorStore.setState({ selection: ['partA'] });
  proj41.nodes.find((n) => n.id === 'partA').transform = { x: 0, y: 0, rotation: 0.42, scaleX: 1, scaleY: 1, opacity: 1 };

  resetDispatched();
  const r41 = runAutoKey(useProjectStore.getState().project);
  eq(r41.mode, 'activeSet', '§4.1 mode=activeSet');
  eq(r41.dispatched, 'Rotation', '§4.1 dispatched=Rotation (active set id)');
  eq(dispatched.length, 0, '§4.1 NO synthetic-K dispatched');
  const partAct = useProjectStore.getState().project.actions.find((a) => a.id === 'partAct');
  const fcRot = partAct.fcurves.find((f) => f.rnaPath.endsWith('.transform.rotation'));
  ok(fcRot, '§4.1 Rotation set wrote transform.rotation fcurve');
  eq(fcRot.keyforms[0].value, 0.42, '§4.1 rotation keyed at 0.42');

  // §4.2 no active set → LocRotScale fallback
  const proj42 = makeProject();
  proj42.autoKeyMode = 'activeSet';
  proj42.nodes.find((n) => n.id === 'partA').transform = { x: 5, y: 6, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  useProjectStore.setState({ project: proj42 });
  useEditorStore.setState({ selection: ['partA'] });
  useAnimationStore.setState({ currentTime: 500 });
  const r42 = runAutoKey(useProjectStore.getState().project);
  eq(r42.dispatched, 'LocRotScale', '§4.2 no active → LocRotScale fallback');
  const partAct42 = useProjectStore.getState().project.actions.find((a) => a.id === 'partAct');
  const fcX = partAct42.fcurves.find((f) => f.rnaPath.endsWith('.transform.x'));
  const fcY = partAct42.fcurves.find((f) => f.rnaPath.endsWith('.transform.y'));
  ok(fcX && fcY, '§4.2 LocRotScale wrote x/y');
  eq(fcX.keyforms[0].value, 5, '§4.2 transform.x = 5');
  eq(fcY.keyforms[0].value, 6, '§4.2 transform.y = 6');
}

// ── §5 runAutoKey('available') — Available set integration ───────────
console.log('\n§5 runAutoKey available mode');
{
  const { useProjectStore } = await import('../../src/store/projectStore.js');
  const { useAnimationStore } = await import('../../src/store/animationStore.js');
  const { useEditorStore } = await import('../../src/store/editorStore.js');

  // §5.1 no existing fcurves → Available emits empty channel list → 0 writes
  const proj51 = makeProject();
  proj51.autoKeyMode = 'available';
  useProjectStore.setState({ project: proj51 });
  useAnimationStore.setState({ currentTime: 1000 });
  useEditorStore.setState({ selection: ['partA'] });

  resetDispatched();
  const r51 = runAutoKey(useProjectStore.getState().project);
  eq(r51.mode, 'available', '§5.1 mode=available');
  eq(r51.dispatched, 'Available', '§5.1 dispatched=Available');
  eq(dispatched.length, 0, '§5.1 NO synthetic-K dispatched');
  const partAct51 = useProjectStore.getState().project.actions.find((a) => a.id === 'partAct');
  eq(partAct51.fcurves.length, 0, '§5.1 no existing fcurves → no new fcurves written');

  // §5.2 with one pre-existing fcurve → only that channel is keyed at new time
  const proj52 = makeProject();
  proj52.autoKeyMode = 'available';
  proj52.actions.find((a) => a.id === 'partAct').fcurves.push({
    id: 'partA.transform.x',
    rnaPath: 'objects["partA"].transform.x',
    arrayIndex: 0,
    keyforms: [{ time: 0, value: 0, handleLeft: { time: -1, value: 0 }, handleRight: { time: 1, value: 0 }, handleType: { left: 'auto', right: 'auto' }, interpolation: 'bezier', flag: 0 }],
    modifiers: [],
    extrapolation: 'constant',
  });
  proj52.nodes.find((n) => n.id === 'partA').transform = { x: 17, y: 99, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  useProjectStore.setState({ project: proj52 });
  useEditorStore.setState({ selection: ['partA'] });
  useAnimationStore.setState({ currentTime: 2000 });
  runAutoKey(useProjectStore.getState().project);
  const partAct52 = useProjectStore.getState().project.actions.find((a) => a.id === 'partAct');
  eq(partAct52.fcurves.length, 1, '§5.2 Available filtered to 1 existing fcurve (no transform.y created)');
  const fcX = partAct52.fcurves[0];
  eq(fcX.keyforms.length, 2, '§5.2 existing fcurve got a 2nd keyform (was 1)');
  const newKf = fcX.keyforms.find((k) => k.time === 2000);
  ok(newKf, '§5.2 new keyform inserted at time=2000');
  eq(newKf.value, 17, '§5.2 new keyform value = current transform.x (17)');
}

// ── §6 sparse storage roundtrip ──────────────────────────────────────
console.log('\n§6 sparse storage');
{
  // Empty project (no autoKeyMode field) — behaves as 'all'
  const proj = makeProject();
  ok(!('autoKeyMode' in proj), '§6.1 fresh project has no autoKeyMode field');
  eq(getAutoKeyMode(proj), 'all', '§6.1 fresh project mode = all');

  // Explicit 'all' is functionally equivalent to missing
  proj.autoKeyMode = 'all';
  eq(getAutoKeyMode(proj), 'all', '§6.2 explicit all = missing');

  // Setting then deleting returns to default behavior
  proj.autoKeyMode = 'activeSet';
  eq(getAutoKeyMode(proj), 'activeSet', '§6.3 explicit activeSet honored');
  delete proj.autoKeyMode;
  eq(getAutoKeyMode(proj), 'all', '§6.3 delete restores default');
}

// ── summary ──────────────────────────────────────────────────────────
console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
