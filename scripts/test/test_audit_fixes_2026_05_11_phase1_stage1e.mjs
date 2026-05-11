// Audit-pin tests for Animation Phase 1 Stage 1.E sweep — captures the
// 24 gap blocks (4 HIGH + 8 MED + 12 LOW) that the dual audit surfaced
// after commit `4d3892a` (Stage 1.E substrate ship). Each block asserts
// the audit fix is present in source / behaviour, so a future regression
// (rename revert, dep-array reset, clone-name fallback, etc.) trips here
// rather than at runtime.
//
// Run: node scripts/test/test_audit_fixes_2026_05_11_phase1_stage1e.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cloneAction,
  getActionUsers,
} from '../../src/anim/actionRegistry.js';
import {
  getSceneAction,
  getActiveSceneAction,
} from '../../src/anim/sceneAction.js';
import { makeSceneNode } from '../../src/store/migrations/v37_scene_anim_data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Flatten JSDoc multi-line text — strips `\n * ` (block-comment) AND
 *  `\n   // ` (line-comment) continuations so regex patterns can match
 *  wrapped sentences across both styles. Normalises CRLF first so
 *  Windows files match the same patterns as LF files. Uses ` *` (literal
 *  space) instead of `\s*` for the trailing whitespace after `*` so we
 *  don't gobble the next line's `\n` into the strip (which would orphan
 *  the next `*` continuation marker). */
function flatJsdoc(s) {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]*\*[ \t]?/g, ' ')
    .replace(/\n[ \t]*\/\/[ \t]?/g, ' ');
}

function fileMatches(rel, regex) {
  if (!existsSync(join(ROOT, rel))) return false;
  return regex.test(read(rel));
}

function fileFlatMatches(rel, regex) {
  if (!existsSync(join(ROOT, rel))) return false;
  return regex.test(flatJsdoc(read(rel)));
}

function fileContains(rel, str) {
  if (!existsSync(join(ROOT, rel))) return false;
  return read(rel).includes(str);
}

function makeProjectWithSceneBound(actionId) {
  return {
    schemaVersion: 37,
    actions: [
      { id: 'action-1', name: 'Idle', fcurves: [], audioTracks: [], meta: { source: 'authored' } },
      { id: 'action-2', name: 'Wave', fcurves: [], audioTracks: [], meta: { source: 'authored' } },
    ],
    nodes: [
      { ...makeSceneNode(), animData: { actionId, slotHandle: 0, actionInfluence: 1 } },
      { id: 'leftArm', type: 'group', animData: { actionId: null, slotHandle: 0 } },
    ],
  };
}

// ── HIGH gaps ──────────────────────────────────────────────────────────────

// D-1 — Item-tab placement deferral note
assert(
  fileFlatMatches(
    'src/v3/editors/properties/propertiesTabRegistry.jsx',
    /Audit-fix D-1 Stage 1\.E.*PropertiesAnimationMixin\.bl_context/,
  ),
  'D-1: propertiesTabRegistry documents Item-tab placement as deviation from Blender Data tab',
);

// D-2 — Section label "Animation"
assert(
  fileContains('src/v3/editors/properties/sections/AnimDataSection.jsx', 'label="Animation"'),
  'D-2: AnimDataSection SectionShell label is "Animation"',
);
assert(
  !fileContains('src/v3/editors/properties/sections/AnimDataSection.jsx', 'label="Animation Data"'),
  'D-2: legacy "Animation Data" label removed',
);
assert(
  fileContains('src/v3/editors/properties/sectionRegistry.jsx', "label: 'Animation'"),
  'D-2: sectionRegistry uses "Animation" label',
);

// D-3 — default-collapsed
assert(
  fileMatches('src/store/editorStore.js', /propertiesSectionsCollapsed:\s*new Set\(\['animData'\]\)/),
  'D-3: editorStore.propertiesSectionsCollapsed seeds animData (default-closed)',
);
assert(
  fileFlatMatches(
    'src/store/editorStore.js',
    /Audit-fix D-3.*bl_options = \{'DEFAULT_CLOSED'\}/,
  ),
  'D-3: editorStore.propertiesSectionsCollapsed JSDoc cites Blender bl_options',
);

// D-4 — bl_order positioning (animData is last in Item tab sectionIds)
assert(
  fileMatches(
    'src/v3/editors/properties/propertiesTabRegistry.jsx',
    /sectionIds:\s*\[\s*'transform',\s*'visibility',\s*'partInfo',\s*'animData'\s*\]/,
  ),
  'D-4: animData positioned LAST in Item tab sectionIds',
);

// ── MED gaps ───────────────────────────────────────────────────────────────

// G-3 — deletion-cascade UX feedback
assert(
  fileContains('src/v3/editors/actions/ActionsEditor.jsx', "import { toast }"),
  'G-3: ActionsEditor imports toast for deletion feedback',
);
assert(
  fileFlatMatches(
    'src/v3/editors/actions/ActionsEditor.jsx',
    /Audit-fix G-3 Stage 1\.E.*capture pre-delete user list/,
  ),
  'G-3: confirmDelete captures pre-delete users for toast feedback',
);
assert(
  fileFlatMatches(
    'src/v3/editors/actions/ActionsEditor.jsx',
    /Audit-fix G-3 Stage 1\.E.*surface bindings BEFORE delete/,
  ),
  'G-3: AlertDialog surfaces bindings before delete confirms',
);

// G-10 — cloneAction thunk returns full object
assert(
  fileFlatMatches(
    'src/store/projectStore.js',
    /returns the FULL cloned action object[\s\S]*?Audit-fix G-10 Stage 1\.E/,
  ),
  'G-10: projectStore.cloneAction thunk returns full object (not just id)',
);
assert(
  fileMatches(
    'src/store/projectStore.js',
    /return finalActions\.find\(\(a\) => a && a\.id === createdId\) \?\? null/,
  ),
  'G-10: thunk re-resolves the post-finalised action object after produce()',
);

// D-6 — .001 suffix for clones (functional)
{
  const proj = {
    schemaVersion: 37,
    actions: [
      { id: 'a1', name: 'Idle', fcurves: [], audioTracks: [], meta: { source: 'authored' } },
    ],
    nodes: [makeSceneNode()],
  };
  const c1 = cloneAction(proj, 'a1');
  assert(c1?.name === 'Idle.001', 'D-6: first clone of "Idle" → "Idle.001"');
  const c2 = cloneAction(proj, 'a1');
  assert(c2?.name === 'Idle.002', 'D-6: second clone of "Idle" → "Idle.002"');
  const c3 = cloneAction(proj, 'a1');
  assert(c3?.name === 'Idle.003', 'D-6: third clone of "Idle" → "Idle.003"');
}
assert(
  fileFlatMatches(
    'src/anim/actionRegistry.js',
    /BKE_main_namemap_get_unique_name.*main_namemap\.cc:450/,
  ),
  'D-6: actionRegistry.nextDotNNNName JSDoc cites BKE_main_namemap_get_unique_name',
);

// D-5 — ActionsEditor JSDoc on Duplicate deviation
assert(
  fileFlatMatches(
    'src/v3/editors/actions/ActionsEditor.jsx',
    /Audit-fix D-5 Stage 1\.E.*Blender\s+has no explicit "Duplicate Action" command/,
  ),
  'D-5: ActionsEditor module JSDoc documents Duplicate-button deviation',
);

// D-7 — Timeline picker rebind JSDoc (kept; documented as Blender template_action parallel)
assert(
  fileFlatMatches(
    'src/v3/editors/timeline/TimelineEditor.jsx',
    /Audit-fix D-7 Stage 1\.E.*Blender's `template_action.*scripts\/startup\/bl_ui\/space_dopesheet\.py:313/,
  ),
  'D-7: TimelineEditor picker rebind documented as Blender template_action parallel',
);

// D-8 — getActiveSceneAction "scene wins" Phase-scope warning
assert(
  fileFlatMatches(
    'src/anim/sceneAction.js',
    /Phase-scope warning \(Audit-fix D-8 Stage 1\.E\)[\s\S]{0,800}Phase 2\+ consumers that introduce per-Object adt evaluation/,
  ),
  'D-8: getActiveSceneAction JSDoc warns about scene-wins-semantic Phase scope',
);

// D-11 — Used-by strip extension JSDoc
assert(
  fileFlatMatches(
    'src/v3/editors/actions/ActionsEditor.jsx',
    /Audit-fix D-11 Stage 1\.E.*EXTENSION of Blender's pattern.*template_id.*interface_template_id\.cc:1267/,
  ),
  'D-11: ActionsEditor Used-by strip documented as Blender extension',
);

// D-12 — Scene-action header JSDoc (Blender SCENE_PT_animation parallel)
assert(
  fileFlatMatches(
    'src/v3/editors/actions/ActionsEditor.jsx',
    /Audit-fix D-12 Stage 1\.E.*SCENE_PT_animation.*properties_scene\.py:452/,
  ),
  'D-12: ActionsEditor scene-header documented vs Blender SCENE_PT_animation',
);

// ── LOW gaps ───────────────────────────────────────────────────────────────

// G-1 — ExportModal dep array narrowed
assert(
  fileMatches(
    'src/v3/shell/ExportModal.jsx',
    /\[project\.nodes,\s*project\.actions,\s*uiActiveActionId\]/,
  ),
  'G-1: ExportModal activeActionId useMemo dep narrowed to nodes+actions+ui',
);
assert(
  fileFlatMatches(
    'src/v3/shell/ExportModal.jsx',
    /Audit-fix G-1 Stage 1\.E.*narrow dep to the two slices/,
  ),
  'G-1: ExportModal narrow-dep change is documented',
);

// G-2 — TimelineEditor handler consistency (lines 1446 + 1465 use canonical pattern)
assert(
  !fileMatches(
    'src/v3/editors/timeline/TimelineEditor.jsx',
    /p\.actions\.find\(x => x\.id === animation\.id\)/,
  ),
  'G-2: TimelineEditor field handlers no longer use animation.id direct find (canonical getActiveSceneAction pattern)',
);

// G-6 — HelpModal text rename
assert(
  fileContains('src/v3/shell/HelpModal.jsx', 'with the Actions panel'),
  'G-6: HelpModal animation workspace blurb references "Actions panel"',
);
assert(
  !fileContains('src/v3/shell/HelpModal.jsx', 'with the Animations list'),
  'G-6: HelpModal stale "Animations list" copy removed',
);

// G-7 — actionRegistry deleteAction docstring rename
assert(
  fileContains('src/anim/actionRegistry.js', '(Timeline / Dopesheet / FCurve / Actions / param row'),
  'G-7: actionRegistry deleteAction docstring uses "Actions" panel name',
);
assert(
  !fileContains('src/anim/actionRegistry.js', '/ Animations / param row'),
  'G-7: actionRegistry deleteAction docstring legacy "Animations" panel name removed',
);

// G-8 — ExportModal copy update
assert(
  fileContains('src/v3/shell/ExportModal.jsx', 'No actions in this project yet'),
  'G-8: ExportModal empty-state copy updated to "No actions in this project yet"',
);
assert(
  !fileContains('src/v3/shell/ExportModal.jsx', 'No animations in this project yet'),
  'G-8: ExportModal stale "No animations in this project yet" removed',
);

// G-9 — sceneAction orphan-id logger (functional)
{
  const proj = makeProjectWithSceneBound('action-missing');
  const captured = [];
  const origError = console.error;
  console.error = (...args) => { captured.push(args.join(' ')); };
  try {
    const result = getSceneAction(proj);
    assert(result === null, 'G-9: orphan scene actionId returns null');
  } finally {
    console.error = origError;
  }
  assert(
    captured.some((line) => line.includes('orphan __scene__.animData.actionId')),
    'G-9: orphan scene actionId triggers logger.error (no silent swallow)',
  );
}
assert(
  fileFlatMatches(
    'src/anim/sceneAction.js',
    /Audit-fix G-9 Stage 1\.E.*surface orphan scene-bindings instead of silently swallowing/,
  ),
  'G-9: sceneAction.getSceneAction orphan-detection JSDoc breadcrumb',
);

// D-9 — editorRegistry plural deviation JSDoc
assert(
  fileFlatMatches(
    'src/v3/shell/editorRegistry.js',
    /SPACE_ACTION[\s\S]*?DNA_space_enums\.h:1161[\s\S]*?Audit-fix D-9 Stage 1\.E/,
  ),
  'D-9: editorRegistry "actions" plural deviation documented vs Blender SPACE_ACTION',
);

// D-10 — AnimDataSection scope JSDoc (omitted fields are Blender-faithful)
assert(
  fileFlatMatches(
    'src/v3/editors/properties/sections/AnimDataSection.jsx',
    /Audit-fix D-10 Stage 1\.E.*draw_action_and_slot_selector_for_id.*anim\.py:8/,
  ),
  'D-10: AnimDataSection scope cited against draw_action_and_slot_selector_for_id',
);

// ── Functional integrations ─────────────────────────────────────────────────

// G-3 + Used-by + scene unbind cascade
{
  const proj = makeProjectWithSceneBound('action-1');
  const users = getActionUsers(proj, 'action-1');
  assert(users.length === 1 && users[0].id === '__scene__',
    'G-3 integration: scene-bound action shows up in getActionUsers');
}

// D-6 + cloneAction increments .NNN even when source already has a `.NNN`
{
  const proj = {
    schemaVersion: 37,
    actions: [
      { id: 'a1', name: 'Wave', fcurves: [], audioTracks: [], meta: { source: 'authored' } },
      { id: 'a2', name: 'Wave.005', fcurves: [], audioTracks: [], meta: { source: 'authored' } },
    ],
    nodes: [makeSceneNode()],
  };
  const cloneA = cloneAction(proj, 'a1');
  assert(cloneA?.name === 'Wave.006', 'D-6: nextDotNNN respects existing max .NNN sibling');
}

// D-8 + getActiveSceneAction does NOT crash on null/undefined project
assert(
  getActiveSceneAction(null, 'a1') === null,
  'D-8 defensive: getActiveSceneAction(null, ...) → null (no throw)',
);
assert(
  getActiveSceneAction(undefined, 'a1') === null,
  'D-8 defensive: getActiveSceneAction(undefined, ...) → null',
);

// ── Result ─────────────────────────────────────────────────────────────────

console.log(`\nPhase 1 Stage 1.E audit-fix tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failed assertions:');
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}
