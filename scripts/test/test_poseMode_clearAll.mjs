// Toolset Plan Phase 7.C.4 — Clear All Pose (Alt+Shift+G/R/S).
//
// Verifies `clearAllPose(channel)`:
//   - walks every bone in project regardless of selection
//   - per-channel mode (location/rotation/scale) clears only that axis
//   - skipped when project has no bones
//   - non-bone groups untouched
//
// Run: node scripts/test/test_poseMode_clearAll.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { clearHistory, undoCount } from '../../src/store/undoHistory.js';
import {
  clearAllPose,
  hasAnyBones,
  allBoneIds,
} from '../../src/v3/operators/pose/clearTransform.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function nearlyEq(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

function seed() {
  clearHistory();
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
          pose: { rotation: -0.7, x: -10, y: 5, scaleX: 0.5, scaleY: 1.5 },
        },
        { id: 'b3', type: 'group', boneRole: 'torso', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 150, pivotY: 100 },
          pose: { rotation: 1, x: 5, y: 5, scaleX: 1, scaleY: 1 },
        },
        // Non-bone group: should be untouched by clearAllPose
        { id: 'g1', type: 'group', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
          pose: { rotation: 99, x: 99, y: 99, scaleX: 9, scaleY: 9 },
        },
      ],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useEditorStore.setState({ editMode: 'pose', selection: [] });
  // Selection deliberately set to single bone — clearAll should ignore it
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b1' }] });
}

function getNode(id) {
  return useProjectStore.getState().project.nodes.find((n) => n.id === id);
}

// ── 1. clearAllPose('location') zeros x/y on every bone ───────────
{
  seed();
  const r = clearAllPose('location');
  assert(!r.skipped, 'not skipped');
  assert(r.cleared === 3, `3 bones cleared (b1+b2+b3), got ${r.cleared}`);
  for (const id of ['b1', 'b2', 'b3']) {
    const n = getNode(id);
    assert(nearlyEq(n.pose.x, 0) && nearlyEq(n.pose.y, 0),
      `${id} loc cleared, got x=${n.pose.x} y=${n.pose.y}`);
  }
  // rotations preserved
  assert(nearlyEq(getNode('b1').pose.rotation, 0.5), 'b1 rot preserved');
  assert(nearlyEq(getNode('b3').pose.rotation, 1), 'b3 rot preserved');
}

// ── 2. clearAllPose('rotation') zeros rotation on every bone ──────
{
  seed();
  clearAllPose('rotation');
  for (const id of ['b1', 'b2', 'b3']) {
    const n = getNode(id);
    assert(nearlyEq(n.pose.rotation, 0), `${id} rot cleared, got ${n.pose.rotation}`);
  }
  // x/y preserved
  assert(nearlyEq(getNode('b1').pose.x, 30), 'b1 x preserved');
  assert(nearlyEq(getNode('b2').pose.y, 5), 'b2 y preserved');
}

// ── 3. clearAllPose('scale') resets scale on every bone ───────────
{
  seed();
  clearAllPose('scale');
  for (const id of ['b1', 'b2', 'b3']) {
    const n = getNode(id);
    assert(nearlyEq(n.pose.scaleX, 1) && nearlyEq(n.pose.scaleY, 1),
      `${id} scale → 1`);
  }
  // rotation/loc preserved
  assert(nearlyEq(getNode('b2').pose.rotation, -0.7), 'b2 rot preserved');
}

// ── 4. non-bone group `g1` untouched ──────────────────────────────
{
  seed();
  clearAllPose('location');
  const g = getNode('g1');
  assert(nearlyEq(g.pose.x, 99) && nearlyEq(g.pose.y, 99),
    `g1 untouched, got x=${g.pose.x} y=${g.pose.y}`);
}

// ── 5. selection ignored — operates on all even when empty ────────
{
  seed();
  useSelectionStore.setState({ items: [] });
  const r = clearAllPose('location');
  assert(r.cleared === 3, '3 bones cleared even with no selection');
}

// ── 6. project with no bones → skipped ────────────────────────────
{
  seed();
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.filter((n) => !n.boneRole),
    },
  });
  const r = clearAllPose('location');
  assert(r.skipped === true && r.cleared === 0, 'no bones → skipped');
  assert(hasAnyBones() === false, 'hasAnyBones false');
  assert(allBoneIds().length === 0, 'allBoneIds empty');
}

// ── 7. unknown channel is a no-op write (defensive) ──────────────
{
  seed();
  // @ts-ignore — testing defensive branch
  const r = clearAllPose('garbage');
  // The operator still walks bones (cleared=3) but applyClear's switch
  // has no case for 'garbage' → no field mutated. Verify pose preserved.
  assert(r.cleared === 3, 'walked bones');
  const b1 = getNode('b1');
  assert(nearlyEq(b1.pose.x, 30) && nearlyEq(b1.pose.rotation, 0.5),
    'unknown channel → no mutation');
}

// ── 8. single undo entry per call ─────────────────────────────────
{
  seed();
  const before = undoCount();
  clearAllPose('location');
  const after = undoCount();
  assert(after - before === 1, `1 undo entry, got ${after - before}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
