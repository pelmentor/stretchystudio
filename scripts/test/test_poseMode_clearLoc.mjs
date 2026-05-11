// Toolset Plan Phase 7.C.1 — Clear Pose Location (Alt+G).
//
// Verifies `clearPoseLocation`:
//   - zeros pose.x + pose.y on every selected bone
//   - leaves pose.rotation + scaleX + scaleY untouched
//   - operates on selected bones only (non-selected bones unchanged)
//   - skipped when nothing selected
//   - bones missing `pose` slot get one created at identity
//   - single undo entry (one snapshot)
//
// Run: node scripts/test/test_poseMode_clearLoc.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { clearHistory, undoCount, undo } from '../../src/store/undoHistory.js';
import {
  clearPoseLocation,
  hasSelectedBones,
  eligibleBones,
  IDENTITY_POSE,
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
          pose: { rotation: -0.5, x: -30, y: 20, scaleX: 0.8, scaleY: 1.2 },
        },
        { id: 'b3', type: 'group', boneRole: 'torso', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 150, pivotY: 100 },
          pose: { rotation: 1, x: 5, y: 5, scaleX: 1, scaleY: 1 },
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

// ── 1. clears x/y on selected, leaves r/sx/sy ──────────────────────
{
  seed();
  const r = clearPoseLocation();
  assert(!r.skipped, 'not skipped');
  assert(r.cleared === 2, `2 cleared, got ${r.cleared}`);
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.x, 0) && nearlyEq(b1.pose.y, 0),
    `b1 loc cleared, got x=${b1.pose.x} y=${b1.pose.y}`);
  assert(nearlyEq(b1.pose.rotation, 0.5),
    `b1 rotation preserved, got ${b1.pose.rotation}`);
  assert(nearlyEq(b1.pose.scaleX, 1.2) && nearlyEq(b1.pose.scaleY, 0.8),
    'b1 scale preserved');
  const b2 = getBone('b2');
  assert(nearlyEq(b2.pose.x, 0) && nearlyEq(b2.pose.y, 0), 'b2 loc cleared');
  assert(nearlyEq(b2.pose.rotation, -0.5), 'b2 rotation preserved');
}

// ── 2. unselected bone unchanged ───────────────────────────────────
{
  seed();
  clearPoseLocation();
  const b3 = getBone('b3');
  assert(nearlyEq(b3.pose.x, 5) && nearlyEq(b3.pose.y, 5),
    `b3 unchanged (not selected), got x=${b3.pose.x} y=${b3.pose.y}`);
  assert(nearlyEq(b3.pose.rotation, 1), 'b3 rotation preserved');
}

// ── 3. nothing selected → skipped ──────────────────────────────────
{
  seed();
  useSelectionStore.setState({ items: [] });
  const r = clearPoseLocation();
  assert(r.skipped === true && r.cleared === 0, 'no selection → skipped');
}

// ── 4. bone missing `pose` slot gets identity then cleared ─────────
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
  clearPoseLocation();
  const b1 = getBone('b1');
  assert(b1.pose && nearlyEq(b1.pose.x, 0) && nearlyEq(b1.pose.y, 0),
    'missing pose slot → identity, then loc cleared');
  assert(nearlyEq(b1.pose.scaleX, 1) && nearlyEq(b1.pose.scaleY, 1),
    'missing pose → identity scale preserved');
}

// ── 5. single undo entry (one snapshot) ────────────────────────────
{
  seed();
  const before = undoCount();
  clearPoseLocation();
  const after = undoCount();
  assert(after - before === 1,
    `multi-bone clear → 1 undo entry, got ${after - before}`);
  // Verify undo restores
  const proj = useProjectStore.getState().project;
  undo(proj, (snap) => useProjectStore.setState({ project: snap }));
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.x, 30) && nearlyEq(b1.pose.y, -20),
    `undo restores b1 loc, got x=${b1.pose.x} y=${b1.pose.y}`);
}

// ── 6. eligibility / hasSelectedBones helpers ──────────────────────
{
  seed();
  assert(hasSelectedBones() === true, '2 bones selected → true');
  const e = eligibleBones();
  assert(e.boneIds.length === 2, '2 bone ids returned');
  assert(e.activeId === 'b2', `b2 active (last selected), got ${e.activeId}`);
  // Non-bone selection
  useSelectionStore.setState({ items: [{ type: 'part', id: 'b1' }] });
  assert(hasSelectedBones() === false, 'part type rejected (not group)');
  // Plain group (no boneRole) rejected
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b1' }] });
  // mutate b1 to drop boneRole
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.map((n) =>
        n.id === 'b1' ? { ...n, boneRole: undefined } : n,
      ),
    },
  });
  assert(hasSelectedBones() === false, 'group without boneRole rejected');
}

// ── 7. IDENTITY_POSE shape ─────────────────────────────────────────
{
  assert(IDENTITY_POSE.rotation === 0, 'identity.rotation = 0');
  assert(IDENTITY_POSE.x === 0 && IDENTITY_POSE.y === 0, 'identity.x/y = 0');
  assert(IDENTITY_POSE.scaleX === 1 && IDENTITY_POSE.scaleY === 1, 'identity.scale = 1');
  assert(Object.isFrozen(IDENTITY_POSE), 'IDENTITY_POSE frozen');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
