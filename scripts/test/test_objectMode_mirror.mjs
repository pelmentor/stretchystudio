// Toolset Plan Phase 7.A.2 — Mirror selected.
//
// Verifies `mirrorSelected(axis)`:
//   - X mirror: position flips through median-X; rotation sign flip;
//     scaleX sign flip.
//   - Y mirror: position flips through median-Y; rotation sign flip;
//     scaleY sign flip.
//   - Z mirror: no-op (returns axis='z' result).
//   - Single-object selection: mirrors in place (median == self origin).
//   - Bones excluded; counted in skippedBones.
//
// Run: node scripts/test/test_objectMode_mirror.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { mirrorSelected } from '../../src/v3/operators/object/mirror.js';
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

function selectIds(ids) {
  useSelectionStore.setState({ items: ids.map((id) => ({ type: 'part', id })) });
}

// ── 1. X mirror two parts: positions flip through median X ────────
{
  seed([
    { id: 'p1', type: 'part', parent: null,
      transform: { ...ident(), x: 100, y: 200, rotation: 30, scaleX: 1.5, scaleY: 1 },
      mesh: { vertices: [] } },
    { id: 'p2', type: 'part', parent: null,
      transform: { ...ident(), x: 300, y: 200, rotation: -10, scaleX: 1, scaleY: 2 },
      mesh: { vertices: [] } },
  ]);
  selectIds(['p1', 'p2']);
  // Median X = 200. p1 (100) → 300; p2 (300) → 100.
  const r = mirrorSelected('x');
  assert(r.mirrored === 2, `mirrored 2, got ${r.mirrored}`);
  const project = useProjectStore.getState().project;
  const p1 = project.nodes.find((n) => n.id === 'p1');
  const p2 = project.nodes.find((n) => n.id === 'p2');
  assert(nearlyEq(p1.transform.x, 300) && nearlyEq(p1.transform.y, 200),
    `p1 → (300,200), got (${p1.transform.x},${p1.transform.y})`);
  assert(nearlyEq(p2.transform.x, 100) && nearlyEq(p2.transform.y, 200),
    `p2 → (100,200), got (${p2.transform.x},${p2.transform.y})`);
  // Rotation flips sign.
  assert(p1.transform.rotation === -30, `p1 rotation flips, got ${p1.transform.rotation}`);
  assert(p2.transform.rotation === 10, 'p2 rotation flips');
  // scaleX flips sign for X mirror.
  assert(p1.transform.scaleX === -1.5, `p1 scaleX flips, got ${p1.transform.scaleX}`);
  assert(p2.transform.scaleX === -1, 'p2 scaleX flips');
  // scaleY unchanged for X mirror.
  assert(p1.transform.scaleY === 1, 'p1 scaleY unchanged on X mirror');
  assert(p2.transform.scaleY === 2, 'p2 scaleY unchanged on X mirror');
}

// ── 2. Y mirror: scaleY flips, scaleX unchanged ───────────────────
{
  seed([
    { id: 'p1', type: 'part', parent: null,
      transform: { ...ident(), x: 100, y: 100, scaleX: 2, scaleY: 1.5 },
      mesh: { vertices: [] } },
    { id: 'p2', type: 'part', parent: null,
      transform: { ...ident(), x: 100, y: 300, scaleX: 0.5, scaleY: 1 },
      mesh: { vertices: [] } },
  ]);
  selectIds(['p1', 'p2']);
  // Median Y = 200. p1 (100) → 300; p2 (300) → 100.
  mirrorSelected('y');
  const project = useProjectStore.getState().project;
  const p1 = project.nodes.find((n) => n.id === 'p1');
  const p2 = project.nodes.find((n) => n.id === 'p2');
  assert(nearlyEq(p1.transform.y, 300), `p1.y → 300, got ${p1.transform.y}`);
  assert(nearlyEq(p2.transform.y, 100), `p2.y → 100, got ${p2.transform.y}`);
  assert(p1.transform.scaleX === 2, 'p1 scaleX unchanged on Y mirror');
  assert(p1.transform.scaleY === -1.5, 'p1 scaleY flips on Y mirror');
  assert(p2.transform.scaleX === 0.5, 'p2 scaleX unchanged on Y mirror');
  assert(p2.transform.scaleY === -1, 'p2 scaleY flips on Y mirror');
}

// ── 3. Z mirror is a no-op ────────────────────────────────────────
{
  seed([
    { id: 'p1', type: 'part', parent: null,
      transform: { ...ident(), x: 100, y: 100, scaleX: 2 },
      mesh: { vertices: [] } },
  ]);
  selectIds(['p1']);
  const r = mirrorSelected('z');
  assert(r.axis === 'z' && r.mirrored === 0, 'Z is no-op');
  const p1 = useProjectStore.getState().project.nodes.find((n) => n.id === 'p1');
  assert(p1.transform.x === 100 && p1.transform.scaleX === 2, 'Z mirror leaves transform untouched');
}

// ── 4. Single-object selection mirrors in place (no movement) ─────
{
  seed([
    { id: 'p1', type: 'part', parent: null,
      transform: { ...ident(), x: 100, y: 100, rotation: 45, scaleX: 1, scaleY: 1 },
      mesh: { vertices: [] } },
  ]);
  selectIds(['p1']);
  mirrorSelected('x');
  const p1 = useProjectStore.getState().project.nodes.find((n) => n.id === 'p1');
  // Median == p1's own origin → no positional shift.
  assert(p1.transform.x === 100 && p1.transform.y === 100, 'single-selection X mirror: no movement');
  // But rotation + scaleX still flip.
  assert(p1.transform.rotation === -45, 'rotation flips');
  assert(p1.transform.scaleX === -1, 'scaleX flips');
}

// ── 5. Bones excluded ─────────────────────────────────────────────
{
  seed([
    { id: 'p1', type: 'part', parent: null,
      transform: { ...ident(), x: 100, y: 100 },
      mesh: { vertices: [] } },
    { id: 'b1', type: 'group', parent: null, boneRole: 'torso',
      transform: { ...ident(), x: 200, y: 200 } },
  ]);
  useSelectionStore.setState({
    items: [
      { type: 'part', id: 'p1' },
      { type: 'group', id: 'b1' },
    ],
  });
  const r = mirrorSelected('x');
  assert(r.mirrored === 1 && r.skippedBones === 1, `mirrored=1, skippedBones=1, got ${JSON.stringify(r)}`);
  const project = useProjectStore.getState().project;
  const b1 = project.nodes.find((n) => n.id === 'b1');
  assert(b1.transform.x === 200 && b1.transform.y === 200, 'bone untouched');
}

// ── 6. Empty selection → no-op ────────────────────────────────────
{
  seed([
    { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 100, y: 100 }, mesh: { vertices: [] } },
  ]);
  selectIds([]);
  const r = mirrorSelected('x');
  assert(r.mirrored === 0, 'empty selection → 0 mirrored');
  const p1 = useProjectStore.getState().project.nodes.find((n) => n.id === 'p1');
  assert(p1.transform.x === 100, 'unchanged');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
