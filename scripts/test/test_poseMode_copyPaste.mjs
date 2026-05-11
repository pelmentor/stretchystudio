// Toolset Plan Phase 7.C.6 — Copy / Paste Pose.
//
// Verifies the clipboard round-trip + role mapping:
//   - poseCopy snapshots selected bones into clipboard keyed by role
//   - poseClipboardStore stores entries + timestamp
//   - posePaste finds matching role in clipboard + applies
//   - bones with no clipboard match listed in unmatchedRoles
//   - selection items without `boneRole` filtered before copy
//     (`isBoneGroup` requires a role; plain groups are not bones in SS)
//   - clipboard clears via store.clear()
//
// Run: node scripts/test/test_poseMode_copyPaste.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { usePoseClipboardStore } from '../../src/store/poseClipboardStore.js';
import { clearHistory } from '../../src/store/undoHistory.js';
import {
  poseCopy,
  posePaste,
  eligibleForCopy,
  eligibleForPaste,
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
        { id: 'b3', type: 'group', boneRole: 'torso', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 150, pivotY: 100 },
          pose: { rotation: 0.1, x: 0, y: -2, scaleX: 1, scaleY: 1 },
        },
        // bone with no role (manually-renamed or pre-Init-Rig)
        { id: 'b4', type: 'group', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 50, pivotY: 50 },
          pose: { rotation: 9, x: 9, y: 9, scaleX: 1, scaleY: 1 },
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

// ── 1. poseCopy snapshots selected bone with role ─────────────────
{
  seed();
  const r = poseCopy();
  assert(r.copied === 1, `1 copied, got ${r.copied}`);
  const clip = usePoseClipboardStore.getState();
  assert(clip.entries.length === 1, '1 entry');
  assert(clip.entries[0].role === 'leftElbow', 'role = leftElbow');
  assert(nearlyEq(clip.entries[0].pose.rotation, 0.5), 'pose.rotation copied');
  assert(typeof clip.timestamp === 'number' && clip.timestamp > 0,
    'timestamp set');
}

// ── 2. multi-bone copy ─────────────────────────────────────────────
{
  seed();
  useSelectionStore.setState({ items: [
    { type: 'group', id: 'b1' }, { type: 'group', id: 'b2' }, { type: 'group', id: 'b3' },
  ] });
  const r = poseCopy();
  assert(r.copied === 3, '3 copied');
  const roles = usePoseClipboardStore.getState().entries.map((e) => e.role).sort();
  assert(JSON.stringify(roles) === JSON.stringify(['leftElbow','rightElbow','torso']),
    'all roles in clipboard');
}

// ── 3. plain group (no boneRole) filtered before copy ────────────
{
  seed();
  // b4 has no boneRole → isBoneGroup returns false → eligibleBones
  // omits it entirely. poseCopy never sees it.
  useSelectionStore.setState({ items: [
    { type: 'group', id: 'b1' }, { type: 'group', id: 'b4' },
  ] });
  const r = poseCopy();
  assert(r.copied === 1, `1 copied (b4 filtered, b1 only), got ${r.copied}`);
  const roles = usePoseClipboardStore.getState().entries.map((e) => e.role);
  assert(roles.length === 1 && roles[0] === 'leftElbow',
    'only b1 (leftElbow) in clipboard');
}

// ── 4. paste finds role in clipboard ──────────────────────────────
{
  seed();
  // Copy b1 (leftElbow)
  poseCopy();
  // Mutate b1 to identity, then paste — should restore
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.map((n) =>
        n.id === 'b1' ? { ...n, pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } } : n,
      ),
    },
  });
  const r = posePaste();
  assert(r.pasted === 1, '1 pasted');
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.rotation, 0.5) && nearlyEq(b1.pose.x, 30),
    'b1 restored from clipboard');
}

// ── 5. paste onto bone with no clipboard match → unmatched ───────
{
  seed();
  // Copy b1 (leftElbow only)
  poseCopy();
  // Select b3 (torso) — torso not in clipboard
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b3' }] });
  const before = getBone('b3').pose.rotation;
  const r = posePaste();
  assert(r.pasted === 0, 'no match → 0 pasted');
  assert(r.unmatchedRoles.includes('torso'), 'torso in unmatched');
  assert(nearlyEq(getBone('b3').pose.rotation, before),
    'b3 unchanged (no write)');
}

// ── 6. paste cross-skeleton via role mapping ─────────────────────
{
  seed();
  // Copy from b1 (leftElbow)
  poseCopy();
  // "Different skeleton" = a fresh project with same role taxonomy
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: [
        { id: 'newSkel.leftElbow', type: 'group', boneRole: 'leftElbow', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 999, pivotY: 999 },
          pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
      ],
    },
  });
  useSelectionStore.setState({ items: [{ type: 'group', id: 'newSkel.leftElbow' }] });
  const r = posePaste();
  assert(r.pasted === 1, 'role-mapped paste onto different id');
  const b = getBone('newSkel.leftElbow');
  assert(nearlyEq(b.pose.rotation, 0.5) && nearlyEq(b.pose.x, 30),
    'pose received');
}

// ── 7. eligibility gates ──────────────────────────────────────────
{
  seed();
  assert(eligibleForCopy() === true, 'b1 selected → copy eligible');
  // Empty clipboard → paste ineligible
  assert(eligibleForPaste() === false, 'empty clipboard → paste ineligible');
  poseCopy();
  assert(eligibleForPaste() === true, 'after copy → paste eligible');
  // No selection → copy + paste both ineligible
  useSelectionStore.setState({ items: [] });
  assert(eligibleForCopy() === false, 'no selection → copy ineligible');
  assert(eligibleForPaste() === false, 'no selection → paste ineligible');
}

// ── 8. clipboard.clear() empties it ───────────────────────────────
{
  seed();
  poseCopy();
  assert(usePoseClipboardStore.getState().entries.length === 1, 'has 1 entry');
  usePoseClipboardStore.getState().clear();
  assert(usePoseClipboardStore.getState().entries.length === 0, 'cleared');
  assert(usePoseClipboardStore.getState().timestamp === null, 'timestamp null');
}

// ── 9. paste preserves all 5 fields atomically ────────────────────
{
  seed();
  // b1 has rot=0.5, x=30, y=-20, scaleX=1.2, scaleY=0.8
  poseCopy();
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: useProjectStore.getState().project.nodes.map((n) =>
        n.id === 'b1' ? { ...n, pose: { rotation: 99, x: 99, y: 99, scaleX: 99, scaleY: 99 } } : n,
      ),
    },
  });
  posePaste();
  const b1 = getBone('b1');
  assert(nearlyEq(b1.pose.rotation, 0.5), 'rotation pasted');
  assert(nearlyEq(b1.pose.x, 30), 'x pasted');
  assert(nearlyEq(b1.pose.y, -20), 'y pasted');
  assert(nearlyEq(b1.pose.scaleX, 1.2), 'scaleX pasted');
  assert(nearlyEq(b1.pose.scaleY, 0.8), 'scaleY pasted');
}

// ── 10. duplicate-role copy: last entry wins (defensive) ─────────
{
  seed();
  // Manually inject duplicate-role entries (couldn't happen via copy
  // unless two bones have same role; defensive coverage for paste
  // semantics).
  usePoseClipboardStore.getState().setEntries([
    { role: 'leftElbow', pose: { rotation: 0.1, x: 1, y: 1, scaleX: 1, scaleY: 1 } },
    { role: 'leftElbow', pose: { rotation: 0.9, x: 9, y: 9, scaleX: 2, scaleY: 2 } },
  ]);
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b1' }] });
  posePaste();
  const b1 = getBone('b1');
  // Last-wins
  assert(nearlyEq(b1.pose.rotation, 0.9) && nearlyEq(b1.pose.x, 9),
    `last entry wins, got rot=${b1.pose.rotation} x=${b1.pose.x}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
