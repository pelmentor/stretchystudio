// Toolset Plan Phase 7.C.2 — Clear Pose Rotation (Alt+R).
//
// Verifies `clearPoseRotation`:
//   - zeros pose.rotation only
//   - leaves x/y/scaleX/scaleY untouched
//   - skipped on no selection
//
// Run: node scripts/test/test_poseMode_clearRot.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { clearHistory } from '../../src/store/undoHistory.js';
import { clearPoseRotation } from '../../src/v3/operators/pose/clearTransform.js';

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
          pose: { rotation: -0.7, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
      ],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useEditorStore.setState({ editMode: 'pose', selection: [] });
  useSelectionStore.setState({ items: [
    { type: 'group', id: 'b1' }, { type: 'group', id: 'b2' },
  ] });
}

function getBone(id) {
  return useProjectStore.getState().project.nodes.find((n) => n.id === id);
}

// ── 1. clears rotation only ────────────────────────────────────────
{
  seed();
  const r = clearPoseRotation();
  assert(!r.skipped && r.cleared === 2, '2 cleared');
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.rotation, 0), `b1 rot cleared, got ${b1.pose.rotation}`);
  assert(nearlyEq(b1.pose.x, 30) && nearlyEq(b1.pose.y, -20),
    `b1 loc preserved, got x=${b1.pose.x} y=${b1.pose.y}`);
  assert(nearlyEq(b1.pose.scaleX, 1.2) && nearlyEq(b1.pose.scaleY, 0.8),
    'b1 scale preserved');
  const b2 = getBone('b2');
  assert(nearlyEq(b2.pose.rotation, 0), 'b2 rot cleared');
}

// ── 2. nothing selected → skipped ──────────────────────────────────
{
  seed();
  useSelectionStore.setState({ items: [] });
  const r = clearPoseRotation();
  assert(r.skipped === true && r.cleared === 0, 'skipped on no selection');
}

// ── 3. idempotent: clearing already-zero rotation is a no-op ──────
{
  seed();
  clearPoseRotation();
  const before = useProjectStore.getState().hasUnsavedChanges;
  clearPoseRotation();
  // hasUnsavedChanges may stay true (we still ran the operator); the
  // important part is no crash and rotation stays at 0.
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.rotation, 0), 'b1 rot still 0 after second clear');
}

// ── 4. negative rotation handled ───────────────────────────────────
{
  seed();
  // b2 already has -0.7; verify clear handles negative correctly
  clearPoseRotation();
  const b2 = getBone('b2');
  assert(nearlyEq(b2.pose.rotation, 0), `b2 (-0.7) → 0, got ${b2.pose.rotation}`);
}

// ── 5. bone with no `pose` slot creates identity then clears rot ──
{
  seed();
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.map((n) =>
        n.id === 'b1' ? { ...n, pose: undefined } : n,
      ),
    },
  });
  clearPoseRotation();
  const b1 = getBone('b1');
  assert(b1.pose && nearlyEq(b1.pose.rotation, 0), 'missing pose → identity then rot cleared');
  assert(nearlyEq(b1.pose.x, 0) && nearlyEq(b1.pose.y, 0),
    'identity loc preserved (zero is identity for x/y)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
