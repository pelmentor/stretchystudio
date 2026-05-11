// Toolset Plan Phase 7.C.5 — Select Mirror + Mirror Pose.
//
// Verifies the mirror module:
//   - `mirrorRole` camelCase prefix flip (left*↔right*)
//   - `flipPoseX` X-axis pose mirror semantics
//   - `poseSelectMirror` extends bone selection to mirror partners
//   - `poseMirrorPaste` (via posePaste{flipped:true}) flips and applies
//   - eligibility gates
//
// Run: node scripts/test/test_poseMode_mirrorPose.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { usePoseClipboardStore } from '../../src/store/poseClipboardStore.js';
import { clearHistory } from '../../src/store/undoHistory.js';
import {
  mirrorRole,
  flipPoseX,
  poseSelectMirror,
  poseCopy,
  posePaste,
  poseMirrorPaste,
  eligibleForSelectMirror,
  eligibleForPaste,
  listMirrorablePairs,
} from '../../src/v3/operators/pose/mirror.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function nearlyEq(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

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
        { id: 'b3', type: 'group', boneRole: 'leftKnee', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 80, pivotY: 400 },
          pose: { rotation: 0.2, x: 4, y: 0, scaleX: 1, scaleY: 1 },
        },
        { id: 'b4', type: 'group', boneRole: 'rightKnee', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 220, pivotY: 400 },
          pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        { id: 'b5', type: 'group', boneRole: 'torso', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 150, pivotY: 100 },
          pose: { rotation: 0.1, x: 0, y: -2, scaleX: 1, scaleY: 1 },
        },
      ],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useEditorStore.setState({ editMode: 'pose', selection: [] });
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b1' }] });
}

function getBone(id) {
  return useProjectStore.getState().project.nodes.find((n) => n.id === id);
}

// ── 1. mirrorRole basic flips ──────────────────────────────────────
{
  assert(mirrorRole('leftElbow') === 'rightElbow', 'leftElbow → rightElbow');
  assert(mirrorRole('rightElbow') === 'leftElbow', 'rightElbow → leftElbow');
  assert(mirrorRole('leftArm') === 'rightArm', 'leftArm → rightArm');
  assert(mirrorRole('rightLeg') === 'leftLeg', 'rightLeg → leftLeg');
  assert(mirrorRole('leftKnee') === 'rightKnee', 'leftKnee → rightKnee');
}

// ── 2. mirrorRole rejects non-mirrorable roles ─────────────────────
{
  assert(mirrorRole('torso') === null, 'torso → null');
  assert(mirrorRole('head') === null, 'head → null');
  assert(mirrorRole('root') === null, 'root → null');
  assert(mirrorRole(null) === null, 'null → null');
  assert(mirrorRole('') === null, 'empty → null');
  assert(mirrorRole('left') === null, 'bare "left" (too short) → null');
  // Guards: lowercase first-rest-char (camelCase contract)
  assert(mirrorRole('leftover') === null, 'leftover (not camelCase) → null');
  assert(mirrorRole('rightful') === null, 'rightful (not camelCase) → null');
}

// ── 3. flipPoseX semantics ─────────────────────────────────────────
{
  const p = { rotation: 0.5, x: 30, y: -20, scaleX: 1.2, scaleY: 0.8 };
  const f = flipPoseX(p);
  assert(nearlyEq(f.rotation, -0.5), 'rotation flipped');
  assert(nearlyEq(f.x, -30), 'x flipped');
  assert(nearlyEq(f.y, -20), 'y unchanged');
  assert(nearlyEq(f.scaleX, 1.2), 'scaleX unchanged');
  assert(nearlyEq(f.scaleY, 0.8), 'scaleY unchanged');
  // Input not mutated
  assert(p.x === 30 && p.rotation === 0.5, 'input not mutated');
}

// ── 4. poseSelectMirror extends selection ──────────────────────────
{
  seed();
  // Start with b1 (leftElbow) selected
  const r = poseSelectMirror();
  assert(!r.skipped, 'not skipped');
  assert(r.added === 1, `1 added, got ${r.added}`);
  const items = useSelectionStore.getState().items;
  assert(items.length === 2, '2 items in selection');
  assert(items.some((it) => it.id === 'b2'), 'b2 (rightElbow) added');
}

// ── 5. poseSelectMirror skips already-selected partner ─────────────
{
  seed();
  useSelectionStore.setState({ items: [
    { type: 'group', id: 'b1' }, { type: 'group', id: 'b2' },
  ] });
  const r = poseSelectMirror();
  assert(r.added === 0, 'partner already selected → 0 added');
}

// ── 6. poseSelectMirror reports missing roles ──────────────────────
{
  seed();
  // torso has no mirror; selection = b5 (torso)
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b5' }] });
  const r = poseSelectMirror();
  assert(r.added === 0, 'no partner → 0 added');
  assert(r.missing.includes('torso'), 'torso reported as missing');
}

// ── 7. poseCopy + posePaste round-trip (no flip) ───────────────────
{
  seed();
  // Copy b1's pose
  const c = poseCopy();
  assert(c.copied === 1, '1 entry copied');
  const clip = usePoseClipboardStore.getState().entries;
  assert(clip.length === 1 && clip[0].role === 'leftElbow', 'leftElbow in clipboard');
  // Switch selection to b3 (leftKnee) — won't paste (different role)
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b3' }] });
  const r1 = posePaste();
  assert(r1.pasted === 0 && r1.unmatchedRoles.includes('leftKnee'),
    'no role match → unmatched reported');
  // Now select b1 again and paste — should restore its own pose
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b1' }] });
  // Mutate b1's pose to confirm paste actually writes
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.map((n) =>
        n.id === 'b1' ? { ...n, pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } } : n,
      ),
    },
  });
  const r2 = posePaste();
  assert(r2.pasted === 1, '1 pasted');
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.rotation, 0.5) && nearlyEq(b1.pose.x, 30),
    `b1 restored from clipboard, got rot=${b1.pose.rotation} x=${b1.pose.x}`);
}

// ── 8. poseMirrorPaste flips left→right ────────────────────────────
{
  seed();
  // Copy b1 (leftElbow with rot=0.5, x=30, y=-20)
  poseCopy();
  // Select b2 (rightElbow, currently identity)
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b2' }] });
  // mirrorPaste: source role = mirrorRole('rightElbow') = 'leftElbow' (in clipboard)
  // → flip → write to b2
  const r = poseMirrorPaste();
  assert(r.pasted === 1, `1 pasted, got ${r.pasted}`);
  const b2 = getBone('b2');
  assert(nearlyEq(b2.pose.rotation, -0.5),
    `b2 rotation = -0.5 (mirrored), got ${b2.pose.rotation}`);
  assert(nearlyEq(b2.pose.x, -30),
    `b2 x = -30 (mirrored), got ${b2.pose.x}`);
  assert(nearlyEq(b2.pose.y, -20),
    `b2 y = -20 (preserved), got ${b2.pose.y}`);
  assert(nearlyEq(b2.pose.scaleX, 1.2) && nearlyEq(b2.pose.scaleY, 0.8),
    'b2 scale preserved');
}

// ── 9. mirror-paste many: copy entire left side, paste onto right ──
{
  seed();
  // Mutate left bones to known poses, copy all, paste onto right
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.map((n) => {
        if (n.id === 'b1') return { ...n, pose: { rotation: 0.4, x: 10, y: 5, scaleX: 1, scaleY: 1 } };
        if (n.id === 'b3') return { ...n, pose: { rotation: 0.2, x: 4, y: 8, scaleX: 1, scaleY: 1 } };
        return n;
      }),
    },
  });
  useSelectionStore.setState({ items: [
    { type: 'group', id: 'b1' }, { type: 'group', id: 'b3' },
  ] });
  const c = poseCopy();
  assert(c.copied === 2, '2 entries copied');
  // Now select right side
  useSelectionStore.setState({ items: [
    { type: 'group', id: 'b2' }, { type: 'group', id: 'b4' },
  ] });
  const r = poseMirrorPaste();
  assert(r.pasted === 2, '2 pasted');
  const b2 = getBone('b2'); // should mirror b1 (rot=0.4 x=10 → -0.4, -10, 5)
  assert(nearlyEq(b2.pose.rotation, -0.4) && nearlyEq(b2.pose.x, -10) && nearlyEq(b2.pose.y, 5),
    `b2 mirrors b1: rot=${b2.pose.rotation} x=${b2.pose.x} y=${b2.pose.y}`);
  const b4 = getBone('b4'); // should mirror b3 (rot=0.2 x=4 → -0.2, -4, 8)
  assert(nearlyEq(b4.pose.rotation, -0.2) && nearlyEq(b4.pose.x, -4) && nearlyEq(b4.pose.y, 8),
    `b4 mirrors b3: rot=${b4.pose.rotation} x=${b4.pose.x} y=${b4.pose.y}`);
}

// ── 10. eligibility gates ──────────────────────────────────────────
{
  seed();
  assert(eligibleForSelectMirror() === true, 'b1 selected → mirror eligible');
  // Select non-mirrorable role
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b5' }] });
  assert(eligibleForSelectMirror() === false, 'torso → not mirror-eligible');
  // No selection
  useSelectionStore.setState({ items: [] });
  assert(eligibleForSelectMirror() === false, 'empty → not eligible');
  // Empty clipboard → paste ineligible
  usePoseClipboardStore.getState().clear();
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b1' }] });
  assert(eligibleForPaste() === false, 'empty clipboard → not eligible');
  // After copy → eligible
  poseCopy();
  assert(eligibleForPaste() === true, 'after copy → paste eligible');
  assert(eligibleForPaste({ flipped: true }) === true,
    'leftElbow selection + clipboard → mirror-paste eligible');
  // Mirror-paste needs mirrorable selection
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b5' }] });
  assert(eligibleForPaste({ flipped: true }) === false,
    'torso selection → mirror-paste NOT eligible');
}

// ── 11. listMirrorablePairs enumerates rig ─────────────────────────
{
  seed();
  const pairs = listMirrorablePairs();
  // b1, b2, b3, b4 are all mirrorable; b5 (torso) is not.
  assert(pairs.length === 4, `4 mirrorable bones, got ${pairs.length}`);
  const roles = pairs.map((p) => p.role).sort();
  assert(JSON.stringify(roles) === JSON.stringify(['leftElbow','leftKnee','rightElbow','rightKnee']),
    `roles match, got ${JSON.stringify(roles)}`);
}

// ── 12. mirrorPaste falls back to non-flipped role when no mirror ─
{
  seed();
  // Copy torso pose (b5, rot=0.1)
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b5' }] });
  poseCopy();
  // Try to mirrorPaste onto b5 (torso has no mirror role)
  // Per the operator's "for flipped paste, source = mirror(target) ?? target"
  // logic, it falls back to the same role. Then flipPoseX still applies.
  const r = poseMirrorPaste();
  assert(r.pasted === 1, '1 pasted (falls back to same-role read)');
  const b5 = getBone('b5');
  // Original was rot=0.1, x=0, y=-2 → flipped: rot=-0.1, x=0, y=-2
  assert(nearlyEq(b5.pose.rotation, -0.1),
    `b5 rotation flipped, got ${b5.pose.rotation}`);
  assert(nearlyEq(b5.pose.x, 0), 'b5 x flipped (was 0, stays 0)');
  assert(nearlyEq(b5.pose.y, -2), 'b5 y preserved');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
