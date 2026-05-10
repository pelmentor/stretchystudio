// Toolset Plan Phase 7.A.5 — Set Origin.
//
// Verifies `setOriginForSelection(mode)` + helpers:
//   - meshMedian / meshBBoxCenter / meshWeightedCenter math.
//   - applySetOrigin shifts gizmo + compensates verts (visual world preserved).
//   - Pivot reset to (0,0) post-set.
//   - Top-level only (parent != null → skipped).
//   - Bones / non-mesh nodes / empty mesh → skipped.
//
// Run: node scripts/test/test_objectMode_setOrigin.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import {
  meshMedian, meshBBoxCenter, meshWeightedCenter,
  applySetOrigin, setOriginForSelection,
} from '../../src/v3/operators/object/setOrigin.js';
import { makeLocalMatrix } from '../../src/renderer/transforms.js';
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

// ── 1. meshMedian on flat verts ────────────────────────────────────
{
  const verts = [0, 0, 10, 0, 5, 10];  // tri
  const m = meshMedian(verts);
  assert(nearlyEq(m.x, 5) && nearlyEq(m.y, 10/3),
    `flat tri median, got (${m.x},${m.y})`);
}

// ── 2. meshMedian on {x,y} verts ───────────────────────────────────
{
  const verts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
  const m = meshMedian(verts);
  assert(nearlyEq(m.x, 5) && nearlyEq(m.y, 10/3), 'object verts median');
}

// ── 3. meshMedian on [[x,y]] verts ─────────────────────────────────
{
  const verts = [[0, 0], [10, 0], [5, 10]];
  const m = meshMedian(verts);
  assert(nearlyEq(m.x, 5) && nearlyEq(m.y, 10/3), 'array-tuple verts median');
}

// ── 4. meshMedian empty / null ─────────────────────────────────────
{
  assert(meshMedian([]) === null, 'empty → null');
  assert(meshMedian(null) === null, 'null → null');
}

// ── 5. meshBBoxCenter ──────────────────────────────────────────────
{
  const verts = [0, 0, 10, 0, 5, 10, 5, -5];
  const c = meshBBoxCenter(verts);
  // BBox: x [0..10], y [-5..10] → centre (5, 2.5).
  assert(nearlyEq(c.x, 5) && nearlyEq(c.y, 2.5),
    `bbox centre, got (${c.x},${c.y})`);
}

// ── 6. meshWeightedCenter falls back to median when no weights ─────
{
  const mesh = { vertices: [0, 0, 10, 0, 5, 10] };
  const c = meshWeightedCenter(mesh);
  assert(nearlyEq(c.x, 5) && nearlyEq(c.y, 10/3), 'no weights → median');
}

// ── 7. meshWeightedCenter with weights ─────────────────────────────
{
  const mesh = {
    vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
    boneWeights: [0, 1, 1],
  };
  const c = meshWeightedCenter(mesh);
  // Equal weights on (10,0) and (5,10) → centroid (7.5, 5).
  assert(nearlyEq(c.x, 7.5) && nearlyEq(c.y, 5), `weighted, got (${c.x},${c.y})`);
}

// ── 8. applySetOrigin: shifts gizmo + compensates verts ────────────
{
  seed([
    { id: 'p1', type: 'part', parent: null,
      transform: { ...ident(), x: 0, y: 0, scaleX: 1, scaleY: 1 },
      mesh: { vertices: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }] } },
  ]);
  // Move origin to mesh median = (150, ~133.33). Gizmo will move by delta;
  // verts compensate so visual stays.
  const before = useProjectStore.getState().project.nodes[0].mesh.vertices.map((v) => ({ ...v }));
  const r = applySetOrigin('p1', { x: 150, y: 133.33 });
  assert(r.ok === true, `applySetOrigin ok, got ${JSON.stringify(r)}`);
  const after = useProjectStore.getState().project.nodes[0];
  // Gizmo (transform.x/y) should be (150, 133.33).
  assert(nearlyEq(after.transform.x, 150) && nearlyEq(after.transform.y, 133.33),
    `transform → (150, 133.33), got (${after.transform.x},${after.transform.y})`);
  // Pivot reset.
  assert(after.transform.pivotX === 0 && after.transform.pivotY === 0, 'pivot → (0,0)');
  // Each vertex shifted by -(150, 133.33) (since M = I).
  for (let i = 0; i < before.length; i++) {
    const expectedX = before[i].x - 150;
    const expectedY = before[i].y - 133.33;
    assert(nearlyEq(after.mesh.vertices[i].x, expectedX),
      `vert ${i} shifted by -delta, got x=${after.mesh.vertices[i].x} expected=${expectedX}`);
    assert(nearlyEq(after.mesh.vertices[i].y, expectedY),
      `vert ${i} shifted by -delta, got y=${after.mesh.vertices[i].y} expected=${expectedY}`);
  }
  // Compose to verify visual position preserved: vert[0] world = M × local + trans
  // = (1*70 + 0*-33.33 + 150, 0 + 1*-33.33 + 133.33) = (220 wait that's wrong)
  // Actually after.vertices[0] = (100-150, 100-133.33) = (-50, -33.33)
  // World = transform.x + vert.x = 150 + (-50) = 100. ✓
  const v0World = after.transform.x + after.mesh.vertices[0].x;
  assert(nearlyEq(v0World, 100), `visual world preserved (was 100), got ${v0World}`);
}

// ── 9. applySetOrigin: child node skipped ──────────────────────────
{
  seed([
    { id: 'parent', type: 'group', parent: null, transform: ident() },
    { id: 'p1', type: 'part', parent: 'parent', transform: ident(),
      mesh: { vertices: [{ x: 0, y: 0 }] } },
  ]);
  const r = applySetOrigin('p1', { x: 100, y: 100 });
  assert(r.ok === false && r.reason === 'has parent', `child skipped, got ${JSON.stringify(r)}`);
}

// ── 10. setOriginForSelection: median mode ─────────────────────────
{
  seed([
    { id: 'p1', type: 'part', parent: null, transform: { ...ident() },
      mesh: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] } },
  ]);
  useSelectionStore.setState({ items: [{ type: 'part', id: 'p1' }] });
  const r = setOriginForSelection('median');
  assert(r.moved === 1, `moved 1, got ${r.moved}`);
  const after = useProjectStore.getState().project.nodes[0];
  assert(nearlyEq(after.transform.x, 5) && nearlyEq(after.transform.y, 10/3),
    `gizmo → mesh median, got (${after.transform.x},${after.transform.y})`);
}

// ── 11. setOriginForSelection: cursor mode ─────────────────────────
{
  seed([
    { id: 'p1', type: 'part', parent: null, transform: { ...ident() },
      mesh: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } },
  ]);
  useProjectStore.getState().setProjectCursor(250, 350);
  useSelectionStore.setState({ items: [{ type: 'part', id: 'p1' }] });
  setOriginForSelection('cursor');
  const after = useProjectStore.getState().project.nodes[0];
  assert(nearlyEq(after.transform.x, 250) && nearlyEq(after.transform.y, 350),
    `gizmo → cursor (250, 350), got (${after.transform.x},${after.transform.y})`);
}

// ── 12. setOriginForSelection: bboxCenter mode ─────────────────────
{
  seed([
    { id: 'p1', type: 'part', parent: null, transform: { ...ident() },
      mesh: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }] } },
  ]);
  useSelectionStore.setState({ items: [{ type: 'part', id: 'p1' }] });
  setOriginForSelection('bboxCenter');
  const after = useProjectStore.getState().project.nodes[0];
  // BBox centre = (5, 5).
  assert(nearlyEq(after.transform.x, 5) && nearlyEq(after.transform.y, 5),
    `gizmo → bbox centre (5,5), got (${after.transform.x},${after.transform.y})`);
}

// ── 13. setOriginForSelection: skip child / non-part / no-mesh ────
{
  seed([
    { id: 'g', type: 'group', parent: null, transform: ident() },
    { id: 'parent', type: 'group', parent: null, transform: ident() },
    { id: 'child', type: 'part', parent: 'parent', transform: ident(), mesh: { vertices: [{ x: 0, y: 0 }] } },
    { id: 'noMesh', type: 'part', parent: null, transform: ident() },
  ]);
  useSelectionStore.setState({
    items: [
      { type: 'group', id: 'g' },
      { type: 'part', id: 'child' },
      { type: 'part', id: 'noMesh' },
    ],
  });
  const r = setOriginForSelection('median');
  assert(r.moved === 0 && r.skipped === 3, `all skipped, got ${JSON.stringify(r)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
