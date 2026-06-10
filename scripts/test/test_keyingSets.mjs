// scripts/test/test_keyingSets.mjs — Phase 7.A substrate.
//
// Verifies built-in keying-set registry + per-object channel collection
// + user-defined set CRUD + active-set pointer.

import {
  BUILTIN_KEYING_SET_IDS,
  getKeyingSet,
  listKeyingSets,
  getActiveKeyingSet,
  setActiveKeyingSet,
  collectChannels,
  addKeyingSet,
  removeKeyingSet,
  cloneKeyingSet,
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

// ─────────────────────────────────────────────────────────────────────
// Section 1 — built-in registry shape
// ─────────────────────────────────────────────────────────────────────

eq(BUILTIN_KEYING_SET_IDS.length, 7, '§1 — 7 built-in ids');
eq([...BUILTIN_KEYING_SET_IDS], [
  'Available', 'Location', 'Rotation', 'Scaling', 'LocRotScale', 'BlendShape', 'AllParams',
], '§1 — canonical menu order matches Blender keyingsets_builtins.py:647-670 (5) + SS-original (2)');

ok(Object.isFrozen(BUILTIN_KEYING_SET_IDS), '§1 — BUILTIN_KEYING_SET_IDS is frozen');

for (const id of BUILTIN_KEYING_SET_IDS) {
  const set = getKeyingSet({}, id);
  ok(set !== null, `§1 — built-in '${id}' resolves`);
  ok(set.isBuiltin === true, `§1 — '${id}' isBuiltin=true`);
  ok(typeof set.label === 'string' && set.label.length > 0, `§1 — '${id}' has label`);
  ok(typeof set.description === 'string', `§1 — '${id}' has description`);
}

// DEV 20: Scaling id vs Scale label
// Blender keyingsets_builtins.py:72 holds `bl_idname = ANIM_KS_SCALING_ID`,
// the constant defined at :29 as the literal "Scaling". Line 73 holds the
// literal `bl_label = "Scale"`. Audit-fix MED-F clarification.
const scaling = getKeyingSet({}, 'Scaling');
eq(scaling.id, 'Scaling', '§1 — DEV 20: id resolves to "Scaling" (constant at keyingsets_builtins.py:29, referenced at :72)');
eq(scaling.label, 'Scale', '§1 — DEV 20: label is literal "Scale" at keyingsets_builtins.py:73');

// Available has insertNew=false (does NOT create new fcurves)
const available = getKeyingSet({}, 'Available');
eq(available.insertNew, false, '§1 — Available.insertNew=false (existing fcurves only)');

// Other built-ins insertNew=true
eq(getKeyingSet({}, 'Location').insertNew, true, '§1 — Location.insertNew=true');
eq(getKeyingSet({}, 'Rotation').insertNew, true, '§1 — Rotation.insertNew=true');
eq(getKeyingSet({}, 'Scaling').insertNew, true, '§1 — Scaling.insertNew=true');
eq(getKeyingSet({}, 'LocRotScale').insertNew, true, '§1 — LocRotScale.insertNew=true');
eq(getKeyingSet({}, 'BlendShape').insertNew, true, '§1 — BlendShape.insertNew=true');
eq(getKeyingSet({}, 'AllParams').insertNew, true, '§1 — AllParams.insertNew=true');

ok(getKeyingSet({}, 'NoSuchSet') === null, '§1 — unknown id returns null');
ok(getKeyingSet({}, '') === null, '§1 — empty string returns null');
ok(getKeyingSet({}, null) === null, '§1 — null id returns null');

// ─────────────────────────────────────────────────────────────────────
// Section 2 — Location on a non-bone object
// ─────────────────────────────────────────────────────────────────────

const project1 = {
  nodes: [
    { id: 'partA', type: 'part', name: 'PartA' },
    { id: 'partB', type: 'part', name: 'PartB' },
  ],
  parameters: [{ id: 'ParamAngleZ', default: 0 }],
};

const locResult1 = collectChannels(project1, getKeyingSet({}, 'Location'), ['partA']);
eq(locResult1.length, 2, '§2 — Location on object: 2 paths (x + y)');
eq(locResult1[0].path, 'objects["partA"].transform.x', '§2 — Location[0] is transform.x');
eq(locResult1[1].path, 'objects["partA"].transform.y', '§2 — Location[1] is transform.y');
eq(locResult1[0].group, 'PartA', '§2 — Location group = node.name');

// Multi-object selection
const locResult2 = collectChannels(project1, getKeyingSet({}, 'Location'), ['partA', 'partB']);
eq(locResult2.length, 4, '§2 — Location on 2 objects: 4 paths total');
eq(locResult2[2].path, 'objects["partB"].transform.x', '§2 — Location[2] is partB.transform.x');
eq(locResult2[3].group, 'PartB', '§2 — Location[3] group = PartB');

// Unknown object id silently filtered (matches Blender RKS_ITER_selected_item — no-op)
const locResult3 = collectChannels(project1, getKeyingSet({}, 'Location'), ['nonexistent']);
eq(locResult3.length, 0, '§2 — unknown object id → empty result');

// ─────────────────────────────────────────────────────────────────────
// Section 3 — Pose paths on a bone group (DEV 22 — Euler-only)
// ─────────────────────────────────────────────────────────────────────

const projectBone = {
  nodes: [
    { id: 'boneA', type: 'group', name: 'BoneA', boneRole: 'leftArm' },
  ],
};

const boneLoc = collectChannels(projectBone, getKeyingSet({}, 'Location'), ['boneA']);
eq(boneLoc.length, 2, '§3 — bone Location: 2 paths');
eq(boneLoc[0].path, 'objects["boneA"].pose.x', '§3 — bone Location uses pose.x not transform.x');
eq(boneLoc[1].path, 'objects["boneA"].pose.y', '§3 — bone Location uses pose.y not transform.y');

const boneRot = collectChannels(projectBone, getKeyingSet({}, 'Rotation'), ['boneA']);
eq(boneRot.length, 1, '§3 — bone Rotation: 1 path (DEV 22 Euler-only)');
eq(boneRot[0].path, 'objects["boneA"].pose.rotation', '§3 — bone Rotation = pose.rotation');

const boneScale = collectChannels(projectBone, getKeyingSet({}, 'Scaling'), ['boneA']);
eq(boneScale.length, 2, '§3 — bone Scaling: 2 paths (DEV 21 per-component)');
eq(boneScale[0].path, 'objects["boneA"].pose.scaleX', '§3 — bone Scaling[0] = pose.scaleX');
eq(boneScale[1].path, 'objects["boneA"].pose.scaleY', '§3 — bone Scaling[1] = pose.scaleY');

// Object Rotation (DEV 22)
const objRot = collectChannels(project1, getKeyingSet({}, 'Rotation'), ['partA']);
eq(objRot.length, 1, '§3 — object Rotation: 1 path (DEV 22)');
eq(objRot[0].path, 'objects["partA"].transform.rotation', '§3 — object Rotation = transform.rotation');

// ─────────────────────────────────────────────────────────────────────
// Section 4 — LocRotScale composite (Blender :126-144 order)
// ─────────────────────────────────────────────────────────────────────

const lrs = collectChannels(project1, getKeyingSet({}, 'LocRotScale'), ['partA']);
eq(lrs.length, 5, '§4 — LocRotScale: 2 loc + 1 rot + 2 scale = 5');
eq(lrs[0].path, 'objects["partA"].transform.x', '§4 — LocRotScale order: loc.x first');
eq(lrs[1].path, 'objects["partA"].transform.y', '§4 — LocRotScale order: loc.y second');
eq(lrs[2].path, 'objects["partA"].transform.rotation', '§4 — LocRotScale order: rotation third');
eq(lrs[3].path, 'objects["partA"].transform.scaleX', '§4 — LocRotScale order: scaleX fourth');
eq(lrs[4].path, 'objects["partA"].transform.scaleY', '§4 — LocRotScale order: scaleY fifth');

// ─────────────────────────────────────────────────────────────────────
// Section 5 — BlendShape (SS-original, DEV 24)
// ─────────────────────────────────────────────────────────────────────

const projectBS = {
  nodes: [
    {
      id: 'meshA',
      type: 'part',
      name: 'MeshA',
      blendShapeValues: { smile: 0.0, frown: 0.5 },
    },
    { id: 'meshNoShapes', type: 'part', name: 'MeshNoShapes' },
    { id: 'group1', type: 'group', name: 'Group1' }, // not a part
  ],
};

const bs1 = collectChannels(projectBS, getKeyingSet({}, 'BlendShape'), ['meshA']);
eq(bs1.length, 2, '§5 — BlendShape: 2 shape paths');
ok(bs1.some((p) => p.path === 'objects["meshA"].blendShapeValues["smile"]'), '§5 — smile path emitted');
ok(bs1.some((p) => p.path === 'objects["meshA"].blendShapeValues["frown"]'), '§5 — frown path emitted');

// Mesh with no blendShapeValues → empty
const bs2 = collectChannels(projectBS, getKeyingSet({}, 'BlendShape'), ['meshNoShapes']);
eq(bs2.length, 0, '§5 — BlendShape on mesh with no shapes → empty');

// Group (non-part) → empty
const bs3 = collectChannels(projectBS, getKeyingSet({}, 'BlendShape'), ['group1']);
eq(bs3.length, 0, '§5 — BlendShape on non-part → empty');

// ─────────────────────────────────────────────────────────────────────
// Section 6 — AllParams (SS-original, DEV 25)
// ─────────────────────────────────────────────────────────────────────

const projectParams = {
  parameters: [
    { id: 'ParamAngleX', default: 0 },
    { id: 'ParamAngleY', default: 0 },
    { id: 'ParamAngleZ', default: 0 },
  ],
};

const ap = collectChannels(projectParams, getKeyingSet({}, 'AllParams'), []);
eq(ap.length, 3, '§6 — AllParams: 3 param paths');
eq(ap[0].path, 'objects["__params__"].values["ParamAngleX"]', '§6 — AllParams[0]');
eq(ap[1].path, 'objects["__params__"].values["ParamAngleY"]', '§6 — AllParams[1]');
eq(ap[2].path, 'objects["__params__"].values["ParamAngleZ"]', '§6 — AllParams[2]');
eq(ap[0].group, 'Parameters', '§6 — AllParams group = "Parameters"');

// objectIds ignored for AllParams (project-wide; matches Blender's `__scene__`-style)
const ap2 = collectChannels(projectParams, getKeyingSet({}, 'AllParams'), ['ignored']);
eq(ap2.length, 3, '§6 — AllParams ignores objectIds');

// Empty parameters
eq(collectChannels({ parameters: [] }, getKeyingSet({}, 'AllParams'), []), [], '§6 — empty parameters → empty');

// ─────────────────────────────────────────────────────────────────────
// Section 7 — Available (walks existing fcurves)
// ─────────────────────────────────────────────────────────────────────

const projectAvail = {
  nodes: [
    { id: 'partA', type: 'part', name: 'PartA', animData: { actionId: 'act1' } },
    { id: 'partB', type: 'part', name: 'PartB', animData: { actionId: 'act2' } },
    { id: 'partC', type: 'part', name: 'PartC', animData: null }, // no action assigned
  ],
  actions: [
    {
      id: 'act1',
      fcurves: [
        { id: 'fc1', rnaPath: 'objects["partA"].transform.x' },
        { id: 'fc2', rnaPath: 'objects["partA"].transform.y' },
      ],
    },
    {
      id: 'act2',
      fcurves: [
        { id: 'fc3', rnaPath: 'objects["partB"].transform.rotation' },
      ],
    },
  ],
};

const av1 = collectChannels(projectAvail, getKeyingSet({}, 'Available'), ['partA']);
eq(av1.length, 2, '§7 — Available on partA: 2 existing fcurves');
eq(av1[0].path, 'objects["partA"].transform.x', '§7 — Available[0] from fcurve.rnaPath');
eq(av1[1].path, 'objects["partA"].transform.y', '§7 — Available[1] from fcurve.rnaPath');

const av2 = collectChannels(projectAvail, getKeyingSet({}, 'Available'), ['partA', 'partB']);
eq(av2.length, 3, '§7 — Available on partA+partB: 3 fcurves total');

// Audit-fix MED-1: shared-action group attribution.
// Pre-fix: every fcurve in a shared action would be attributed to whichever
// object iterated FIRST. Post-fix: each object's iteration only emits paths
// whose rnaPath starts with `objects["<oid>"]` — Blender pattern from
// `_keyingsets_utils.py:157-160` (basePath filter for non-id-block iterators).
const projectAvailShared = {
  nodes: [
    { id: 'partA', type: 'part', name: 'PartA', animData: { actionId: 'shared' } },
    { id: 'partB', type: 'part', name: 'PartB', animData: { actionId: 'shared' } },
  ],
  actions: [
    {
      id: 'shared',
      fcurves: [
        { id: 'fc1', rnaPath: 'objects["partA"].transform.x' },
        { id: 'fc2', rnaPath: 'objects["partB"].transform.y' },
      ],
    },
  ],
};
const avShared = collectChannels(projectAvailShared, getKeyingSet({}, 'Available'), ['partA', 'partB']);
eq(avShared.length, 2, '§7 — Available shared-action: 2 paths (one per owner)');
const partAEntry = avShared.find((p) => p.path === 'objects["partA"].transform.x');
const partBEntry = avShared.find((p) => p.path === 'objects["partB"].transform.y');
ok(partAEntry !== undefined, '§7 — MED-1: partA path emitted');
ok(partBEntry !== undefined, '§7 — MED-1: partB path emitted');
eq(partAEntry.group, 'PartA', '§7 — MED-1: partA group correctly attributed (NOT cross-attributed)');
eq(partBEntry.group, 'PartB', '§7 — MED-1: partB group correctly attributed');

// Defensive dedup: same rnaPath appears twice in the same action (degenerate).
const projectAvailDegen = {
  nodes: [{ id: 'partA', type: 'part', name: 'PartA', animData: { actionId: 'dup' } }],
  actions: [
    {
      id: 'dup',
      fcurves: [
        { id: 'fc1', rnaPath: 'objects["partA"].transform.x' },
        { id: 'fc2', rnaPath: 'objects["partA"].transform.x' }, // dup
      ],
    },
  ],
};
const avDegen = collectChannels(projectAvailDegen, getKeyingSet({}, 'Available'), ['partA']);
eq(avDegen.length, 1, '§7 — defensive dedup against same-action duplicate rnaPath');

// Available filters out fcurves whose rnaPath belongs to a different object.
const projectAvailMixed = {
  nodes: [{ id: 'partA', type: 'part', name: 'PartA', animData: { actionId: 'mixed' } }],
  actions: [
    {
      id: 'mixed',
      fcurves: [
        { id: 'fc1', rnaPath: 'objects["partA"].transform.x' },
        { id: 'fc2', rnaPath: 'objects["__params__"].values["ParamA"]' }, // global, not partA
      ],
    },
  ],
};
const avMixed = collectChannels(projectAvailMixed, getKeyingSet({}, 'Available'), ['partA']);
eq(avMixed.length, 1, '§7 — Available filters non-owner paths (MED-1)');
eq(avMixed[0].path, 'objects["partA"].transform.x', '§7 — only the partA-owned path survives');

// Object with no animData → no paths (when no scene binding exists either).
// `projectAvail` has no `__scene__` node, so the scene fallback in
// availablePaths has nothing to resolve to and the channel set stays empty.
const av3 = collectChannels(projectAvail, getKeyingSet({}, 'Available'), ['partC']);
eq(av3.length, 0, '§7 — Available on object with null animData (no scene binding) → empty');

// Scene-fallback: when `__scene__` carries `animData.actionId` AND the
// scene action has fcurves owned by an object whose per-node animData
// is null, Available now picks those fcurves up. Mirrors the matching
// fallback in `insertKeyframe.js:resolveTargetAction`. Pre-fix
// availablePaths required per-node `animData.actionId` and returned
// 0 paths for every SS object (SS's v36 leaves them null).
const projectAvailScene = {
  nodes: [
    { id: '__scene__', type: 'scene', name: 'Scene', animData: { actionId: 'sceneAct' } },
    { id: 'bone1', type: 'group', name: 'Bone1', boneRole: 'rightArm' /* no animData */ },
  ],
  actions: [
    {
      id: 'sceneAct',
      fcurves: [
        { id: 'fcBoneRot', rnaPath: 'objects["bone1"].pose.rotation' },
        { id: 'fcBoneX',   rnaPath: 'objects["bone1"].pose.x' },
        { id: 'fcOther',   rnaPath: 'objects["__params__"].values["ParamSmile"]' },
      ],
    },
  ],
};
const avScene = collectChannels(projectAvailScene, getKeyingSet({}, 'Available'), ['bone1']);
eq(avScene.length, 2,
  '§7 — scene-fallback: bone with null animData picks up scene action fcurves');
eq(avScene[0].path, 'objects["bone1"].pose.rotation',
  '§7 — scene-fallback: pose.rotation path emitted');
eq(avScene[1].path, 'objects["bone1"].pose.x',
  '§7 — scene-fallback: pose.x path emitted');

// ─────────────────────────────────────────────────────────────────────
// Section 8 — Active keying set pointer (immer mutator)
// ─────────────────────────────────────────────────────────────────────

const projectActive = { activeKeyingSetId: null };
ok(getActiveKeyingSet(projectActive) === null, '§8 — null activeKeyingSetId → null');

setActiveKeyingSet(projectActive, 'Location');
eq(projectActive.activeKeyingSetId, 'Location', '§8 — setActiveKeyingSet wrote pointer');
const activeSet = getActiveKeyingSet(projectActive);
eq(activeSet.id, 'Location', '§8 — getActiveKeyingSet resolves to set');

setActiveKeyingSet(projectActive, null);
eq(projectActive.activeKeyingSetId, null, '§8 — setActiveKeyingSet(null) clears');

let threw = false;
try { setActiveKeyingSet(projectActive, 'NoSuchSet'); } catch { threw = true; }
ok(threw, '§8 — setActiveKeyingSet throws on unknown id (Rule №1)');

threw = false;
try { setActiveKeyingSet(null, 'Location'); } catch { threw = true; }
ok(threw, '§8 — setActiveKeyingSet throws on null project');

// ─────────────────────────────────────────────────────────────────────
// Section 9 — User-defined set CRUD
// ─────────────────────────────────────────────────────────────────────

const projectCrud = {};

addKeyingSet(projectCrud, {
  id: 'MyCustom',
  label: 'My Custom Set',
  description: 'Custom desc',
  paths: [{ path: 'objects["__params__"].values["ParamA"]', group: null }],
});
eq(projectCrud.keyingSets.length, 1, '§9 — addKeyingSet creates keyingSets array + inserts');
eq(projectCrud.keyingSets[0].id, 'MyCustom', '§9 — entry id');
eq(projectCrud.keyingSets[0].label, 'My Custom Set', '§9 — entry label');

const custom = getKeyingSet(projectCrud, 'MyCustom');
ok(custom !== null, '§9 — getKeyingSet resolves user set');
eq(custom.isBuiltin, false, '§9 — user set isBuiltin=false');

// Cannot shadow a built-in
threw = false;
try { addKeyingSet(projectCrud, { id: 'Location', paths: [] }); } catch { threw = true; }
ok(threw, '§9 — addKeyingSet rejects built-in id shadow');

// Cannot duplicate
threw = false;
try { addKeyingSet(projectCrud, { id: 'MyCustom', paths: [] }); } catch { threw = true; }
ok(threw, '§9 — addKeyingSet rejects duplicate id');

// Invalid def
threw = false;
try { addKeyingSet(projectCrud, { id: 'BadSet' }); } catch { threw = true; }
ok(threw, '§9 — addKeyingSet rejects missing paths');
threw = false;
try { addKeyingSet(projectCrud, { id: 'BadSet', paths: [{ path: '' }] }); } catch { threw = true; }
ok(threw, '§9 — addKeyingSet rejects empty path string');

// removeKeyingSet
ok(removeKeyingSet(projectCrud, 'MyCustom') === true, '§9 — removeKeyingSet returns true on success');
eq(projectCrud.keyingSets.length, 0, '§9 — entry removed');
ok(removeKeyingSet(projectCrud, 'NonExistent') === false, '§9 — remove unknown returns false');

threw = false;
try { removeKeyingSet(projectCrud, 'Location'); } catch { threw = true; }
ok(threw, '§9 — removeKeyingSet refuses to remove built-in');

// Active pointer clears when its target is removed
projectCrud.keyingSets = [];
addKeyingSet(projectCrud, { id: 'MyCustom2', paths: [{ path: 'objects["X"].opacity' }] });
setActiveKeyingSet(projectCrud, 'MyCustom2');
removeKeyingSet(projectCrud, 'MyCustom2');
eq(projectCrud.activeKeyingSetId, null, '§9 — removing active set clears activeKeyingSetId');

// ─────────────────────────────────────────────────────────────────────
// Section 10 — cloneKeyingSet
// ─────────────────────────────────────────────────────────────────────

const projectClone = {
  nodes: [{ id: 'partA', type: 'part', name: 'PartA' }],
};
const clonedSet = cloneKeyingSet(projectClone, 'Location', 'MyLoc', undefined, ['partA']);
eq(clonedSet.id, 'MyLoc', '§10 — clone returns new id');
eq(clonedSet.isBuiltin, false, '§10 — clone is user-defined');
eq(clonedSet.paths.length, 2, '§10 — clone snapshots resolved paths');
eq(clonedSet.paths[0].path, 'objects["partA"].transform.x', '§10 — clone[0] path');
eq(clonedSet.label, 'Location', '§10 — clone inherits label when newLabel omitted');

// Custom label
projectClone.keyingSets = [];
const clonedLabeled = cloneKeyingSet(projectClone, 'Location', 'MyLoc2', 'Custom Loc', ['partA']);
eq(clonedLabeled.label, 'Custom Loc', '§10 — clone uses newLabel when provided');

// Clone a user set (uses static paths, not collect)
const projectClone2 = {};
addKeyingSet(projectClone2, { id: 'Src', paths: [{ path: 'objects["X"].opacity', group: 'X' }] });
const c2 = cloneKeyingSet(projectClone2, 'Src', 'Dst');
eq(c2.paths.length, 1, '§10 — clone of user set copies paths');
eq(c2.paths[0].path, 'objects["X"].opacity', '§10 — clone preserves path');

// Cannot clone to a built-in id
threw = false;
try { cloneKeyingSet(projectClone, 'Location', 'Rotation', undefined, ['partA']); } catch { threw = true; }
ok(threw, '§10 — clone rejects built-in id target');

// Cannot clone to existing user id
threw = false;
try { cloneKeyingSet(projectClone2, 'Src', 'Src'); } catch { threw = true; }
ok(threw, '§10 — clone rejects duplicate target id');

// Unknown source
threw = false;
try { cloneKeyingSet(projectClone, 'NoSuchSet', 'X', undefined, []); } catch { threw = true; }
ok(threw, '§10 — clone rejects unknown source');

// ─────────────────────────────────────────────────────────────────────
// Section 11 — listKeyingSets ordering + shadow-attempt rejection
// ─────────────────────────────────────────────────────────────────────

const projectList = {};
addKeyingSet(projectList, { id: 'User1', paths: [{ path: 'objects["A"].opacity' }] });
addKeyingSet(projectList, { id: 'User2', paths: [{ path: 'objects["B"].opacity' }] });

const list = listKeyingSets(projectList);
eq(list.length, 9, '§11 — listKeyingSets: 7 built-ins + 2 user = 9');
eq(list[0].id, 'Available', '§11 — built-ins first (Available)');
eq(list[6].id, 'AllParams', '§11 — built-in tail (AllParams)');
eq(list[7].id, 'User1', '§11 — user sets after built-ins');
eq(list[8].id, 'User2', '§11 — user sets in insertion order');

// Shadow attempt — direct mutation
projectList.keyingSets.push({ id: 'Location', paths: [] });
const list2 = listKeyingSets(projectList);
eq(list2.filter((s) => s.id === 'Location').length, 1, '§11 — listKeyingSets ignores shadow of built-in');

// Empty / missing project handled
eq(listKeyingSets(null).length, 7, '§11 — listKeyingSets(null) returns built-ins');
eq(listKeyingSets({}).length, 7, '§11 — listKeyingSets({}) returns built-ins');

// ─────────────────────────────────────────────────────────────────────
// Section 12 — collectChannels resilience
// ─────────────────────────────────────────────────────────────────────

eq(collectChannels(null, getKeyingSet({}, 'Location'), []), [], '§12 — null project → empty');
eq(collectChannels({}, null, []), [], '§12 — null set → empty');
eq(collectChannels({}, getKeyingSet({}, 'Location'), null), [], '§12 — null objectIds → empty');
eq(collectChannels({}, getKeyingSet({}, 'Available'), null), [], '§12 — Available with null objectIds → empty');

// Audit-fix MED-2 regression: empty-string node.name falls back to node.id.
// Pre-fix: `node.name ?? id` returned '' for `name: ''` (nullish coalescing
// only trips on null/undefined). Post-fix: `node.name || node.id` trips on
// falsy, including empty string. Tested on Location, Rotation, Scaling,
// BlendShape, Available — every site that emits a group label.
const projectEmptyName = {
  nodes: [
    { id: 'noName', type: 'part', name: '' },
    { id: 'undefName', type: 'part' /* no name field */ },
  ],
  parameters: [],
};
const locEmpty = collectChannels(projectEmptyName, getKeyingSet({}, 'Location'), ['noName']);
eq(locEmpty[0].group, 'noName', '§12 — MED-2: empty-string name falls back to id (Location)');
const locUndef = collectChannels(projectEmptyName, getKeyingSet({}, 'Location'), ['undefName']);
eq(locUndef[0].group, 'undefName', '§12 — MED-2: undefined name falls back to id');
const rotEmpty = collectChannels(projectEmptyName, getKeyingSet({}, 'Rotation'), ['noName']);
eq(rotEmpty[0].group, 'noName', '§12 — MED-2: empty name fallback in Rotation');
const scaleEmpty = collectChannels(projectEmptyName, getKeyingSet({}, 'Scaling'), ['noName']);
eq(scaleEmpty[0].group, 'noName', '§12 — MED-2: empty name fallback in Scaling');

const projectAvailEmpty = {
  nodes: [{ id: 'noName', type: 'part', name: '', animData: { actionId: 'a1' } }],
  actions: [{ id: 'a1', fcurves: [{ id: 'fc1', rnaPath: 'objects["noName"].opacity' }] }],
};
const avEmpty = collectChannels(projectAvailEmpty, getKeyingSet({}, 'Available'), ['noName']);
eq(avEmpty[0].group, 'noName', '§12 — MED-2: empty name fallback in Available');

const projectBSEmpty = {
  nodes: [{ id: 'noName', type: 'part', name: '', blendShapeValues: { sh1: 0 } }],
};
const bsEmpty = collectChannels(projectBSEmpty, getKeyingSet({}, 'BlendShape'), ['noName']);
eq(bsEmpty[0].group, 'noName', '§12 — MED-2: empty name fallback in BlendShape');

// User-defined set collect uses static paths
const projectUserCollect = {};
addKeyingSet(projectUserCollect, {
  id: 'Static',
  paths: [
    { path: 'objects["X"].opacity', group: 'X' },
    { path: 'objects["Y"].visible', group: null },
  ],
});
const userSet = getKeyingSet(projectUserCollect, 'Static');
const userPaths = collectChannels(projectUserCollect, userSet, ['ignored']);
eq(userPaths.length, 2, '§12 — user-defined collect: static paths');
eq(userPaths[0].path, 'objects["X"].opacity', '§12 — user-defined path[0]');
eq(userPaths[1].group, null, '§12 — user-defined null group preserved');

// ─────────────────────────────────────────────────────────────────────

console.log(`keyingSets: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
