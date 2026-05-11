// Audit-fix pin tests for Animation Phase 1 Stage 1.D
// (commit `220655e` substrate + audit-fix sweep).
//
// Pins every gap from the dual audit (architecture G-1..G-20 +
// Blender-fidelity D-1..D-17) so future refactors that re-introduce
// the gap surface as a regression here. Each block annotates its gap
// id + severity. Combines source-file string-grep (catches doc/comment
// regressions) + functional behaviour tests where applicable.
//
// Run: node scripts/test/test_audit_fixes_2026_05_11_phase1_stage1d.mjs

import {
  migrateSceneAnimData,
  makeSceneNode,
  isSceneNode,
} from '../../src/store/migrations/v37_scene_anim_data.js';
import {
  getSceneNode,
  getSceneAction,
  getActiveSceneAction,
} from '../../src/anim/sceneAction.js';
import {
  getActionUsers,
  assignAction,
  unassignAction,
  cloneAction,
  deleteAction,
} from '../../src/anim/actionRegistry.js';

const fs = await import('node:fs/promises');
const path = await import('node:path');
const url = await import('node:url');
const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

async function readSrc(rel) {
  return fs.readFile(path.join(repoRoot, rel), 'utf8');
}

/**
 * Normalise JSDoc-style multi-line text for substring grep:
 *   `* foo\n * bar` → `foo bar`
 * Strips the `\n * ` (newline + space + asterisk + space) sequence
 * and collapses runs of whitespace so prose-style assertions can use
 * single-line regex patterns.
 */
function flatJsdoc(src) {
  return src.replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ');
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function makeProject() {
  return {
    schemaVersion: 37,
    actions: [
      { id: 'action-1', name: 'Idle', fcurves: [], audioTracks: [], flag: 0,
        meta: { source: 'authored' } },
      { id: 'action-2', name: 'Wave', fcurves: [], audioTracks: [], flag: 0,
        meta: { source: 'authored' } },
    ],
    nodes: [
      makeSceneNode(),
      { id: 'leftArm', type: 'group', animData: {
        actionId: null, actionInfluence: 1, actionBlendmode: 'replace',
        actionExtendmode: 'hold', slotHandle: 0, nlaTracks: [], drivers: [], flag: 0
      } },
    ],
  };
}

// ── G-1 (HIGH) — resetProject must re-seed the scene node ──────────────────

{
  const projectStoreSrc = await readSrc('src/store/projectStore.js');
  // resetProject's `state.project.nodes = ...` array literal must include
  // the __scene__ node. String-grep the resetProject body region.
  const resetIdx = projectStoreSrc.indexOf('resetProject:');
  const after = projectStoreSrc.slice(resetIdx, resetIdx + 4000);
  assert(after.includes(`id: '__scene__'`),
    'G-1: resetProject body re-seeds the __scene__ node literal');
  assert(after.includes(`type: 'scene'`),
    'G-1: resetProject seeds with type "scene"');
  assert(/Audit-fix G-1/.test(after),
    'G-1: resetProject carries an audit-fix breadcrumb');
}

// ── G-2 (HIGH→MED documented) — substrate-without-callers acknowledged ────
// sceneAction.js must explicitly document the Stage 1.E entry-gate
// status so callable-by-no-one is clearly documented as Stage 1.E
// pending, not silently shipped (per Rule №2).

{
  const src = await readSrc('src/anim/sceneAction.js');
  assert(/Stage 1\.E/.test(src),
    'G-2: sceneAction.js documents Stage 1.E entry-gate');
  // Plan also enumerates the consumer list
  const plan = await readSrc('docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md');
  assert(/Full `useAnimationStore.activeActionId` consumer rewire/.test(plan),
    'G-2: plan §1.C entry-gate enumerates the activeActionId consumer rewire');
}

// ── G-3 (HIGH) — synthetic-node convention claim corrected ────────────────

{
  const v37flat = flatJsdoc(await readSrc('src/store/migrations/v37_scene_anim_data.js'));
  assert(/`__params__` is virtual/i.test(v37flat),
    'G-3: v37 migration JSDoc clarifies __params__ is virtual');
  assert(/FIRST double-underscore synthetic that lives as a REAL entry/i.test(v37flat),
    'G-3: v37 migration JSDoc flags __scene__ as the convention break');
  const regFlat = flatJsdoc(await readSrc('src/anim/actionRegistry.js'));
  assert(/__params__.*VIRTUAL|VIRTUAL.*__params__/i.test(regFlat),
    'G-3: actionRegistry JSDoc no longer claims __params__ is in nodes');
}

// ── G-4 (MED) — drift safety-net tightened ────────────────────────────────
// The original drift test does substring-grep. We add a stronger
// post-condition: the projectStore initial-state literal must contain
// EXACTLY the 8 animData fields makeSceneNode ships (no more, no less).

{
  const projectStoreSrc = await readSrc('src/store/projectStore.js');
  // The initial-state's __scene__ literal lives in the first ~150 lines
  // of the `project: { ... }` block. Slice the region around the literal.
  const sceneIdx = projectStoreSrc.indexOf(`id: '__scene__'`);
  assert(sceneIdx > -1, 'G-4: __scene__ literal present in projectStore');
  const region = projectStoreSrc.slice(sceneIdx, sceneIdx + 1500);
  // Each field must appear exactly once in the slice.
  const fieldNames = ['actionId', 'actionInfluence', 'actionBlendmode',
                      'actionExtendmode', 'slotHandle', 'nlaTracks',
                      'drivers', 'flag'];
  for (const f of fieldNames) {
    const re = new RegExp(`\\b${f}:`, 'g');
    const matches = region.match(re) || [];
    assert(matches.length === 1,
      `G-4: projectStore __scene__ literal has exactly one '${f}:' (got ${matches.length})`);
  }
}

// ── G-7 + D-4 (MED+HIGH) — Outliner exclusion documented, not silent ─────

{
  const src = await readSrc('src/v3/editors/outliner/treeBuilder.js');
  assert(/Audit-fix G-7 \+ D-4/.test(src),
    'G-7+D-4: treeBuilder carries audit-fix breadcrumb for scene exclusion');
  assert(/Stage 1\.E/.test(src),
    'G-7+D-4: treeBuilder defers Scene root view to Stage 1.E');
}

// ── G-8 (MED) — isObject excludes scene with documentation ────────────────

{
  const src = await readSrc('src/store/objectDataAccess.js');
  const flat = flatJsdoc(src);
  assert(/Audit-fix G-8/.test(src),
    'G-8: isObject JSDoc carries audit-fix breadcrumb');
  assert(/Blender's Scene is a peer ID datablock/.test(flat),
    'G-8: isObject JSDoc cites Blender ID-vs-Object distinction');
}

// ── G-9 (MED) — cross-default-equivalence: v36 and v37 animData align ─────

{
  // v36's defaultAnimData() is private; we can't import. So we read its
  // source and check field-name presence. Meta-test against drift.
  const v36src = await readSrc('src/store/migrations/v36_action_datablock.js');
  const v37fields = Object.keys(makeSceneNode().animData).sort();
  // Sanity: v36 source contains the function symbol
  assert(v36src.includes('function defaultAnimData()'),
    'G-9: v36 defaultAnimData() function present in source');
  // Every v37 field name must appear with `:` in v36's source body
  for (const f of v37fields) {
    assert(v36src.includes(`${f}:`),
      `G-9: v37 animData field '${f}' also present in v36 defaultAnimData`);
  }
}

// ── G-11 (MED) — computeWorldMatrices benign-identity-matrix documented ───

{
  const src = await readSrc('src/renderer/transforms.js');
  assert(/Audit-fix G-11/.test(src),
    'G-11: computeWorldMatrices carries audit-fix breadcrumb');
}

// ── G-12 (MED) — both-bound (Object AND scene) cascade test ───────────────

{
  const project = makeProject();
  // Bind both leftArm AND scene to action-1
  assignAction(project, 'leftArm', 'action-1');
  assignAction(project, '__scene__', 'action-1');
  const users = getActionUsers(project, 'action-1');
  assert(users.length === 2,
    'G-12: getActionUsers returns BOTH leftArm and __scene__ when both bound');
  assert(users.some((u) => u.id === 'leftArm'),
    'G-12: leftArm in users list');
  assert(users.some((u) => u.id === '__scene__'),
    'G-12: __scene__ in users list');
  // Now delete the action — both should cascade to null
  const result = deleteAction(project, 'action-1');
  assert(result.cascaded === 2,
    'G-12: deleteAction cascade count includes both Object + scene bindings');
  const arm = project.nodes.find((n) => n.id === 'leftArm');
  const scene = getSceneNode(project);
  assert(arm.animData.actionId === null,
    'G-12: leftArm cascade nulled');
  assert(scene.animData.actionId === null,
    'G-12: scene cascade nulled');
}

// ── G-13 (LOW) — getSceneAction standalone usage rationale documented ─────

{
  const flat = flatJsdoc(await readSrc('src/anim/sceneAction.js'));
  assert(/Stage 1\.E callers should consume `getSceneAction` directly/.test(flat),
    'G-13: sceneAction.js documents getSceneAction standalone usage rationale');
}

// ── G-15 (LOW) — round-trip with __scene__ binding ────────────────────────
// Simulate save → load by JSON.stringify + JSON.parse + migrate.

{
  const project = makeProject();
  assignAction(project, '__scene__', 'action-1');
  const json = JSON.parse(JSON.stringify(project));
  // Re-run v37 migration (idempotent); binding must survive.
  migrateSceneAnimData(json);
  const scene = getSceneNode(json);
  assert(scene !== null, 'G-15: scene node survives round-trip');
  assert(scene.animData.actionId === 'action-1',
    'G-15: scene binding survives round-trip');
  const action = getSceneAction(json);
  assert(action !== null && action.id === 'action-1',
    'G-15: getSceneAction resolves through the round-tripped binding');
}

// ── G-16 (LOW) — selectionStore non-selectable comment ────────────────────

{
  const src = await readSrc('src/store/selectionStore.js');
  assert(/Audit-fix G-16/.test(src),
    'G-16: selectionStore carries audit-fix breadcrumb');
  // The SelectableType union must NOT include 'scene'
  const typedef = src.match(/@typedef \{[^}]+SelectableType[^}]*\}/);
  if (typedef) {
    assert(!typedef[0].includes("'scene'"),
      'G-16: SelectableType excludes "scene"');
  }
}

// ── D-1 + D-2 (HIGH) — Blender citations corrected ────────────────────────

{
  const v37src = await readSrc('src/store/migrations/v37_scene_anim_data.js');
  const sceneActionSrc = await readSrc('src/anim/sceneAction.js');
  const planSrc = await readSrc('docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md');

  // BKE_animdata_id_action does NOT exist in Blender — every reference
  // must either (a) cite BKE_animdata_from_id instead, or (b) appear in
  // a NEGATION context that explicitly disclaims the wrong API.
  // sceneAction.js intentionally mentions the name to deny it
  // ("There is no `BKE_animdata_id_action` function in Blender").
  function noUnqualifiedCite(text, label) {
    // Match the API name only when NOT preceded by "no " / "non-existent "
    // within the same sentence (rough heuristic: 24-char window).
    const re = /(.{0,24})BKE_animdata_id_action/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const ctx = m[1].toLowerCase();
      if (!/(no |non-existent |not the|wrong|denies|disclaim)/.test(ctx)) {
        return false;
      }
    }
    return true;
  }
  assert(noUnqualifiedCite(v37src, 'v37'),
    'D-1: v37 migration: any BKE_animdata_id_action mention is in negation context');
  assert(noUnqualifiedCite(sceneActionSrc, 'sceneAction'),
    'D-1: sceneAction: any BKE_animdata_id_action mention is in negation context');
  assert(noUnqualifiedCite(planSrc, 'plan'),
    'D-1: plan: any BKE_animdata_id_action mention is in negation context');
  assert(v37src.includes('BKE_animdata_from_id'),
    'D-1: v37 migration cites the real BKE_animdata_from_id');
  assert(sceneActionSrc.includes('BKE_animdata_from_id'),
    'D-1: sceneAction cites the real BKE_animdata_from_id');

  // DNA_scene_types.h:2225 was wrong; correct line is 2813
  assert(!v37src.includes('DNA_scene_types.h:2225'),
    'D-2: v37 migration no longer cites the wrong line :2225');
  assert(!sceneActionSrc.includes('DNA_scene_types.h:2225'),
    'D-2: sceneAction no longer cites the wrong line :2225');
  assert(!planSrc.includes('DNA_scene_types.h:2225'),
    'D-2: plan no longer cites the wrong line :2225');
  assert(v37src.includes('DNA_scene_types.h:2813'),
    'D-2: v37 migration cites the correct line :2813');
}

// ── D-3 (HIGH) — `type: 'scene'` not `'sceneObject'` ──────────────────────

{
  const v37src = await readSrc('src/store/migrations/v37_scene_anim_data.js');
  const projectStoreSrc = await readSrc('src/store/projectStore.js');
  assert(!v37src.includes("'sceneObject'"),
    'D-3: v37 migration no longer uses the invented type "sceneObject"');
  assert(!projectStoreSrc.includes("'sceneObject'"),
    'D-3: projectStore no longer uses "sceneObject"');
  // makeSceneNode produces type 'scene'
  assert(makeSceneNode().type === 'scene',
    'D-3: makeSceneNode returns type "scene"');
}

// ── D-5 + D-6 (HIGH) — eager-create + actInfluence=1 deviations documented ─

{
  const v37src = await readSrc('src/store/migrations/v37_scene_anim_data.js');
  const planSrc = await readSrc('docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md');
  assert(/Audit-fix D-5/.test(v37src),
    'D-5: v37 migration carries actionInfluence=1 deviation breadcrumb');
  assert(/Audit-fix D-6/.test(v37src),
    'D-6: v37 migration carries lazy-vs-eager deviation breadcrumb');
  assert(/D-5:|D-5/.test(planSrc),
    'D-5: plan §1.D carries deviation note');
  assert(/D-6:|D-6/.test(planSrc),
    'D-6: plan §1.D carries deviation note');
}

// ── D-7 + G-19 (HIGH) — exporter overclaim corrected ─────────────────────

{
  const planSrc = await readSrc('docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md');
  assert(/Substrate shipped/.test(planSrc) || /substrate only/.test(planSrc),
    'D-7+G-19: plan §1.D clarifies substrate-only ship vs exporter wire-up');
}

// ── D-9 (MED) — Stage 1.E entry-gate enumerates full consumer list ───────

{
  const planSrc = await readSrc('docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md');
  // Must enumerate at least the high-traffic consumers
  const consumers = [
    'TimelineEditor.jsx',
    'DopesheetEditor.jsx',
    'FCurveEditor.jsx',
    'CanvasViewport.jsx',
    'GizmoOverlay.jsx',
    'ExportModal.jsx',
    'exportAnimation.js',
  ];
  for (const c of consumers) {
    assert(planSrc.includes(c),
      `D-9: Stage 1.E gate enumerates ${c} as activeActionId consumer`);
  }
}

// ── D-10 (MED) — getActiveSceneAction SS-specific composition documented ──

{
  const src = await readSrc('src/anim/sceneAction.js');
  const flat = flatJsdoc(src);
  assert(/Audit-fix D-10/.test(src),
    'D-10: sceneAction.js carries SS-specific composition breadcrumb');
  assert(/Blender does NOT auto-resolve/.test(flat),
    'D-10: sceneAction.js explicitly cites Blender deviation');
}

// ── D-11 (MED) — assignAction NLA editability guard deferred ─────────────

{
  const src = await readSrc('src/anim/actionRegistry.js');
  const flat = flatJsdoc(src);
  assert(/D-11 from Stage 1\.D/.test(flat),
    'D-11: actionRegistry assignAction documents NLA-editability deferral');
  assert(/BKE_animdata_action_editable/.test(src),
    'D-11: actionRegistry cites the Blender editability function');
}

// ── D-12 (MED) — migration force-corrects type on hand-edit collision ────

{
  const project = {
    schemaVersion: 36,
    nodes: [{ id: '__scene__', type: 'group', parent: 'foreign' }],
  };
  migrateSceneAnimData(project);
  const scene = project.nodes.find((n) => n && n.id === '__scene__');
  assert(scene.type === 'scene',
    'D-12: hand-edited type "group" force-corrected to "scene"');
  assert(scene.parent === null,
    'D-12: hand-edited foreign parent reset to null');
  assert(isSceneNode(scene),
    'D-12: corrected node passes isSceneNode predicate');
  // Functional gate: assignAction now succeeds AND getSceneAction resolves
  const project2 = {
    schemaVersion: 36,
    actions: [{ id: 'a1', name: 'A', fcurves: [] }],
    nodes: [{ id: '__scene__', type: 'group' }],
  };
  migrateSceneAnimData(project2);
  assert(assignAction(project2, '__scene__', 'a1') === true,
    'D-12: post-correction assignAction succeeds');
  assert(getSceneAction(project2)?.id === 'a1',
    'D-12: post-correction getSceneAction resolves (no read/write asymmetry)');
}

// ── D-13 (LOW) — "Used by: Scene" UI label flagged for Stage 1.E ─────────

{
  const planSrc = await readSrc('docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md');
  assert(/D-13/.test(planSrc),
    'D-13: plan §1.E entry-gate flags the "Used by: Scene" label concern');
}

// ── D-15 (LOW) — first real-node synthetic convention break documented ───

{
  const v37src = await readSrc('src/store/migrations/v37_scene_anim_data.js');
  assert(/Audit-fix.*D-15|D-15.*Stage 1\.D/.test(v37src),
    'D-15: v37 migration documents the first-real-node-synthetic convention break');
}

// ── D-16 (LOW) — strict animData repair contract ─────────────────────────

{
  const project = {
    schemaVersion: 36,
    nodes: [{ id: '__scene__', animData: 'broken' }],
  };
  let threw = false;
  try {
    migrateSceneAnimData(project);
  } catch (e) {
    threw = true;
    assert(/corrupt animData/.test(String(e.message)),
      'D-16: corrupt animData throws with descriptive message');
  }
  assert(threw, 'D-16: corrupt-animData throws (no silent overwrite)');
}

// ── Cross-store cascade: deleteAction resets useAnimationStore ───────────
// G-3 from Stage 1.C also applies to scene-bound actions. Test that the
// projectStore.deleteAction thunk would reset activeActionId when it
// matches — by string-grep on the source (we don't load the store here).

{
  const src = await readSrc('src/store/projectStore.js');
  assert(/Audit-fix G-3/.test(src),
    'X-store: projectStore.deleteAction G-3 cascade still in source');
  assert(/animState\.activeActionId === id/.test(src),
    'X-store: cascade compares against deleted id');
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
