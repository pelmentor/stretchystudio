// Phase 7.C audit-fix sweep — pin every FIX in place against regression.
//
// Sister to scripts/test/test_audit_fixes_2026_05_11_phase7b.mjs (and
// the Phase 7.A audit-pin test before that). One block per gap, tagged
// G-N or D-N, asserts the fixed behavior or the fixed cite.
//
// Run: node scripts/test/test_audit_fixes_2026_05_11_phase7c.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { usePoseClipboardStore } from '../../src/store/poseClipboardStore.js';
import { clearHistory } from '../../src/store/undoHistory.js';
import { DEFAULT_KEYMAP, chordOf } from '../../src/v3/keymap/default.js';
import {
  poseCopy, poseSelectMirror, mirrorRole,
} from '../../src/v3/operators/pose/mirror.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}

function seed() {
  clearHistory();
  usePoseClipboardStore.getState().clear();
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 34,
      canvas: { width: 800, height: 600 },
      textures: [], animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
      nodes: [
        { id: 'b1', type: 'group', boneRole: 'leftElbow', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 200 },
          pose: { rotation: 0.5, x: 30, y: -20, scaleX: 1.2, scaleY: 0.8 },
        },
        { id: 'b2', type: 'group', boneRole: 'rightElbow', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 200, pivotY: 200 },
          pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        { id: 'b3', type: 'group', boneRole: 'torso', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 150, pivotY: 100 },
          pose: { rotation: 0.1, x: 0, y: -2, scaleX: 1, scaleY: 1 },
        },
      ],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useEditorStore.setState({ editMode: 'pose', selection: [] });
  useSelectionStore.setState({ items: [] });
}

// ── G-1 / D-1: chord modifier order — Shift+Alt+ not Alt+Shift+ ───
{
  // chordOf is the canonical builder: it appends modifiers in order
  // Ctrl+Shift+Alt+Meta+. The keymap key MUST match what chordOf
  // produces; the pre-fix entries `Alt+Shift+KeyG/R/S` would never
  // match because chordOf produces `Shift+Alt+KeyG`.
  const fakeEvent = (mods) => chordOf({
    ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift,
    altKey:  !!mods.alt,  metaKey:  !!mods.meta,
    code: mods.code,
  });
  // What does chordOf actually produce for Alt+Shift+G?
  const chord = fakeEvent({ shift: true, alt: true, code: 'KeyG' });
  assert(chord === 'Shift+Alt+KeyG',
    `G-1: chordOf builds Shift+Alt+KeyG canonical, got '${chord}'`);
  // The canonical entry must exist in the keymap and resolve to clearAllLocation.
  assert(DEFAULT_KEYMAP['Shift+Alt+KeyG'] === 'pose.clearAllLocation',
    'G-1: Shift+Alt+KeyG → pose.clearAllLocation');
  assert(DEFAULT_KEYMAP['Shift+Alt+KeyR'] === 'pose.clearAllRotation',
    'G-1: Shift+Alt+KeyR → pose.clearAllRotation');
  assert(DEFAULT_KEYMAP['Shift+Alt+KeyS'] === 'pose.clearAllScale',
    'G-1: Shift+Alt+KeyS → pose.clearAllScale');
  // The pre-fix wrong-order entries must NOT exist (Rule №2 — no
  // legacy aliases for renamed identifiers).
  assert(DEFAULT_KEYMAP['Alt+Shift+KeyG'] === undefined,
    'G-1: pre-fix Alt+Shift+KeyG dropped (no legacy alias)');
  assert(DEFAULT_KEYMAP['Alt+Shift+KeyR'] === undefined,
    'G-1: pre-fix Alt+Shift+KeyR dropped');
  assert(DEFAULT_KEYMAP['Alt+Shift+KeyS'] === undefined,
    'G-1: pre-fix Alt+Shift+KeyS dropped');
}

// ── G-3: poseCopy on empty selection preserves clipboard ──────────
{
  seed();
  // Stage a clipboard manually (simulating a prior copy).
  usePoseClipboardStore.getState().setEntries([
    { role: 'leftElbow', pose: { rotation: 0.5, x: 30, y: -20, scaleX: 1.2, scaleY: 0.8 } },
  ]);
  const before = usePoseClipboardStore.getState().entries.length;
  // Empty selection.
  useSelectionStore.setState({ items: [] });
  const r = poseCopy();
  assert(r.copied === 0, 'G-3: copied = 0 on empty selection');
  const after = usePoseClipboardStore.getState().entries.length;
  assert(after === before,
    `G-3: clipboard PRESERVED on empty selection (was ${before}, now ${after})`);
  // Pre-fix this would have called .clear() and after === 0.
}

// ── G-5: poseSelectMirror reports missing roles even on partial success ──
{
  seed();
  // Mixed selection: leftElbow (has rightElbow partner) + torso (no mirror).
  useSelectionStore.setState({ items: [
    { type: 'group', id: 'b1' },  // leftElbow
    { type: 'group', id: 'b3' },  // torso
  ] });
  const r = poseSelectMirror();
  assert(r.added === 1, `G-5: 1 partner added (rightElbow), got ${r.added}`);
  assert(r.missing.length === 1 && r.missing[0] === 'torso',
    `G-5: torso reported as missing even on partial success, got ${JSON.stringify(r.missing)}`);
  // The registry callback's toast logic also branches on r.missing.length > 0
  // regardless of r.added — verify the return shape supports that branch.
  assert(r.missing.length > 0 && r.added > 0,
    'G-5: partial-success state (added > 0 AND missing > 0) reachable');
}

// ── D-2: clearAllPose docstring no longer cites POSE_OT_clear_user_transform ──
{
  // The fix replaces the wrong operator name with the correct
  // analogues. Verify the source no longer carries the bad cite.
  const src = readFileSync(join(repoRoot, 'src/v3/operators/pose/clearTransform.js'), 'utf8');
  assert(!src.includes('POSE_OT_clear_user_transform'),
    'D-2: bogus operator name removed from clearTransform.js');
  assert(src.includes('POSE_OT_user_transforms_clear'),
    'D-2: real operator name (POSE_OT_user_transforms_clear) cited');
  assert(src.includes('POSE_OT_transforms_clear'),
    'D-2: closest analogue (POSE_OT_transforms_clear) cited');
  assert(src.includes('SS-specific extension'),
    'D-2: SS-specific extension explicitly documented');
}

// ── D-3: clearTransform.js cites updated to actual registration lines ──
{
  const src = readFileSync(join(repoRoot, 'src/v3/operators/pose/clearTransform.js'), 'utf8');
  // Real registrations: loc=:1404, rot=:1377, scale=:1350.
  assert(src.includes(':1404'), 'D-3: POSE_OT_loc_clear at :1404 cited');
  assert(src.includes(':1377'), 'D-3: POSE_OT_rot_clear at :1377 cited');
  assert(src.includes(':1350'), 'D-3: POSE_OT_scale_clear at :1350 cited');
  // Generic dispatcher cite.
  assert(src.includes(':1262'),
    'D-3: pose_clear_transform_generic_exec at :1262 cited');
  // Pre-fix wrong cites should be gone (the inside-pchan_clear_rot ones).
  assert(!src.match(/pose_transform\.cc:1129/),
    'D-3: pre-fix :1129 cite gone (was inside pchan_clear_rot)');
}

// ── D-4: mirror.js POSE_OT_select_mirror cite updated ─────────────
{
  const src = readFileSync(join(repoRoot, 'src/v3/operators/pose/mirror.js'), 'utf8');
  // Real locations: exec=:1392, registration=:1470.
  assert(src.includes(':1470'), 'D-4: POSE_OT_select_mirror registration at :1470');
  assert(src.includes(':1392'), 'D-4: pose_select_mirror_exec at :1392');
  // Pre-fix wrong cites (pose_select_same_collection range) should be gone.
  assert(!src.includes('pose_select.cc:1080-1132'),
    'D-4: pre-fix wrong range :1080-1132 removed');
}

// ── D-5: mirror.js no longer cites non-existent flip_pose_data ────
{
  const src = readFileSync(join(repoRoot, 'src/v3/operators/pose/mirror.js'), 'utf8');
  assert(!src.includes('flip_pose_data'),
    'D-5: bogus flip_pose_data function name removed');
  // Real source location: pose_bone_do_paste at :625-777, flip block :720-750.
  assert(src.includes('pose_bone_do_paste'),
    'D-5: real function (pose_bone_do_paste) cited');
  assert(src.includes(':720-750'),
    'D-5: flip block at :720-750 cited');
}

// ── D-6: mirror.js POSE_OT_paste cites updated ─────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/v3/operators/pose/mirror.js'), 'utf8');
  // Real: registration=:1015, exec=:861, flipped=:1032.
  assert(src.includes(':1015'), 'D-6: POSE_OT_paste registration at :1015');
  assert(src.includes(':861'), 'D-6: pose_paste_exec at :861');
  assert(src.includes(':1032'), 'D-6: flipped RNA at :1032');
  // Pre-fix wrong cites should be gone.
  assert(!src.match(/pose_transform\.cc:805-859/),
    'D-6: pre-fix :805-859 cite gone (was inside copy_exec)');
  assert(!src.match(/at `:899`/),
    'D-6: pre-fix :899 cite gone');
}

// ── D-7: poseClipboardStore cite updated ──────────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/store/poseClipboardStore.js'), 'utf8');
  assert(!src.includes('view3d_buttons.cc'),
    'D-7: bogus view3d_buttons.cc cite removed');
  assert(src.includes('pose_copy_exec'),
    'D-7: real function (pose_copy_exec) cited');
  assert(src.includes('pose_copybuffer_filepath_get'),
    'D-7: real mechanism (.blend file via pose_copybuffer_filepath_get) cited');
  assert(src.includes(':785'),
    'D-7: pose_copy_exec at :785 cited');
}

// ── D-9: mirror.js BLI_string_flip_side_name cite updated ─────────
{
  const src = readFileSync(join(repoRoot, 'src/v3/operators/pose/mirror.js'), 'utf8');
  // Function actually starts at :297 (line 243 was is_char_sep helper).
  assert(src.includes('string_utils.cc:297'),
    'D-9: BLI_string_flip_side_name cite updated to :297');
  // The phrase referencing the pre-fix issue should be present (audit-fix breadcrumb).
  assert(!src.includes('string_utils.cc:243'),
    'D-9: pre-fix :243 cite removed');
}

// ── D-8 + G-2 + G-4: deviations documented in source ──────────────
{
  const mirrorSrc = readFileSync(join(repoRoot, 'src/v3/operators/pose/mirror.js'), 'utf8');
  assert(mirrorSrc.includes('Audit-fix D-8'),
    'D-8: additive-vs-swap deviation documented in mirror.js');
  assert(mirrorSrc.includes("'add'") || mirrorSrc.includes('extend=true'),
    'D-8: additive behavior labeled');

  const clearSrc = readFileSync(join(repoRoot, 'src/v3/operators/pose/clearTransform.js'), 'utf8');
  // G-2 was originally documented as DEVIATION here pending the
  // Pose Read/Write Canonicalisation Plan. That plan shipped (helpers
  // + writer/reader routing in objectDataAccess.js); the docstring now
  // explains pose-shape ROUTING through `setBonePose`/`setBonePoseField`.
  assert(clearSrc.includes('setBonePose') || clearSrc.includes('setBonePoseField'),
    'G-2: clearTransform routes through canonical pose-write helper');
  assert(clearSrc.includes('audit-fix G-2'),
    'G-2: closure breadcrumb to original gap retained');
}

// ── Sister-suite invariants still hold (sanity) ────────────────────
{
  // mirrorRole still respects the 5+ char minimum AND the camelCase
  // contract — verify after audit-fix doc edits didn't accidentally
  // mutate behavior.
  assert(mirrorRole('leftElbow') === 'rightElbow', 'sanity: mirrorRole still flips');
  assert(mirrorRole('left') === null, 'sanity: 4-char rejected');
  assert(mirrorRole('leftover') === null, 'sanity: non-camelCase rejected');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
