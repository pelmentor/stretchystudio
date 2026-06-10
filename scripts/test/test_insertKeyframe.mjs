// scripts/test/test_insertKeyframe.mjs — Phase 7.B substrate.
//
// Verifies insert-keyframe kernel + applyKeyingSet operator + flag
// semantics (NEEDED, REPLACE, AVAILABLE) + per-channel result statuses.

import {
  INSERTKEY_FLAGS,
  applyKeyingSet,
  wouldApplyKeyingSetChange,
  insertKeyformAtInAction,
} from '../../src/anim/insertKeyframe.js';
import {
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

// Test fixture: project with __scene__ + partA (object) bound to actions.
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
      },
      {
        id: 'partB',
        type: 'part',
        name: 'PartB',
        // no animData → object has no action
      },
    ],
    actions: [
      { id: 'sceneAct', name: 'SceneAction', fcurves: [] },
      { id: 'partAct', name: 'PartAction', fcurves: [] },
    ],
    parameters: [
      { id: 'ParamAngleX', default: 0 },
      { id: 'ParamAngleZ', default: 0 },
    ],
    keyingSets: [],
    activeKeyingSetId: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Section 1 — INSERTKEY_FLAGS constants mirror Blender bit values
// ─────────────────────────────────────────────────────────────────────

eq(INSERTKEY_FLAGS.NOFLAGS, 0, '§1 — NOFLAGS = 0');
eq(INSERTKEY_FLAGS.NEEDED, 1, '§1 — NEEDED = 1<<0 (DNA_anim_enums.h:503)');
eq(INSERTKEY_FLAGS.REPLACE, 16, '§1 — REPLACE = 1<<4 (DNA_anim_enums.h:511)');
eq(INSERTKEY_FLAGS.AVAILABLE, 1024, '§1 — AVAILABLE = 1<<10 (DNA_anim_enums.h:523)');
ok(Object.isFrozen(INSERTKEY_FLAGS), '§1 — INSERTKEY_FLAGS is frozen');

// Combinable flags
const combined = INSERTKEY_FLAGS.NEEDED | INSERTKEY_FLAGS.REPLACE;
eq(combined & INSERTKEY_FLAGS.NEEDED, INSERTKEY_FLAGS.NEEDED, '§1 — bitwise OR composes correctly');
eq(combined & INSERTKEY_FLAGS.REPLACE, INSERTKEY_FLAGS.REPLACE, '§1 — NEEDED+REPLACE both present');

// ─────────────────────────────────────────────────────────────────────
// Section 2 — Basic insert on a Location set (creates new fcurves)
// ─────────────────────────────────────────────────────────────────────

let project = makeProject();
// Pretend the user has translated partA: x=10, y=20 in current value.
const stubValues = {
  'objects["partA"].transform.x': 10,
  'objects["partA"].transform.y': 20,
  'objects["__params__"].values["ParamAngleX"]': 0.5,
  'objects["__params__"].values["ParamAngleZ"]': 0.25,
};
const resolver = (path) => stubValues[path];

const r2 = applyKeyingSet(project, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: resolver,
});
eq(r2.count, 2, '§2 — Location set inserts 2 new fcurves on partA');
eq(r2.results.length, 2, '§2 — 2 per-channel results');
eq(r2.results[0].status, 'created-fcurve', '§2 — first result is created-fcurve');
eq(r2.results[1].status, 'created-fcurve', '§2 — second result is created-fcurve');

const partAct = project.actions.find((a) => a.id === 'partAct');
eq(partAct.fcurves.length, 2, '§2 — partAct now has 2 fcurves');
const fcX = partAct.fcurves.find((f) => f.rnaPath === 'objects["partA"].transform.x');
ok(fcX !== undefined, '§2 — transform.x fcurve created');
eq(fcX.keyforms.length, 1, '§2 — fresh fcurve has 1 keyform');
eq(fcX.keyforms[0].time, 100, '§2 — keyform.time = passed time (100ms)');
eq(fcX.keyforms[0].value, 10, '§2 — keyform.value = resolver value (10)');

// ─────────────────────────────────────────────────────────────────────
// Section 3 — Insert into existing fcurve at different time
// ─────────────────────────────────────────────────────────────────────

const r3 = applyKeyingSet(project, 'Location', ['partA'], 200, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: resolver,
});
eq(r3.count, 2, '§3 — second insert on Location set: 2 keys added');
eq(r3.results[0].status, 'inserted', '§3 — inserted (NOT created-fcurve; fcurve already exists)');
const fcXAfter = partAct.fcurves.find((f) => f.rnaPath === 'objects["partA"].transform.x');
eq(fcXAfter.keyforms.length, 2, '§3 — fcurve now has 2 keyforms');
eq(fcXAfter.keyforms[0].time, 100, '§3 — first keyform at 100ms (preserved)');
eq(fcXAfter.keyforms[1].time, 200, '§3 — second keyform at 200ms (just inserted)');

// ─────────────────────────────────────────────────────────────────────
// Section 4 — Insert at SAME time = replace (value updated)
// ─────────────────────────────────────────────────────────────────────

const stubValues4 = { ...stubValues };
stubValues4['objects["partA"].transform.x'] = 42; // changed value
const r4 = applyKeyingSet(project, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: (path) => stubValues4[path],
});
eq(r4.count, 2, '§4 — same-time insert: 2 replacements counted');
eq(r4.results[0].status, 'replaced', '§4 — status = replaced');
const fcXReplaced = partAct.fcurves.find((f) => f.rnaPath === 'objects["partA"].transform.x');
eq(fcXReplaced.keyforms.length, 2, '§4 — keyform count unchanged');
eq(fcXReplaced.keyforms[0].value, 42, '§4 — first keyform value REPLACED with new value');
// §3 inserted keyform at time=200 with resolver's original value 10 (not 20).
eq(fcXReplaced.keyforms[1].value, 10, '§4 — second keyform value unchanged (carried from §3 insert)');

// ─────────────────────────────────────────────────────────────────────
// Section 5 — INSERTKEY_NEEDED skips when current value matches eval
// ─────────────────────────────────────────────────────────────────────

let project5 = makeProject();
// Pre-seed an fcurve at time=100 with value=10.
project5.actions[1].fcurves.push({
  id: 'partA.transform.x',
  rnaPath: 'objects["partA"].transform.x',
  arrayIndex: 0,
  keyforms: [{
    time: 100, value: 10,
    handleLeft: { time: 100, value: 10 },
    handleRight: { time: 100, value: 10 },
    handleType: { left: 'vector', right: 'vector' },
    interpolation: 'linear',
    flag: 0,
  }],
  modifiers: [],
  extrapolation: 'constant',
});
// Resolver returns 10 (matches current eval)
const r5 = applyKeyingSet(project5, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NEEDED, {
  resolveValue: (path) => path === 'objects["partA"].transform.x' ? 10 : 20,
});
const xResult = r5.results.find((r) => r.path === 'objects["partA"].transform.x');
eq(xResult.status, 'skipped-needed', '§5 — NEEDED: skip when current value matches eval');
const yResult = r5.results.find((r) => r.path === 'objects["partA"].transform.y');
// y didn't have an fcurve → created (NEEDED has no effect on no-fcurve path; matches Blender)
eq(yResult.status, 'created-fcurve', '§5 — NEEDED on missing fcurve: create (NEEDED only applies to existing eval)');

// Differs from current → insert/replace happens.
const r5b = applyKeyingSet(project5, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NEEDED, {
  resolveValue: (path) => path === 'objects["partA"].transform.x' ? 99 : 20,
});
const xResultB = r5b.results.find((r) => r.path === 'objects["partA"].transform.x');
eq(xResultB.status, 'replaced', '§5 — NEEDED: replace when current value differs');

// ─────────────────────────────────────────────────────────────────────
// Section 6 — INSERTKEY_REPLACE overrides NEEDED + suppresses creation
// ─────────────────────────────────────────────────────────────────────

let project6 = makeProject();
project6.actions[1].fcurves.push({
  id: 'partA.transform.x',
  rnaPath: 'objects["partA"].transform.x',
  arrayIndex: 0,
  keyforms: [{
    time: 100, value: 10,
    handleLeft: { time: 100, value: 10 },
    handleRight: { time: 100, value: 10 },
    handleType: { left: 'vector', right: 'vector' },
    interpolation: 'linear',
    flag: 0,
  }],
  modifiers: [],
  extrapolation: 'constant',
});

// REPLACE at existing-key time → replaces.
const r6a = applyKeyingSet(project6, 'Location', ['partA'], 100, INSERTKEY_FLAGS.REPLACE, {
  resolveValue: (path) => path === 'objects["partA"].transform.x' ? 77 : 20,
});
const xR6a = r6a.results.find((r) => r.path === 'objects["partA"].transform.x');
eq(xR6a.status, 'replaced', '§6 — REPLACE: replaces existing key at time');
const yR6a = r6a.results.find((r) => r.path === 'objects["partA"].transform.y');
eq(yR6a.status, 'skipped-replace', '§6 — REPLACE: no fcurve for y → skipped-replace (DEV 29)');

// REPLACE + NEEDED both set + value matches → REPLACE wins (still replace).
project6.actions[1].fcurves[0].keyforms[0].value = 99; // reset
const r6b = applyKeyingSet(project6, 'Location', ['partA'], 100,
  INSERTKEY_FLAGS.REPLACE | INSERTKEY_FLAGS.NEEDED, {
    resolveValue: (path) => path === 'objects["partA"].transform.x' ? 99 : 20,
  });
const xR6b = r6b.results.find((r) => r.path === 'objects["partA"].transform.x');
eq(xR6b.status, 'replaced', '§6 — REPLACE overrides NEEDED (DNA_anim_enums.h:510 comment)');

// REPLACE at NON-existing-key time → skipped (no creation).
let project6c = makeProject();
project6c.actions[1].fcurves.push({
  id: 'partA.transform.x',
  rnaPath: 'objects["partA"].transform.x',
  arrayIndex: 0,
  keyforms: [{
    time: 100, value: 10,
    handleLeft: { time: 100, value: 10 },
    handleRight: { time: 100, value: 10 },
    handleType: { left: 'vector', right: 'vector' },
    interpolation: 'linear',
    flag: 0,
  }],
  modifiers: [],
  extrapolation: 'constant',
});
const r6c = applyKeyingSet(project6c, 'Location', ['partA'], 500, INSERTKEY_FLAGS.REPLACE, {
  resolveValue: (path) => 99,
});
const xR6c = r6c.results.find((r) => r.path === 'objects["partA"].transform.x');
eq(xR6c.status, 'skipped-replace', '§6 — REPLACE: no existing key at time 500 → skipped-replace');
// Verify fcurve was NOT mutated.
eq(project6c.actions[1].fcurves[0].keyforms.length, 1, '§6 — REPLACE skip leaves keyform count unchanged');

// ─────────────────────────────────────────────────────────────────────
// Section 7 — INSERTKEY_AVAILABLE skips when no fcurve exists
// ─────────────────────────────────────────────────────────────────────

let project7 = makeProject();
// Pre-seed fcurve for x only; y has no fcurve.
project7.actions[1].fcurves.push({
  id: 'partA.transform.x',
  rnaPath: 'objects["partA"].transform.x',
  arrayIndex: 0,
  keyforms: [{
    time: 50, value: 5,
    handleLeft: { time: 50, value: 5 },
    handleRight: { time: 50, value: 5 },
    handleType: { left: 'vector', right: 'vector' },
    interpolation: 'linear',
    flag: 0,
  }],
  modifiers: [],
  extrapolation: 'constant',
});
const r7 = applyKeyingSet(project7, 'Location', ['partA'], 200, INSERTKEY_FLAGS.AVAILABLE, {
  resolveValue: (path) => path.endsWith('.x') ? 50 : 100,
});
const xR7 = r7.results.find((r) => r.path === 'objects["partA"].transform.x');
const yR7 = r7.results.find((r) => r.path === 'objects["partA"].transform.y');
eq(xR7.status, 'inserted', '§7 — AVAILABLE: existing fcurve → insert succeeds');
eq(yR7.status, 'skipped-available', '§7 — AVAILABLE: no fcurve for y → skipped-available');
eq(project7.actions[1].fcurves.length, 1, '§7 — AVAILABLE did NOT create new fcurve');

// ─────────────────────────────────────────────────────────────────────
// Section 8 — __params__ paths route to __scene__'s action (DEV 28)
// ─────────────────────────────────────────────────────────────────────

let project8 = makeProject();
const r8 = applyKeyingSet(project8, 'AllParams', [], 1000, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: resolver,
});
eq(r8.count, 2, '§8 — AllParams: 2 param fcurves created');
const sceneAct = project8.actions.find((a) => a.id === 'sceneAct');
eq(sceneAct.fcurves.length, 2, '§8 — __params__ paths routed to __scene__\'s action');
const fcParamX = sceneAct.fcurves.find((f) => f.rnaPath === 'objects["__params__"].values["ParamAngleX"]');
ok(fcParamX !== undefined, '§8 — ParamAngleX fcurve in __scene__\'s action');
eq(fcParamX.keyforms[0].value, 0.5, '§8 — keyform value matches resolver');

// ─────────────────────────────────────────────────────────────────────
// Section 9 — Object with no animData → falls back to scene action
//
// SS's v36 migration leaves every node's `animData.actionId` null (the
// "consumers fall back to the UI store's `activeActionId`" model). When
// a `__scene__` binding exists, `applyKeyingSet` routes the object's
// channels into the scene action — without this, I-key never inserts
// anything for bones / parts.
// ─────────────────────────────────────────────────────────────────────

let project9 = makeProject();
const r9 = applyKeyingSet(project9, 'Location', ['partB'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: (path) => path === 'objects["partB"].transform.x' ? 1 : 2,
});
eq(r9.count, 2, '§9 — no animData → falls back to scene action; 2 channels written');
eq(r9.skippedNoAction, 0, '§9 — scene fallback applied; no skipped-no-action');
eq(r9.results[0].status, 'created-fcurve',
  '§9 — partB path routed into __scene__.sceneAct (created-fcurve)');
const sceneAct9 = project9.actions.find((a) => a.id === 'sceneAct');
const partBx = sceneAct9.fcurves.find((f) => f.rnaPath === 'objects["partB"].transform.x');
ok(partBx !== undefined, '§9 — partB.x fcurve materialised on __scene__.sceneAct');
eq(partBx.keyforms[0].value, 1, '§9 — keyform value matches resolver');

// §9b — when neither per-node animData NOR scene binding exists,
// AND no `fallbackActionId` is supplied, the channel returns
// skipped-no-action. Same shape as the old §9 expectation, but
// re-grounded on the new contract: the skip only fires when EVERY
// fallback exhausts.
const project9b = {
  nodes: [
    { id: 'partB', type: 'part', name: 'PartB' },  // no animData
  ],
  actions: [
    { id: 'someAct', name: 'SomeAction', fcurves: [] },
  ],
  parameters: [],
  keyingSets: [],
  activeKeyingSetId: null,
};
const r9b = applyKeyingSet(project9b, 'Location', ['partB'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: () => 1,
});
eq(r9b.count, 0, '§9b — no scene + no fallback → count = 0');
eq(r9b.skippedNoAction, 2, '§9b — 2 channels skipped-no-action');
eq(r9b.results[0].status, 'skipped-no-action', '§9b — status = skipped-no-action');

// §9c — `fallbackActionId` option (UI's `activeActionId`) routes the
// channel when neither per-node animData nor scene binding exists.
// Mirrors `insertKey.execApplyKeyingSet`'s wire-up.
const project9c = {
  nodes: [
    { id: 'partB', type: 'part', name: 'PartB' },
  ],
  actions: [
    { id: 'uiAct', name: 'UIPickedAction', fcurves: [] },
  ],
  parameters: [],
  keyingSets: [],
  activeKeyingSetId: null,
};
const r9c = applyKeyingSet(project9c, 'Location', ['partB'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: () => 7,
  fallbackActionId: 'uiAct',
});
eq(r9c.count, 2, '§9c — fallbackActionId routes the channel; 2 written');
const uiAct9c = project9c.actions.find((a) => a.id === 'uiAct');
eq(uiAct9c.fcurves.length, 2, '§9c — both fcurves landed on uiAct');

// ─────────────────────────────────────────────────────────────────────
// Section 10 — Non-finite current value → skipped-non-finite
// ─────────────────────────────────────────────────────────────────────

let project10 = makeProject();
const r10 = applyKeyingSet(project10, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: (path) => path.endsWith('.x') ? NaN : 5,
});
const xR10 = r10.results.find((r) => r.path === 'objects["partA"].transform.x');
const yR10 = r10.results.find((r) => r.path === 'objects["partA"].transform.y');
eq(xR10.status, 'skipped-non-finite', '§10 — NaN value → skipped-non-finite');
eq(yR10.status, 'created-fcurve', '§10 — finite value → created-fcurve');
eq(r10.count, 1, '§10 — only 1 successful (y)');

const project10b = makeProject();
const r10b = applyKeyingSet(project10b, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: () => Infinity,
});
ok(r10b.results.every((r) => r.status === 'skipped-non-finite'), '§10 — Infinity also non-finite');

// ─────────────────────────────────────────────────────────────────────
// Section 11 — TIME_EPSILON_MS = 0.5 (DEV 27)
// ─────────────────────────────────────────────────────────────────────

let project11 = makeProject();
project11.actions[1].fcurves.push({
  id: 'partA.transform.x',
  rnaPath: 'objects["partA"].transform.x',
  arrayIndex: 0,
  keyforms: [{
    time: 100, value: 10,
    handleLeft: { time: 100, value: 10 },
    handleRight: { time: 100, value: 10 },
    handleType: { left: 'vector', right: 'vector' },
    interpolation: 'linear',
    flag: 0,
  }],
  modifiers: [],
  extrapolation: 'constant',
});
const r11a = applyKeyingSet(project11, 'Location', ['partA'], 100.3, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: (path) => path.endsWith('.x') ? 99 : 0,
});
const xR11a = r11a.results.find((r) => r.path === 'objects["partA"].transform.x');
eq(xR11a.status, 'replaced', '§11 — time within 0.5ms epsilon counts as same key → replace');
eq(project11.actions[1].fcurves[0].keyforms.length, 1, '§11 — no new keyform inserted');
eq(project11.actions[1].fcurves[0].keyforms[0].value, 99, '§11 — value replaced');

const r11b = applyKeyingSet(project11, 'Location', ['partA'], 101, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: (path) => path.endsWith('.x') ? 55 : 0,
});
const xR11b = r11b.results.find((r) => r.path === 'objects["partA"].transform.x');
eq(xR11b.status, 'inserted', '§11 — time outside 0.5ms epsilon → insert new');
eq(project11.actions[1].fcurves[0].keyforms.length, 2, '§11 — 2 keyforms now');

// ─────────────────────────────────────────────────────────────────────
// Section 12 — wouldApplyKeyingSetChange predicate
// ─────────────────────────────────────────────────────────────────────

let project12 = makeProject();
ok(wouldApplyKeyingSetChange(project12, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: resolver,
}) === true, '§12 — fresh insert → would change');

// After insert, NEEDED with matching value → no change
applyKeyingSet(project12, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: resolver,
});
ok(wouldApplyKeyingSetChange(project12, 'Location', ['partA'], 100,
  INSERTKEY_FLAGS.NEEDED, {
    resolveValue: resolver,
  }) === false, '§12 — NEEDED with matching value → would NOT change');

// REPLACE on no-existing time → no change
ok(wouldApplyKeyingSetChange(project12, 'Location', ['partA'], 999,
  INSERTKEY_FLAGS.REPLACE, {
    resolveValue: resolver,
  }) === false, '§12 — REPLACE on non-existing time → would NOT change');

// partB has no animData — but scene binding falls through, so a fresh
// insert WOULD land on sceneAct (post-fix semantic; pre-fix this was
// false because no-animData hard-skipped).
ok(wouldApplyKeyingSetChange(project12, 'Location', ['partB'], 100,
  INSERTKEY_FLAGS.NOFLAGS, {
    resolveValue: () => 1,
  }) === true, '§12 — partB scene-fallback → would change (writes to sceneAct)');

// ─────────────────────────────────────────────────────────────────────
// Section 13 — Bone path: pose.* routing
// ─────────────────────────────────────────────────────────────────────

const projectBone = {
  nodes: [
    { id: 'boneA', type: 'group', name: 'BoneA', boneRole: 'leftArm',
      animData: { actionId: 'partAct' } },
  ],
  actions: [{ id: 'partAct', name: 'BoneAct', fcurves: [] }],
  parameters: [],
};
const rBone = applyKeyingSet(projectBone, 'Rotation', ['boneA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: () => 0.5,
});
eq(rBone.count, 1, '§13 — bone Rotation: 1 channel inserted');
eq(rBone.results[0].path, 'objects["boneA"].pose.rotation', '§13 — bone uses pose.rotation path');
const bFc = projectBone.actions[0].fcurves[0];
eq(bFc.rnaPath, 'objects["boneA"].pose.rotation', '§13 — fcurve rnaPath = pose.rotation');
eq(bFc.keyforms[0].value, 0.5, '§13 — keyform value = resolver output');

// ─────────────────────────────────────────────────────────────────────
// Section 14 — Available set integration (only existing fcurves)
// ─────────────────────────────────────────────────────────────────────

let project14 = makeProject();
project14.actions[1].fcurves.push({
  id: 'partA.transform.x',
  rnaPath: 'objects["partA"].transform.x',
  arrayIndex: 0,
  keyforms: [{
    time: 50, value: 5,
    handleLeft: { time: 50, value: 5 },
    handleRight: { time: 50, value: 5 },
    handleType: { left: 'vector', right: 'vector' },
    interpolation: 'linear',
    flag: 0,
  }],
  modifiers: [],
  extrapolation: 'constant',
});
// Available set collects ONLY existing fcurves → only x is emitted, y is not.
const r14 = applyKeyingSet(project14, 'Available', ['partA'], 200, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: () => 77,
});
eq(r14.count, 1, '§14 — Available set: 1 insertion (only existing fcurve)');
eq(r14.results.length, 1, '§14 — Available collected only 1 channel');
eq(r14.results[0].status, 'inserted', '§14 — inserted into existing fcurve');

// ─────────────────────────────────────────────────────────────────────
// Section 15 — Input validation throws (Rule №1)
// ─────────────────────────────────────────────────────────────────────

let threw = false;
try { applyKeyingSet(null, 'Location', [], 100); } catch { threw = true; }
ok(threw, '§15 — null project throws');

threw = false;
try { applyKeyingSet({}, 'NoSuchSet', [], 100); } catch { threw = true; }
ok(threw, '§15 — unknown setId throws');

threw = false;
try { applyKeyingSet({ nodes: [], actions: [] }, 'Location', [], 'not-a-number'); } catch { threw = true; }
ok(threw, '§15 — non-number time throws');

threw = false;
try { applyKeyingSet({ nodes: [], actions: [] }, 'Location', [], NaN); } catch { threw = true; }
ok(threw, '§15 — NaN time throws');

// ─────────────────────────────────────────────────────────────────────
// Section 16 — User-defined set integration
// ─────────────────────────────────────────────────────────────────────

let project16 = makeProject();
addKeyingSet(project16, {
  id: 'MyCustom',
  label: 'My',
  paths: [
    { path: 'objects["partA"].transform.x', group: 'PartA' },
    { path: 'objects["__params__"].values["ParamAngleX"]', group: 'Params' },
  ],
});
const r16 = applyKeyingSet(project16, 'MyCustom', [], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: resolver,
});
eq(r16.count, 2, '§16 — user-defined set: 2 channels');
// partA path → partAct; __params__ path → sceneAct
const partActPost = project16.actions.find((a) => a.id === 'partAct');
const sceneActPost = project16.actions.find((a) => a.id === 'sceneAct');
eq(partActPost.fcurves.length, 1, '§16 — partAct got the partA path');
eq(sceneActPost.fcurves.length, 1, '§16 — sceneAct got the __params__ path');

// ─────────────────────────────────────────────────────────────────────
// Section 17 — applyKeyingSet leaves project untouched on early-return
// ─────────────────────────────────────────────────────────────────────

let project17 = makeProject();
const snapshot = JSON.stringify(project17);
applyKeyingSet(project17, 'Available', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: () => 99,
});
eq(JSON.stringify(project17), snapshot, '§17 — Available with no existing fcurves → no mutation');

// ─────────────────────────────────────────────────────────────────────
// Section 18 — Audit-fix HIGH-1 + MED-4: invalid-path status surfaces
// ─────────────────────────────────────────────────────────────────────

let project18 = makeProject();
addKeyingSet(project18, {
  id: 'BadPathSet',
  paths: [
    { path: 'badpath', group: 'X' }, // doesn't match either decode regex
    { path: 'objects["partA"].transform.x', group: 'partA' }, // valid for contrast
  ],
});
const r18 = applyKeyingSet(project18, 'BadPathSet', [], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: () => 5,
});
const badResult = r18.results.find((r) => r.path === 'badpath');
eq(badResult.status, 'skipped-invalid-path', '§18 — HIGH-1: bad rnaPath emits skipped-invalid-path');
eq(r18.skippedInvalidPath, 1, '§18 — HIGH-1: skippedInvalidPath counter increments');
const goodResult = r18.results.find((r) => r.path === 'objects["partA"].transform.x');
eq(goodResult.status, 'created-fcurve', '§18 — HIGH-1: valid path in same set still inserts');
eq(r18.count, 1, '§18 — HIGH-1: count = 1 (bad path skipped, good path succeeded)');

// ─────────────────────────────────────────────────────────────────────
// Section 19 — Audit-fix MED-1: 'free' handles preserved on replace
// ─────────────────────────────────────────────────────────────────────

let project19 = makeProject();
project19.actions[1].fcurves.push({
  id: 'partA.transform.x',
  rnaPath: 'objects["partA"].transform.x',
  arrayIndex: 0,
  keyforms: [
    {
      time: 100, value: 10,
      handleLeft: { time: 80, value: 5 },    // user-authored 'free' offset
      handleRight: { time: 120, value: 15 }, // user-authored 'free' offset
      handleType: { left: 'free', right: 'free' },
      interpolation: 'bezier',
      flag: 0,
    },
  ],
  modifiers: [],
  extrapolation: 'constant',
});
applyKeyingSet(project19, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: (path) => path.endsWith('.x') ? 99 : 0,
});
const kf19 = project19.actions[1].fcurves[0].keyforms[0];
eq(kf19.value, 99, '§19 — MED-1: value REPLACED');
eq(kf19.handleLeft.time, 80, '§19 — MED-1: free handleLeft.time PRESERVED');
eq(kf19.handleLeft.value, 5, '§19 — MED-1: free handleLeft.value PRESERVED');
eq(kf19.handleRight.time, 120, '§19 — MED-1: free handleRight.time PRESERVED');
eq(kf19.handleRight.value, 15, '§19 — MED-1: free handleRight.value PRESERVED');

// Mixed handle type: left=free, right=auto. Replace should preserve left, reset+recalc right.
let project19b = makeProject();
project19b.actions[1].fcurves.push({
  id: 'partA.transform.x',
  rnaPath: 'objects["partA"].transform.x',
  arrayIndex: 0,
  keyforms: [
    {
      time: 100, value: 10,
      handleLeft: { time: 80, value: 5 },     // free, must preserve
      handleRight: { time: 120, value: 15 },  // auto, will be re-derived
      handleType: { left: 'free', right: 'auto' },
      interpolation: 'bezier',
      flag: 0,
    },
    {
      time: 200, value: 30,
      handleLeft: { time: 180, value: 25 },
      handleRight: { time: 220, value: 35 },
      handleType: { left: 'auto', right: 'auto' },
      interpolation: 'bezier',
      flag: 0,
    },
  ],
  modifiers: [],
  extrapolation: 'constant',
});
applyKeyingSet(project19b, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: (path) => path.endsWith('.x') ? 99 : 0,
});
const kf19b = project19b.actions[1].fcurves[0].keyforms[0];
eq(kf19b.handleLeft.time, 80, '§19 — MED-1 mixed: free handleLeft preserved');
eq(kf19b.handleLeft.value, 5, '§19 — MED-1 mixed: free handleLeft value preserved');
// handleRight was 'auto' → recalculated. We don't assert specific values
// (depends on recalc algo) but it should differ from 15 (the old anchor).
ok(kf19b.handleRight !== undefined, '§19 — MED-1 mixed: auto handleRight still present after recalc');

// ─────────────────────────────────────────────────────────────────────
// Section 20 — Audit-fix LOW-1: malformed-action default status
// ─────────────────────────────────────────────────────────────────────

let project20 = makeProject();
// Malform partAct so it has no fcurves array.
project20.actions[1].fcurves = null;
const r20 = applyKeyingSet(project20, 'Location', ['partA'], 100, INSERTKEY_FLAGS.NOFLAGS, {
  resolveValue: () => 5,
});
eq(r20.results[0].status, 'skipped-no-action', '§20 — LOW-1: malformed action default → skipped-no-action');

const r20b = applyKeyingSet(project20, 'Location', ['partA'], 100, INSERTKEY_FLAGS.AVAILABLE, {
  resolveValue: () => 5,
});
eq(r20b.results[0].status, 'skipped-available', '§20 — LOW-1: malformed action + AVAILABLE → skipped-available');

const r20c = applyKeyingSet(project20, 'Location', ['partA'], 100, INSERTKEY_FLAGS.REPLACE, {
  resolveValue: () => 5,
});
eq(r20c.results[0].status, 'skipped-replace', '§20 — LOW-1: malformed action + REPLACE → skipped-replace');

// ── §21 record-mode bulk param capture path ──────────────────────────
//
// CanvasViewport's livePreview block calls `insertKeyformAtInAction`
// once per changed param per frame transition. Verify the helper:
//   - is exported (regression pin — pre-fix it was file-local)
//   - creates fresh fcurve on first call (status=created-fcurve)
//   - replaces value on second call at same time (status=replaced)
//   - inserts new keyform at distinct time (status=inserted)
//   - preserves earlier keys (we get a multi-key fcurve over a session)

{
  const project21 = makeProject();
  const action = project21.actions.find((a) => a.id === 'sceneAct');
  const path = 'objects["__params__"].values["ParamBreath"]';

  // Tick 1: frame 0, value 0.0 → fresh fcurve
  const r1 = insertKeyformAtInAction(action, path, 0, 0.0, INSERTKEY_FLAGS.NOFLAGS);
  eq(r1.status, 'created-fcurve', '§21.1 first call creates the fcurve');
  const fc = action.fcurves.find((f) => f.rnaPath === path);
  ok(fc, '§21.1 fcurve persisted on action');
  eq(fc.keyforms.length, 1, '§21.1 single keyform after first call');
  eq(fc.keyforms[0].value, 0.0, '§21.1 keyform value=0.0');

  // Tick 2: same time, new value → replace
  const r2 = insertKeyformAtInAction(action, path, 0, 0.05, INSERTKEY_FLAGS.NOFLAGS);
  eq(r2.status, 'replaced', '§21.2 same-time second call replaces');
  eq(fc.keyforms.length, 1, '§21.2 still one keyform');
  eq(fc.keyforms[0].value, 0.05, '§21.2 value updated to 0.05');

  // Tick 3: new time → insert
  const r3 = insertKeyformAtInAction(action, path, 41.6667, 0.15, INSERTKEY_FLAGS.NOFLAGS);
  eq(r3.status, 'inserted', '§21.3 new-time call inserts');
  eq(fc.keyforms.length, 2, '§21.3 two keyforms after insert');

  // Tick 4: yet another time → still inserts (recording 3 frames)
  const r4 = insertKeyformAtInAction(action, path, 83.3333, 0.30, INSERTKEY_FLAGS.NOFLAGS);
  eq(r4.status, 'inserted', '§21.4 third-time call inserts');
  eq(fc.keyforms.length, 3, '§21.4 three keyforms after recording 3 frames');

  // Sorted by time (insertion sort in the kernel)
  ok(fc.keyforms[0].time < fc.keyforms[1].time && fc.keyforms[1].time < fc.keyforms[2].time,
    '§21.5 keyforms kept sorted by time');
}

// ─────────────────────────────────────────────────────────────────────

console.log(`insertKeyframe: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
