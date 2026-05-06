// V4 Phase 2 — tests for the parameter CRUD pipeline.
//
// Covers:
//   - addParameter (id collision, fresh add, defaults, _userAuthored stamp)
//   - removeParameter (cascade through deformer bindings, animation tracks,
//     physics rule inputs)
//   - renameParameter (cascade rename, id collision rejection)
//   - patchParameter (whitelist enforcement, _userAuthored stamp)
//   - addParamKey / removeParamKey (epsilon dedup, sort, _userAuthoredKeys)
//   - setParameterUserAuthored (lock toggle)
//   - seedParameters('merge') preserves _userAuthored params + user-added keys
//
// Run: node scripts/test/test_paramCrud.mjs

import { seedParameters } from '../../src/io/live2d/rig/paramSpec.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// We don't pull in the full zustand projectStore (loads React + immer
// + many transitive UI deps). Instead, replicate the relevant pure
// transformations from projectStore param CRUD and test them here.
// Drift-detection: production actions live in src/store/projectStore.js.

function emptyProject() {
  return {
    parameters: [],
    nodes: [],
    animations: [],
    physicsRules: [],
    autoRigConfig: null,
  };
}

// Replicate addParameter as a pure function.
function addParameter(proj, spec) {
  if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
  const params = proj.parameters ?? [];
  if (params.some((p) => p?.id === spec.id)) return false;
  const min = typeof spec.min === 'number' ? spec.min : 0;
  const max = typeof spec.max === 'number' ? spec.max : 1;
  const def = typeof spec.default === 'number' ? spec.default : Math.min(Math.max(0, min), max);
  const keys = Array.isArray(spec.keys) ? spec.keys.slice() : [];
  proj.parameters = proj.parameters ?? [];
  proj.parameters.push({
    id:   spec.id,
    name: spec.name ?? spec.id,
    role: spec.role ?? 'custom',
    min,
    max,
    default: def,
    decimalPlaces: typeof spec.decimalPlaces === 'number' ? spec.decimalPlaces : 2,
    keys,
    _userAuthored: true,
    _userAuthoredKeys: keys.slice(),
  });
  return true;
}

function removeParameter(proj, paramId) {
  proj.parameters = (proj.parameters ?? []).filter((p) => p?.id !== paramId);
  for (const n of proj.nodes ?? []) {
    if (n?.type !== 'deformer' || !Array.isArray(n.bindings)) continue;
    n.bindings = n.bindings.filter((b) => b?.parameterId !== paramId);
  }
  for (const anim of proj.animations ?? []) {
    if (!Array.isArray(anim?.tracks)) continue;
    anim.tracks = anim.tracks.filter((t) => t?.paramId !== paramId);
  }
  for (const rule of proj.physicsRules ?? []) {
    if (!Array.isArray(rule?.inputs)) continue;
    rule.inputs = rule.inputs.filter((inp) => inp?.paramId !== paramId);
  }
}

function renameParameter(proj, oldId, newId) {
  if (typeof oldId !== 'string' || typeof newId !== 'string') return false;
  if (newId.length === 0) return false;
  if (oldId === newId) return true;
  const params = proj.parameters ?? [];
  if (params.some((p) => p?.id === newId)) return false;
  const param = params.find((p) => p?.id === oldId);
  if (!param) return false;
  param.id = newId;
  param._userAuthored = true;
  for (const n of proj.nodes ?? []) {
    if (n?.type !== 'deformer' || !Array.isArray(n.bindings)) continue;
    for (const b of n.bindings) {
      if (b?.parameterId === oldId) b.parameterId = newId;
    }
  }
  for (const anim of proj.animations ?? []) {
    for (const t of anim?.tracks ?? []) {
      if (t?.paramId === oldId) t.paramId = newId;
    }
  }
  for (const rule of proj.physicsRules ?? []) {
    for (const inp of rule?.inputs ?? []) {
      if (inp?.paramId === oldId) inp.paramId = newId;
    }
  }
  return true;
}

function patchParameter(proj, paramId, partial) {
  if (!partial || typeof partial !== 'object') return;
  const param = (proj.parameters ?? []).find((p) => p?.id === paramId);
  if (!param) return;
  if (typeof partial.name === 'string')          param.name = partial.name;
  if (typeof partial.role === 'string')          param.role = partial.role;
  if (typeof partial.min === 'number')           param.min = partial.min;
  if (typeof partial.max === 'number')           param.max = partial.max;
  if (typeof partial.default === 'number')       param.default = partial.default;
  if (typeof partial.decimalPlaces === 'number') param.decimalPlaces = partial.decimalPlaces;
  param._userAuthored = true;
}

function addParamKey(proj, paramId, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  const param = (proj.parameters ?? []).find((p) => p?.id === paramId);
  if (!param) return;
  const EPS = 1e-6;
  const keys = Array.isArray(param.keys) ? param.keys.slice() : [];
  if (!keys.some((k) => Math.abs(k - value) < EPS)) {
    keys.push(value);
    keys.sort((a, b) => a - b);
    param.keys = keys;
  }
  const userKeys = Array.isArray(param._userAuthoredKeys) ? param._userAuthoredKeys.slice() : [];
  if (!userKeys.some((k) => Math.abs(k - value) < EPS)) {
    userKeys.push(value);
    userKeys.sort((a, b) => a - b);
    param._userAuthoredKeys = userKeys;
  }
  param._userAuthored = true;
}

function removeParamKey(proj, paramId, value) {
  const param = (proj.parameters ?? []).find((p) => p?.id === paramId);
  if (!param) return;
  const EPS = 1e-6;
  if (Array.isArray(param.keys)) {
    param.keys = param.keys.filter((k) => Math.abs(k - value) >= EPS);
  }
  if (Array.isArray(param._userAuthoredKeys)) {
    param._userAuthoredKeys = param._userAuthoredKeys.filter((k) => Math.abs(k - value) >= EPS);
  }
  param._userAuthored = true;
}

// ── addParameter ─────────────────────────────────────────────────────

{
  const p = emptyProject();
  const ok = addParameter(p, { id: 'ParamCustom' });
  assert(ok === true, 'addParameter: returns true on success');
  assert(p.parameters.length === 1, 'addParameter: appended to list');
  assert(p.parameters[0].id === 'ParamCustom', 'addParameter: id stored');
  assert(p.parameters[0].name === 'ParamCustom', 'addParameter: name defaults to id');
  assert(p.parameters[0].role === 'custom', 'addParameter: role defaults to "custom"');
  assert(p.parameters[0].min === 0, 'addParameter: min defaults to 0');
  assert(p.parameters[0].max === 1, 'addParameter: max defaults to 1');
  assert(p.parameters[0].default === 0, 'addParameter: default defaults to 0');
  assert(p.parameters[0]._userAuthored === true, 'addParameter: stamps _userAuthored');
  assert(Array.isArray(p.parameters[0]._userAuthoredKeys),
    'addParameter: stamps _userAuthoredKeys');
}

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamSmile' });
  const ok = addParameter(p, { id: 'ParamSmile' });
  assert(ok === false, 'addParameter: returns false on id collision');
  assert(p.parameters.length === 1, 'addParameter: did not double-insert');
}

{
  const p = emptyProject();
  addParameter(p, {
    id: 'ParamWide',
    name: 'My Slider',
    min: -30, max: 30, default: 0,
    decimalPlaces: 1,
    keys: [-30, 0, 30],
  });
  const param = p.parameters[0];
  assert(param.min === -30 && param.max === 30, 'addParameter: respects range');
  assert(param.decimalPlaces === 1, 'addParameter: respects decimalPlaces');
  assert(JSON.stringify(param.keys) === '[-30,0,30]', 'addParameter: stores keys');
  assert(JSON.stringify(param._userAuthoredKeys) === '[-30,0,30]',
    'addParameter: mirrors keys to _userAuthoredKeys');
}

// ── removeParameter cascade ─────────────────────────────────────────

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamCustom' });
  p.nodes.push({
    id: 'Warp1', type: 'deformer', deformerKind: 'warp',
    bindings: [
      { parameterId: 'ParamCustom', keys: [0, 1] },
      { parameterId: 'ParamOther',  keys: [-1, 0, 1] },
    ],
    keyforms: [],
  });
  p.animations.push({
    id: 'A1',
    tracks: [
      { paramId: 'ParamCustom', keyframes: [] },
      { paramId: 'ParamOther',  keyframes: [] },
    ],
  });
  p.physicsRules.push({
    id: 'R1',
    inputs: [
      { paramId: 'ParamCustom', source: 'sway' },
      { paramId: 'ParamOther',  source: 'idle' },
    ],
    outputs: ['hairBone'],
  });

  removeParameter(p, 'ParamCustom');

  assert(p.parameters.length === 0, 'removeParameter: dropped from parameters');
  assert(p.nodes[0].bindings.length === 1, 'removeParameter: dropped binding');
  assert(p.nodes[0].bindings[0].parameterId === 'ParamOther',
    'removeParameter: kept other bindings');
  assert(p.animations[0].tracks.length === 1, 'removeParameter: dropped animation track');
  assert(p.animations[0].tracks[0].paramId === 'ParamOther',
    'removeParameter: kept other tracks');
  assert(p.physicsRules[0].inputs.length === 1, 'removeParameter: dropped physics input');
  assert(p.physicsRules[0].inputs[0].paramId === 'ParamOther',
    'removeParameter: kept other physics inputs');
}

// ── renameParameter cascade ─────────────────────────────────────────

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamFoo' });
  p.nodes.push({
    id: 'Warp1', type: 'deformer', deformerKind: 'warp',
    bindings: [{ parameterId: 'ParamFoo', keys: [0, 1] }],
  });
  p.animations.push({
    id: 'A1',
    tracks: [{ paramId: 'ParamFoo', keyframes: [] }],
  });
  p.physicsRules.push({
    id: 'R1',
    inputs: [{ paramId: 'ParamFoo' }],
  });

  const ok = renameParameter(p, 'ParamFoo', 'ParamBar');
  assert(ok === true, 'renameParameter: returns true on success');
  assert(p.parameters[0].id === 'ParamBar', 'renameParameter: id changed');
  assert(p.parameters[0]._userAuthored === true,
    'renameParameter: stamps _userAuthored');
  assert(p.nodes[0].bindings[0].parameterId === 'ParamBar',
    'renameParameter: cascade through deformer bindings');
  assert(p.animations[0].tracks[0].paramId === 'ParamBar',
    'renameParameter: cascade through animation tracks');
  assert(p.physicsRules[0].inputs[0].paramId === 'ParamBar',
    'renameParameter: cascade through physics inputs');
}

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamA' });
  addParameter(p, { id: 'ParamB' });
  const ok = renameParameter(p, 'ParamA', 'ParamB');
  assert(ok === false, 'renameParameter: rejects id collision');
  assert(p.parameters[0].id === 'ParamA',
    'renameParameter: keeps original id on collision rejection');
}

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamA' });
  const ok = renameParameter(p, 'ParamA', 'ParamA');
  assert(ok === true, 'renameParameter: same-id rename is no-op success');
}

// ── patchParameter ──────────────────────────────────────────────────

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamX' });
  patchParameter(p, 'ParamX', { name: 'Pretty Name', min: -10, max: 10, default: 0, decimalPlaces: 3 });
  const param = p.parameters[0];
  assert(param.name === 'Pretty Name', 'patchParameter: name updated');
  assert(param.min === -10 && param.max === 10, 'patchParameter: range updated');
  assert(param.decimalPlaces === 3, 'patchParameter: decimalPlaces updated');
  assert(param._userAuthored === true, 'patchParameter: stamps _userAuthored');
  assert(param.id === 'ParamX', 'patchParameter: id NOT in whitelist (unchanged)');
}

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamX' });
  // @ts-expect-error testing junk input
  patchParameter(p, 'ParamX', { id: 'EvilRename', randomField: 42 });
  assert(p.parameters[0].id === 'ParamX',
    'patchParameter: ignores out-of-whitelist fields');
}

// ── addParamKey / removeParamKey ───────────────────────────────────

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamWide', min: -30, max: 30, keys: [-30, 30] });
  addParamKey(p, 'ParamWide', 0);
  const param = p.parameters[0];
  assert(JSON.stringify(param.keys) === '[-30,0,30]',
    'addParamKey: inserts and sorts ascending');
  assert(param._userAuthoredKeys.includes(0),
    'addParamKey: tracks in _userAuthoredKeys');
}

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamWide', keys: [0] });
  addParamKey(p, 'ParamWide', 0);
  addParamKey(p, 'ParamWide', 1e-9);  // epsilon-equal to 0
  const param = p.parameters[0];
  assert(param.keys.length === 1, 'addParamKey: epsilon-dedup against existing keys');
}

{
  const p = emptyProject();
  addParameter(p, { id: 'ParamWide', keys: [-30, 0, 30] });
  removeParamKey(p, 'ParamWide', 0);
  const param = p.parameters[0];
  assert(JSON.stringify(param.keys) === '[-30,30]',
    'removeParamKey: drops the matching value');
}

// ── seedParameters('merge') preserves user-authored entries ────────

{
  const proj = {
    parameters: [
      { id: 'ParamCustom', name: 'My Custom', role: 'custom',
        min: 0, max: 1, default: 0.5, keys: [0, 0.5, 1],
        _userAuthored: true, _userAuthoredKeys: [0, 0.5, 1] },
    ],
    nodes: [],
    autoRigConfig: null,
  };
  seedParameters(proj, 'merge');
  const survived = proj.parameters.find((p) => p.id === 'ParamCustom');
  assert(!!survived, 'seedParameters merge: user-authored param survives');
  assert(survived.name === 'My Custom', 'seedParameters merge: name preserved');
  assert(survived.default === 0.5, 'seedParameters merge: default preserved');
  assert(JSON.stringify(survived.keys) === '[0,0.5,1]',
    'seedParameters merge: user keys preserved');
}

{
  // Replace mode with the same project — user-authored param should be dropped
  // (the generator doesn't produce ParamCustom, so it's gone after replace).
  const proj = {
    parameters: [
      { id: 'ParamCustom', name: 'My Custom', role: 'custom',
        min: 0, max: 1, default: 0.5, keys: [0, 0.5, 1],
        _userAuthored: true, _userAuthoredKeys: [0, 0.5, 1] },
    ],
    nodes: [],
    autoRigConfig: null,
  };
  seedParameters(proj, 'replace');
  const survived = proj.parameters.find((p) => p.id === 'ParamCustom');
  assert(!survived, 'seedParameters replace: user-authored param is wiped');
}

{
  // _userAuthoredKeys merges into a generator-produced param's keys.
  const proj = {
    parameters: [
      // ParamAngleX is auto-generated; pretend the user added a +15 breakpoint.
      { id: 'ParamAngleX', name: 'AngleX', role: 'standard',
        min: -30, max: 30, default: 0, keys: [-30, 0, 15, 30],
        _userAuthoredKeys: [15] },
    ],
    nodes: [],
    autoRigConfig: null,
  };
  seedParameters(proj, 'merge');
  const angleX = proj.parameters.find((p) => p.id === 'ParamAngleX');
  assert(!!angleX, 'seedParameters merge: AngleX still present after regen');
  assert(angleX.keys.includes(15),
    'seedParameters merge: user-added breakpoint preserved');
  // The generator's default key list for AngleX depends on tag-coverage
  // (no meshes here → minimal). The merge invariant is: anything in
  // _userAuthoredKeys is in keys; the other side has whatever the
  // generator produced this run. Just check the user side carried.
  assert(JSON.stringify(angleX._userAuthoredKeys) === '[15]',
    'seedParameters merge: _userAuthoredKeys carries through');
}

// ── seedParameters('merge') with overlapping user-key + generator key ─

{
  // Synthetic test: the priorParam includes a key that the generator
  // may also produce (0, default in ranges) — merge dedups and the
  // result includes it once.
  const proj = {
    parameters: [
      { id: 'ParamAngleX', name: 'AngleX', role: 'standard',
        min: -30, max: 30, default: 0, keys: [0],
        _userAuthoredKeys: [0] },
    ],
    nodes: [],
    autoRigConfig: null,
  };
  seedParameters(proj, 'merge');
  const angleX = proj.parameters.find((p) => p.id === 'ParamAngleX');
  // 0 must appear exactly once even if generator also emits it.
  const zeros = (angleX?.keys ?? []).filter((k) => Math.abs(k) < 1e-6);
  assert(zeros.length === 1,
    'seedParameters merge: epsilon-dedups overlapping user-key + generator-key');
}

console.log(`paramCrud: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
