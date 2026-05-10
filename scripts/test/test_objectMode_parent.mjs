// Toolset Plan Phase 7.A.3 — Set Parent.
//
// Verifies `setParent({keepTransform})`:
//   - Active = LAST selected; non-active items get reparented to active.
//   - Cycle detection (via reparentNode): rejects descendant-as-parent.
//   - keepTransform=true (default): visual world position preserved.
//   - keepTransform=false: child snaps to whatever local transform it had.
//   - <2 selected → no-op.
//
// Run: node scripts/test/test_objectMode_parent.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { setParent } from '../../src/v3/operators/object/parent.js';
import { computeWorldMatrices } from '../../src/renderer/transforms.js';
import { clearHistory } from '../../src/store/undoHistory.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function nearlyEq(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

function ident() {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
}

function seed(nodes) {
  clearHistory();
  useSelectionStore.setState({ items: [] });
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 33,
      canvas: { width: 800, height: 600, x: 0, y: 0 },
      cursor: { x: 400, y: 300 },
      textures: [], nodes, animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
}

function selectIds(ids, types = []) {
  useSelectionStore.setState({
    items: ids.map((id, i) => ({ type: types[i] ?? 'group', id })),
  });
}

// ── 1. Two groups: child reparents to active ───────────────────────
{
  seed([
    { id: 'g1', type: 'group', parent: null, transform: ident() },
    { id: 'g2', type: 'group', parent: null, transform: ident() },
  ]);
  selectIds(['g1', 'g2']);
  const r = setParent();
  assert(r.parented === 1, `parented=1, got ${r.parented}`);
  assert(r.activeId === 'g2', 'active = LAST');
  const g1 = useProjectStore.getState().project.nodes.find((n) => n.id === 'g1');
  assert(g1.parent === 'g2', `g1.parent === g2, got ${g1.parent}`);
}

// ── 2. Cycle rejected: parenting g2 (existing parent of g1) to g1 ─
{
  seed([
    { id: 'g1', type: 'group', parent: 'g2', transform: ident() },
    { id: 'g2', type: 'group', parent: null,  transform: ident() },
  ]);
  // Selection: g2 first, g1 LAST → active = g1; g2 would become child of g1.
  // But g1.parent = g2 already → cycle.
  selectIds(['g2', 'g1']);
  const r = setParent();
  assert(r.parented === 0, `cycle rejected, got parented=${r.parented}`);
  assert(r.skipped === 1, `cycle counted as skipped, got ${r.skipped}`);
  const g2 = useProjectStore.getState().project.nodes.find((n) => n.id === 'g2');
  assert((g2.parent ?? null) === null, 'g2 stays root');
}

// ── 3. keepTransform=true: visual position preserved ──────────────
{
  // Parent at (100, 200); child at world (300, 400) before reparent
  // (parent: null), so transform.x=300, y=400.
  seed([
    { id: 'parent', type: 'group', parent: null,
      transform: { ...ident(), x: 100, y: 200 } },
    { id: 'child', type: 'part', parent: null,
      transform: { ...ident(), x: 300, y: 400 },
      mesh: { vertices: [] } },
  ]);
  // Active = parent (LAST selected).
  useSelectionStore.setState({
    items: [
      { type: 'part', id: 'child' },
      { type: 'group', id: 'parent' },
    ],
  });
  // Capture pre-reparent world position.
  const wmBefore = computeWorldMatrices(useProjectStore.getState().project.nodes);
  const childWorldBefore = { x: wmBefore.get('child')[6], y: wmBefore.get('child')[7] };
  setParent({ keepTransform: true });
  const wmAfter = computeWorldMatrices(useProjectStore.getState().project.nodes);
  const childWorldAfter = { x: wmAfter.get('child')[6], y: wmAfter.get('child')[7] };
  assert(nearlyEq(childWorldAfter.x, childWorldBefore.x) && nearlyEq(childWorldAfter.y, childWorldBefore.y),
    `world position preserved: before=(${childWorldBefore.x},${childWorldBefore.y}) after=(${childWorldAfter.x},${childWorldAfter.y})`);
  // Local: child's new transform should map to (300, 400) world via parent's frame.
  // Parent at (100, 200) identity → child.local = (200, 200).
  const child = useProjectStore.getState().project.nodes.find((n) => n.id === 'child');
  assert(nearlyEq(child.transform.x, 200) && nearlyEq(child.transform.y, 200),
    `compensated local, got (${child.transform.x},${child.transform.y})`);
}

// ── 4. keepTransform=false: local stays the same → world shifts ───
{
  seed([
    { id: 'parent', type: 'group', parent: null,
      transform: { ...ident(), x: 100, y: 200 } },
    { id: 'child', type: 'part', parent: null,
      transform: { ...ident(), x: 300, y: 400 },
      mesh: { vertices: [] } },
  ]);
  useSelectionStore.setState({
    items: [
      { type: 'part', id: 'child' },
      { type: 'group', id: 'parent' },
    ],
  });
  setParent({ keepTransform: false });
  const child = useProjectStore.getState().project.nodes.find((n) => n.id === 'child');
  // Local kept at (300, 400); under parent at (100, 200) → world = (400, 600).
  assert(nearlyEq(child.transform.x, 300) && nearlyEq(child.transform.y, 400),
    `local kept, got (${child.transform.x},${child.transform.y})`);
}

// ── 5. <2 selected → no-op ─────────────────────────────────────────
{
  seed([
    { id: 'g1', type: 'group', parent: null, transform: ident() },
  ]);
  selectIds(['g1']);
  const r = setParent();
  assert(r.parented === 0 && r.activeId === null, '1 selected → no-op');
}

// ── 6. 3+ selection: every non-active reparents ───────────────────
{
  seed([
    { id: 'g1', type: 'group', parent: null, transform: ident() },
    { id: 'g2', type: 'group', parent: null, transform: ident() },
    { id: 'g3', type: 'group', parent: null, transform: ident() },
    { id: 'g4', type: 'group', parent: null, transform: ident() },
  ]);
  // Active = g4.
  selectIds(['g1', 'g2', 'g3', 'g4']);
  const r = setParent();
  assert(r.parented === 3, `parented 3 (g1, g2, g3), got ${r.parented}`);
  const project = useProjectStore.getState().project;
  for (const id of ['g1', 'g2', 'g3']) {
    const n = project.nodes.find((nn) => nn.id === id);
    assert(n.parent === 'g4', `${id}.parent === g4, got ${n.parent}`);
  }
  const g4 = project.nodes.find((n) => n.id === 'g4');
  assert((g4.parent ?? null) === null, 'g4 stays root');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
