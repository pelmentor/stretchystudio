// Toolset Plan Phase 7.C.3 — Clear Pose Scale (Alt+S).
//
// Verifies `clearPoseScale`:
//   - resets pose.scaleX + pose.scaleY to 1
//   - leaves x/y/rotation untouched
//   - bone missing pose slot gets identity then cleared
//
// Run: node scripts/test/test_poseMode_clearScale.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { clearHistory } from '../../src/store/undoHistory.js';
import { clearPoseScale } from '../../src/v3/operators/pose/clearTransform.js';

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
          pose: { rotation: 0.5, x: 30, y: -20, scaleX: 1.5, scaleY: 0.5 },
        },
        { id: 'b2', type: 'group', boneRole: 'rightElbow', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 200, pivotY: 200 },
          pose: { rotation: 0, x: 0, y: 0, scaleX: 2, scaleY: 2 },
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

// ── 1. clears scale only ───────────────────────────────────────────
{
  seed();
  const r = clearPoseScale();
  assert(!r.skipped && r.cleared === 2, '2 cleared');
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.scaleX, 1) && nearlyEq(b1.pose.scaleY, 1),
    `b1 scale → 1, got ${b1.pose.scaleX}/${b1.pose.scaleY}`);
  assert(nearlyEq(b1.pose.rotation, 0.5), 'b1 rotation preserved');
  assert(nearlyEq(b1.pose.x, 30) && nearlyEq(b1.pose.y, -20),
    'b1 loc preserved');
  const b2 = getBone('b2');
  assert(nearlyEq(b2.pose.scaleX, 1) && nearlyEq(b2.pose.scaleY, 1),
    'b2 scale → 1');
}

// ── 2. negative scale → 1 (mirror semantic via scale-flip is not pose-clear) ──
{
  seed();
  // Mutate b1 scale negative (a flipped bone) — clear should normalize to 1
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.map((n) =>
        n.id === 'b1' ? { ...n, pose: { ...n.pose, scaleX: -1.2 } } : n,
      ),
    },
  });
  clearPoseScale();
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.scaleX, 1), `b1 (-1.2) → 1, got ${b1.pose.scaleX}`);
}

// ── 3. very small scale → 1 ────────────────────────────────────────
{
  seed();
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.map((n) =>
        n.id === 'b1' ? { ...n, pose: { ...n.pose, scaleX: 0.01, scaleY: 100 } } : n,
      ),
    },
  });
  clearPoseScale();
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.scaleX, 1) && nearlyEq(b1.pose.scaleY, 1),
    'extreme scales → identity');
}

// ── 4. missing pose slot → identity then clear ─────────────────────
{
  seed();
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.map((n) =>
        n.id === 'b2' ? { ...n, pose: undefined } : n,
      ),
    },
  });
  clearPoseScale();
  const b2 = getBone('b2');
  assert(b2.pose && nearlyEq(b2.pose.scaleX, 1) && nearlyEq(b2.pose.scaleY, 1),
    'missing pose → identity scale');
  assert(nearlyEq(b2.pose.rotation, 0), 'identity rotation preserved');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
