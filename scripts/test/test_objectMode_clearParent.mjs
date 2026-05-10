// Toolset Plan Phase 7.A.4 — Clear Parent.
//
// Verifies `clearParent(mode)`:
//   - 'clear' — parent=null; local transform unchanged → world shifts.
//   - 'keepTransform' (default) — parent=null + local rewritten to keep
//      visual world position.
//   - 'inverse' — placeholder; behaves like 'clear' in SS.
//   - Already-rootless nodes counted as skipped.
//
// Run: node scripts/test/test_objectMode_clearParent.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { clearParent } from '../../src/v3/operators/object/parent.js';
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

// ── 1. 'keepTransform' default: visual position preserved ─────────
{
  seed([
    { id: 'parent', type: 'group', parent: null,
      transform: { ...ident(), x: 100, y: 200 } },
    { id: 'child', type: 'part', parent: 'parent',
      transform: { ...ident(), x: 200, y: 200 },  // local → world (300,400)
      mesh: { vertices: [] } },
  ]);
  useSelectionStore.setState({ items: [{ type: 'part', id: 'child' }] });
  const wmBefore = computeWorldMatrices(useProjectStore.getState().project.nodes);
  const childWorldBefore = { x: wmBefore.get('child')[6], y: wmBefore.get('child')[7] };
  const r = clearParent('keepTransform');
  assert(r.cleared === 1, `cleared=1, got ${r.cleared}`);
  const child = useProjectStore.getState().project.nodes.find((n) => n.id === 'child');
  assert((child.parent ?? null) === null, 'parent cleared');
  assert(nearlyEq(child.transform.x, childWorldBefore.x), `local.x = world (${childWorldBefore.x}), got ${child.transform.x}`);
  assert(nearlyEq(child.transform.y, childWorldBefore.y), `local.y = world (${childWorldBefore.y}), got ${child.transform.y}`);
}

// ── 2. 'clear' mode: local kept → world shifts ────────────────────
{
  seed([
    { id: 'parent', type: 'group', parent: null,
      transform: { ...ident(), x: 100, y: 200 } },
    { id: 'child', type: 'part', parent: 'parent',
      transform: { ...ident(), x: 50, y: 60 },
      mesh: { vertices: [] } },
  ]);
  useSelectionStore.setState({ items: [{ type: 'part', id: 'child' }] });
  clearParent('clear');
  const child = useProjectStore.getState().project.nodes.find((n) => n.id === 'child');
  assert((child.parent ?? null) === null, 'parent cleared');
  assert(nearlyEq(child.transform.x, 50) && nearlyEq(child.transform.y, 60),
    `local kept (50,60), got (${child.transform.x},${child.transform.y})`);
}

// ── 3. 'inverse' mode: same as 'clear' in SS ──────────────────────
{
  seed([
    { id: 'parent', type: 'group', parent: null,
      transform: { ...ident(), x: 100, y: 200 } },
    { id: 'child', type: 'part', parent: 'parent',
      transform: { ...ident(), x: 50, y: 60 },
      mesh: { vertices: [] } },
  ]);
  useSelectionStore.setState({ items: [{ type: 'part', id: 'child' }] });
  clearParent('inverse');
  const child = useProjectStore.getState().project.nodes.find((n) => n.id === 'child');
  assert((child.parent ?? null) === null, 'parent cleared (inverse alias)');
  assert(nearlyEq(child.transform.x, 50), 'inverse falls through to clear (no compensation)');
}

// ── 4. Already-rootless: counted as skipped ───────────────────────
{
  seed([
    { id: 'g1', type: 'group', parent: null, transform: ident() },
  ]);
  useSelectionStore.setState({ items: [{ type: 'group', id: 'g1' }] });
  const r = clearParent('keepTransform');
  assert(r.cleared === 0, `cleared=0, got ${r.cleared}`);
  assert(r.skipped === 1, 'rootless counted as skipped');
}

// ── 5. Multiple children: each cleared independently ───────────────
{
  seed([
    { id: 'parent', type: 'group', parent: null, transform: { ...ident(), x: 100, y: 200 } },
    { id: 'a', type: 'part', parent: 'parent', transform: { ...ident(), x: 10, y: 10 }, mesh: { vertices: [] } },
    { id: 'b', type: 'part', parent: 'parent', transform: { ...ident(), x: 20, y: 30 }, mesh: { vertices: [] } },
  ]);
  useSelectionStore.setState({
    items: [{ type: 'part', id: 'a' }, { type: 'part', id: 'b' }],
  });
  const r = clearParent('keepTransform');
  assert(r.cleared === 2, `2 cleared, got ${r.cleared}`);
  const project = useProjectStore.getState().project;
  const a = project.nodes.find((n) => n.id === 'a');
  const b = project.nodes.find((n) => n.id === 'b');
  // Both should now sit at their world positions.
  assert(nearlyEq(a.transform.x, 110) && nearlyEq(a.transform.y, 210), `a → (110,210), got (${a.transform.x},${a.transform.y})`);
  assert(nearlyEq(b.transform.x, 120) && nearlyEq(b.transform.y, 230), `b → (120,230), got (${b.transform.x},${b.transform.y})`);
}

// ── 6. Empty selection → no-op ────────────────────────────────────
{
  seed([
    { id: 'parent', type: 'group', parent: null, transform: ident() },
    { id: 'child', type: 'part', parent: 'parent', transform: ident(), mesh: { vertices: [] } },
  ]);
  useSelectionStore.setState({ items: [] });
  const r = clearParent('keepTransform');
  assert(r.cleared === 0, 'empty → 0');
  const child = useProjectStore.getState().project.nodes.find((n) => n.id === 'child');
  assert(child.parent === 'parent', 'parent unchanged');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
