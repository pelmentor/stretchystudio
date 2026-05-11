// Animation Phase 1 Stage 1.F — Action exporter-side `__scene__` AnimData
// equivalence test.
//
// Per plan §1.F:
//
//   > test_actionScene.mjs — depends on Stage 1.D scene + Stage 1.E
//   > consumers; treats `__scene__` AnimData identically to Object
//   > AnimData via the rewired exporter.
//
// What this test pins down:
//   - The Stage 1.D `__scene__` synthetic Object integrates with the Stage
//     1.C action lifecycle (`assignAction` / `unassignAction` /
//     `getActionUsers` / `deleteAction`) UNCHANGED — no special-case for
//     scene id.
//   - The Stage 1.D `getActiveSceneAction(project, fallback)` selector
//     returns the scene-bound action when set, falling back when null.
//   - The exporter pipeline (`generateMotion3Json` + `generateCan3`) is
//     INDEPENDENT of WHERE the action is bound. They iterate
//     `project.actions[]` directly — the binding question is "what
//     fallback does the UI default to," not "which action goes in the
//     export." This is the key Stage 1.F invariant: exports are
//     binding-agnostic; binding only drives runtime/UI selection.
//
// Why this matters for Phase 1.G exit gate:
//   The Cubism Viewer .moc3 byte-identity gate on Hiyori needs the test
//   to assert that `__scene__`-bound actions go through the EXACT SAME
//   bytes as Object-bound actions, with no "scene-special" branch in the
//   exporter. Otherwise a runtime where the scene binding chose differently
//   would produce different .can3 / .motion3 outputs, breaking the gate.
//
// Run: node scripts/test/test_actionScene.mjs

import { migrateProject } from '../../src/store/projectMigrations.js';
import { getSceneNode, getSceneAction, getActiveSceneAction } from '../../src/anim/sceneAction.js';
import {
  assignAction, unassignAction, getActionUsers, deleteAction,
} from '../../src/anim/actionRegistry.js';
import { generateMotion3Json } from '../../src/io/live2d/motion3json.js';
import { generateCan3 } from '../../src/io/live2d/can3writer.js';

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

function makeProject() {
  // Start at v35 so the v36 → v37 migrations seed everything we need.
  const project = {
    schemaVersion: 35,
    nodes: [
      { id: 'p1', type: 'part' },
      { id: 'leftArm', type: 'group' },
    ],
    animations: [
      {
        id: 'idle', name: 'Idle', fps: 30, duration: 1000,
        tracks: [
          { paramId: 'ParamAngleX', keyframes: [{ time: 0, value: 0 }, { time: 1000, value: 30 }] },
        ],
      },
      {
        id: 'wave', name: 'Wave', fps: 30, duration: 500,
        tracks: [
          { nodeId: 'leftArm', property: 'rotation', keyframes: [{ time: 0, value: 0 }, { time: 500, value: 45 }] },
        ],
      },
    ],
  };
  return migrateProject(project);
}

// ── 1. Scene node receives standard animData via v37 migration ──────────────

{
  const project = makeProject();
  const scene = getSceneNode(project);
  assert(scene !== null, '1: __scene__ node exists post-v37');
  assert(scene.type === 'scene', '1a: type=scene (Blender ID type, not Object kind)');
  assert(scene.animData != null, '1b: __scene__ has animData slot');
  assertEq(scene.animData.actionId, null, '1c: unbound by default');
  assertEq(scene.animData.actionInfluence, 1, '1d: actionInfluence=1 (BKE override)');
  assertEq(scene.animData.actionBlendmode, 'replace', '1e: replace blendmode');
  assertEq(scene.animData.actionExtendmode, 'hold', '1f: hold extendmode');
  assertEq(scene.animData.slotHandle, 0, '1g: slotHandle=0');
}

// ── 2. assignAction + unassignAction work on __scene__ identically to Objects

{
  const project = makeProject();
  const ok = assignAction(project, '__scene__', 'idle');
  assert(ok === true, '2: assignAction succeeds for __scene__');
  assertEq(getSceneNode(project).animData.actionId, 'idle',
    '2a: scene now bound to idle');

  // Same call with a regular Object id.
  assert(assignAction(project, 'p1', 'wave') === true,
    '2b: assignAction succeeds for regular Object');
  const p1 = project.nodes.find((n) => n.id === 'p1');
  assertEq(p1.animData.actionId, 'wave', '2c: p1 bound to wave');

  // Unassign __scene__ — succeeds when binding existed.
  assert(unassignAction(project, '__scene__') === true,
    '2d: unassignAction succeeds for bound __scene__');
  assertEq(getSceneNode(project).animData.actionId, null,
    '2e: scene cleared');

  // Unassigning twice is no-op (returns false per Audit-fix D-5 deviation).
  assert(unassignAction(project, '__scene__') === false,
    '2f: unassignAction on already-unbound __scene__ returns false');
}

// ── 3. getActionUsers walks __scene__ identically (no scene-special branch) ─

{
  const project = makeProject();
  assignAction(project, '__scene__', 'idle');
  assignAction(project, 'p1', 'idle');

  const users = getActionUsers(project, 'idle');
  assert(users.length === 2, `3: 2 users for 'idle' (got ${users.length})`);
  const ids = users.map((n) => n.id).sort();
  assertEq(ids, ['__scene__', 'p1'].sort(),
    '3a: users include both __scene__ AND regular Object — no scene-skip');

  const sceneUser = users.find((u) => u.id === '__scene__');
  assert(sceneUser.type === 'scene', '3b: __scene__ user retains scene type');
  assert(sceneUser.animData.actionId === 'idle',
    '3c: __scene__ user has actionId=idle (real entry, not synthetic)');
}

// ── 4. getActiveSceneAction prefers scene binding over fallback ────────────
//
// DEVIATION FROM BLENDER (Stage 1.F audit-fix D-6):
// Blender does NOT auto-compose "scene's action OR editor's pinned
// action." Each consumer reads its own slot directly:
//   - Exporter reads `BKE_animdata_from_id(&scene->id)->action`
//   - Action Editor reads its own pinned-slot pointer
//   - Object animation reads `BKE_animdata_from_id(&object->id)->action`
//
// SS's "scene wins over UI fallback" composition is a Phase-1 BRIDGE
// for legacy UI behaviour (pre-Stage-1.E consumers that read
// `useAnimationStore.activeActionId`). Phase 1.E callers that own the
// bound-action UX should consume `getSceneAction(project)` directly
// (no fallback) and reserve `getActiveSceneAction` for shared transport
// widgets that legitimately want either. See `sceneAction.js:148-164`
// for the Phase-scope warning that applies once per-Object adt
// evaluation lands (Phase 2+ skeletal animation alongside scene-bound
// facial expression action).

{
  const project = makeProject();

  // No binding yet → fallback wins.
  const fb1 = getActiveSceneAction(project, 'wave');
  assertEq(fb1?.id, 'wave', '4: unbound scene + fallback → fallback');

  // Bind scene to idle → scene wins over fallback.
  assignAction(project, '__scene__', 'idle');
  const bound = getActiveSceneAction(project, 'wave');
  assertEq(bound?.id, 'idle', '4a: bound scene wins over fallback');

  // Drop fallback — scene still wins.
  const noFb = getActiveSceneAction(project, null);
  assertEq(noFb?.id, 'idle', '4b: bound scene resolves with null fallback');
}

// ── 5. deleteAction cascade nulls __scene__ binding ────────────────────────

{
  const project = makeProject();
  assignAction(project, '__scene__', 'idle');
  assignAction(project, 'p1', 'idle');

  const result = deleteAction(project, 'idle');
  assert(result.removed === true, '5: action removed');
  assertEq(result.cascaded, 2, '5a: cascade nulled both __scene__ AND p1');

  assertEq(getSceneNode(project).animData.actionId, null,
    '5b: __scene__ binding nulled by cascade');
  const p1 = project.nodes.find((n) => n.id === 'p1');
  assertEq(p1.animData.actionId, null, '5c: p1 binding nulled by cascade');
}

// ── 6. Exporter equivalence: motion3 carries no __scene__ leakage ──────────
//
// Stage 1.F audit-fix G-5 reframe: byte-identity here is near-tautological
// — both calls feed the same `action` object to a pure function (the
// migration is idempotent, both projects are deep-equal). The non-trivial
// claim worth pinning is the ABSENCE OF LEAKAGE — that no scene-special
// metadata (`__scene__` markers, scene-binding flags, etc.) appears in
// the motion3.json output regardless of which node holds the binding.
// If a future refactor accidentally piped binding state into the
// generator (e.g. as an "is scene action?" flag affecting Loop), this
// would catch it.

{
  const projectScene = makeProject();
  assignAction(projectScene, '__scene__', 'idle');
  const sceneAction = projectScene.actions.find((a) => a.id === 'idle');

  const projectObj = makeProject();
  assignAction(projectObj, 'p1', 'idle');
  const objAction = projectObj.actions.find((a) => a.id === 'idle');

  const m1 = generateMotion3Json(sceneAction);
  const m2 = generateMotion3Json(objAction);

  // The non-trivial assertion: NO leakage of binding state into output.
  assert(!JSON.stringify(m1).includes('__scene__'),
    '6: motion3 (scene-bound action) has no __scene__ leakage');
  assert(!JSON.stringify(m2).includes('__scene__'),
    '6a: motion3 (object-bound action) has no __scene__ leakage');
  // Sanity: structural shape matches across both (since both pull from
  // the same migration output). Not a tautology guarantee — pinned for
  // signal that the binding-agnostic invariant didn't drift mid-refactor.
  assertEq(m1.Curves.length, m2.Curves.length,
    '6b: motion3 curve count is binding-agnostic');
  assertEq(m1.Meta.Fps, m2.Meta.Fps,
    '6c: motion3 Meta.Fps is binding-agnostic');
}

// ── 7. Exporter input is binding-agnostic: project.actions[] structural eq ─

{
  // The exporter pipeline takes `project.actions[]` as input verbatim —
  // never reads `__scene__.animData.actionId` to "filter" or "select" the
  // action. Therefore: two projects that share the same actions[] but
  // differ only in WHICH node holds the binding feed the writer with
  // STRUCTURALLY IDENTICAL input. (Byte-level can3 output is non-
  // deterministic due to random UUIDs in the CAFF wrapper, but structure
  // — sceneCount, actions array — is identical.)
  const projectScene = makeProject();
  assignAction(projectScene, '__scene__', 'idle');

  const projectObj = makeProject();
  assignAction(projectObj, 'p1', 'idle');

  assertEq(projectScene.actions, projectObj.actions,
    '7: project.actions identical regardless of which node holds the binding');

  // Both writers succeed and produce non-empty output. Functional check
  // that exporter doesn't crash on either binding shape.
  const dpm = new Map([
    ['leftArm', { paramId: 'ParamRotation_leftArm', min: -30, max: 30, rest: 0 }],
  ]);
  const can3a = await generateCan3({
    actions: projectScene.actions, deformerParamMap: dpm,
    cmo3FileName: 'model.cmo3', canvasW: 1024, canvasH: 1024,
  });
  const can3b = await generateCan3({
    actions: projectObj.actions, deformerParamMap: dpm,
    cmo3FileName: 'model.cmo3', canvasW: 1024, canvasH: 1024,
  });

  assert(can3a.byteLength > 1000, '7a: scene-bound can3 produces non-trivial output');
  assert(can3b.byteLength > 1000, '7b: object-bound can3 produces non-trivial output');
}

// ── 8. Scene-binding survives save/load JSON round-trip ────────────────────

{
  const project = makeProject();
  assignAction(project, '__scene__', 'idle');

  const json = JSON.stringify(project);
  const reloaded = JSON.parse(json);

  // The node entry survives verbatim because it lives in project.nodes[].
  // (If __scene__ were a UI-store concept, this round-trip would fail.)
  const scene = getSceneNode(reloaded);
  assertEq(scene.id, '__scene__', '8: __scene__ node survives JSON round-trip');
  assertEq(scene.type, 'scene', '8a: type preserved');
  assertEq(scene.animData.actionId, 'idle', '8b: scene binding persists across save/load');

  // The selector still works on the reloaded copy.
  const action = getActiveSceneAction(reloaded, null);
  assertEq(action?.id, 'idle', '8c: getActiveSceneAction works post-load');
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nactionScene: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
