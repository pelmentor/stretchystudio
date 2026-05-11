// Tests for Animation Phase 1 Stage 1.E — ActionsEditor rename +
// 11-file `activeActionId` consumer rewire + Properties AnimData
// section + scene-action header in ActionsEditor.
//
// Coverage:
//   1. ActionsEditor.jsx exists at the new path; AnimationsEditor.jsx
//      gone.
//   2. EditorRegistry uses `actions` editor type with ActionsEditor
//      component; `animations` removed from EditorType enum.
//   3. Each of the 11 consumer files imports getActiveSceneAction (or
//      getSceneAction for the timeline picker) AND the legacy
//      `actions.find(a => a.id === activeActionId)` pattern is gone
//      (transformed to scene-aware lookups).
//   4. Properties panel AnimData section is registered + bound to the
//      Item tab.
//   5. ActionsEditor exposes scene-action header + duplicate command +
//      Used-by strip via expected APIs (cloneAction / assignAction /
//      unassignAction / getActionUsers / getSceneAction).
//
// Run: node scripts/test/test_stage1e_actions_editor.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Read a file under repo root. */
function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Quick test that two patterns appear together in a file. */
function fileContains(rel, pattern) {
  if (!existsSync(join(ROOT, rel))) return false;
  return read(rel).includes(pattern);
}

/** Regex test against file contents. */
function fileMatches(rel, regex) {
  if (!existsSync(join(ROOT, rel))) return false;
  return regex.test(read(rel));
}

// ── 1. File rename ─────────────────────────────────────────────────────────

assert(
  existsSync(join(ROOT, 'src/v3/editors/actions/ActionsEditor.jsx')),
  'rename: ActionsEditor.jsx exists at new path',
);
assert(
  !existsSync(join(ROOT, 'src/v3/editors/animations/AnimationsEditor.jsx')),
  'rename: legacy AnimationsEditor.jsx is gone',
);
assert(
  !existsSync(join(ROOT, 'src/v3/editors/animations/IdleMotionDialog.jsx')),
  'rename: legacy IdleMotionDialog moved out of animations/ directory',
);
assert(
  existsSync(join(ROOT, 'src/v3/editors/actions/IdleMotionDialog.jsx')),
  'rename: IdleMotionDialog moved into actions/ directory',
);
assert(
  fileContains('src/v3/editors/actions/ActionsEditor.jsx', 'export function ActionsEditor()'),
  'rename: function exported as ActionsEditor (not AnimationsEditor)',
);

// ── 2. EditorRegistry + EditorType ─────────────────────────────────────────

assert(
  fileContains('src/v3/shell/editorRegistry.js', "import('../editors/actions/ActionsEditor.jsx')"),
  'editorRegistry: lazy-imports the new ActionsEditor path',
);
assert(
  fileContains('src/v3/shell/editorRegistry.js', "actions:"),
  'editorRegistry: registry key renamed to "actions"',
);
assert(
  !fileContains('src/v3/shell/editorRegistry.js', "animations:  { label: 'Animations'"),
  'editorRegistry: legacy "animations" entry removed',
);
assert(
  fileContains('src/store/uiV3Store.js', "'actions'"),
  'uiV3Store: EditorType enum + workspace area uses "actions"',
);
assert(
  !fileContains('src/store/uiV3Store.js', "'animations'"),
  'uiV3Store: "animations" editor type removed',
);

// ── 3. Consumer rewire — each file imports getActiveSceneAction ────────────
//      and no longer reads `proj.actions.find(a => a.id === activeActionId)`
//      directly (it goes through getActiveSceneAction).

const CONSUMER_FILES = [
  'src/components/canvas/SkeletonOverlay.jsx',
  'src/components/canvas/GizmoOverlay.jsx',
  'src/components/canvas/CanvasViewport.jsx',
  'src/v3/editors/parameters/ParamRow.jsx',
  'src/v3/editors/fcurve/FCurveEditor.jsx',
  'src/v3/editors/dopesheet/DopesheetEditor.jsx',
  'src/v3/editors/nodetree/NodeTreeArea.jsx',
  'src/v3/editors/timeline/TimelineEditor.jsx',
  'src/v3/shell/ExportModal.jsx',
];

for (const rel of CONSUMER_FILES) {
  assert(
    fileMatches(rel, /from ['"][^'"]*sceneAction(?:\.js)?['"]/),
    `rewire: ${rel} imports from sceneAction.js`,
  );
  assert(
    fileContains(rel, 'getActiveSceneAction'),
    `rewire: ${rel} calls getActiveSceneAction`,
  );
}

// Specifically — the legacy direct `find` over actions paired with raw
// `activeActionId` should be gone from each consumer.
for (const rel of CONSUMER_FILES) {
  assert(
    !fileMatches(rel, /\.actions\.find\(\s*[a-z]+\s*=>\s*[a-z]+\.id\s*===\s*[a-z]+\.activeActionId\s*\)/),
    `rewire: ${rel} no longer does .actions.find(a => a.id === anim.activeActionId)`,
  );
}

// ── 4. Properties AnimData section ─────────────────────────────────────────

assert(
  existsSync(join(ROOT, 'src/v3/editors/properties/sections/AnimDataSection.jsx')),
  'properties: AnimDataSection.jsx file exists',
);
assert(
  fileContains('src/v3/editors/properties/sections/AnimDataSection.jsx', 'export function AnimDataSection'),
  'properties: AnimDataSection exports function',
);
assert(
  fileContains('src/v3/editors/properties/sections/AnimDataSection.jsx', 'assignAction'),
  'properties: AnimDataSection wires assignAction',
);
assert(
  fileContains('src/v3/editors/properties/sections/AnimDataSection.jsx', 'unassignAction'),
  'properties: AnimDataSection wires unassignAction',
);
assert(
  fileContains('src/v3/editors/properties/sectionRegistry.jsx', "id: 'animData'"),
  'properties: sectionRegistry registers animData section',
);
assert(
  fileContains('src/v3/editors/properties/propertiesTabRegistry.jsx', "'animData'"),
  'properties: animData section bound into Item tab',
);
// Visibility predicate matches Object types only (parts + groups).
assert(
  fileMatches(
    'src/v3/editors/properties/sectionRegistry.jsx',
    /id:\s*'animData'[\s\S]{0,200}active\.type === 'part' \|\| active\.type === 'group'/,
  ),
  'properties: AnimDataSection visible for parts + groups (not deformers/parameters/scene)',
);

// ── 5. ActionsEditor functionality — scene header, duplicate, used-by ──────

const EDITOR_SRC = read('src/v3/editors/actions/ActionsEditor.jsx');

assert(
  EDITOR_SRC.includes("import { getActionUsers } from '../../../anim/actionRegistry.js';"),
  'ActionsEditor: imports getActionUsers for Used-by strip',
);
assert(
  EDITOR_SRC.includes("getSceneAction, getSceneNode") || EDITOR_SRC.includes("getSceneAction") && EDITOR_SRC.includes("getSceneNode"),
  'ActionsEditor: imports getSceneAction + getSceneNode for scene header',
);
assert(
  EDITOR_SRC.includes('cloneAction'),
  'ActionsEditor: wires cloneAction thunk for Duplicate command',
);
assert(
  EDITOR_SRC.includes("assignAction('__scene__'"),
  'ActionsEditor: scene-bind affordance calls assignAction for __scene__',
);
assert(
  EDITOR_SRC.includes("unassignAction('__scene__'"),
  'ActionsEditor: scene-unbind affordance calls unassignAction for __scene__',
);
assert(
  EDITOR_SRC.includes("Used by:"),
  'ActionsEditor: per-action Used-by strip text present',
);
assert(
  /labels\.unshift\(['"]Scene['"]\)/.test(EDITOR_SRC),
  'ActionsEditor: formatUsedBy renders __scene__ as "Scene" and pulls it first (Audit-fix D-13)',
);

// Header label flipped Animations → Actions.
assert(
  EDITOR_SRC.includes('Actions ('),
  'ActionsEditor: header label says "Actions (N)"',
);
assert(
  !EDITOR_SRC.includes('Animations ('),
  'ActionsEditor: legacy "Animations (N)" header gone',
);

// ── 6. Timeline picker rebinds scene when scene is bound ───────────────────

const TIMELINE_SRC = read('src/v3/editors/timeline/TimelineEditor.jsx');
assert(
  TIMELINE_SRC.includes("if (getSceneAction(proj))"),
  'TimelineEditor: picker checks scene binding before re-binding',
);
assert(
  TIMELINE_SRC.includes("assignAction('__scene__'"),
  'TimelineEditor: picker re-binds __scene__ when scene already bound',
);
assert(
  TIMELINE_SRC.includes('value={animation?.id'),
  'TimelineEditor: picker value reflects resolved scene-aware action id',
);

// ── 7. Result ──────────────────────────────────────────────────────────────

console.log(`\nPhase 1 Stage 1.E tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failed assertions:');
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}
