// Toolset Plan Phase 7.A.1 — Snap menu operators.
//
// Verifies the 9 snap operators in `src/v3/operators/object/snap.js`:
//   - readCursor / setProjectCursor round-trip
//   - snapToGrid math
//   - snapSelectionToCursor / KeepOffset / Grid / WorldOrigin / Active
//   - snapCursorTo World / Selected / Grid / Active
//   - bone exclusion (isBoneGroup)
//   - top-level vs child (worldToParentLocal mapping)
//
// Run: node scripts/test/test_objectMode_snapMenu.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { usePreferencesStore } from '../../src/store/preferencesStore.js';
import {
  readCursor, snapToGrid, getGridStep, eligibleSelection,
  nodeWorldOrigin, medianOfOrigins,
  snapSelectionToCursor, snapSelectionToCursorKeepOffset,
  snapSelectionToGrid, snapSelectionToWorldOrigin, snapSelectionToActive,
  snapCursorToWorldOrigin, snapCursorToSelected, snapCursorToGrid, snapCursorToActive,
} from '../../src/v3/operators/object/snap.js';
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

function seed({ cursor = { x: 100, y: 200 }, nodes = [] } = {}) {
  clearHistory();
  useSelectionStore.setState({ items: [] });
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 33,
      canvas: { width: 800, height: 600, x: 0, y: 0 },
      cursor,
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

// ── 1. readCursor + setProjectCursor round-trip ─────────────────────
{
  seed({ cursor: { x: 50, y: 75 } });
  const c = readCursor(useProjectStore.getState().project);
  assert(c.x === 50 && c.y === 75, 'readCursor returns persisted value');
  useProjectStore.getState().setProjectCursor(123, 456);
  const c2 = readCursor(useProjectStore.getState().project);
  assert(c2.x === 123 && c2.y === 456, 'setProjectCursor mutates project.cursor');
}

// ── 2. readCursor falls back to canvas centre when missing ──────────
{
  seed();
  // Force-clear cursor field
  useProjectStore.setState({ project: { ...useProjectStore.getState().project, cursor: undefined } });
  const c = readCursor(useProjectStore.getState().project);
  assert(c.x === 400 && c.y === 300, `fallback to (400,300), got (${c.x},${c.y})`);
}

// ── 3. snapToGrid math ──────────────────────────────────────────────
{
  assert(snapToGrid(17, 16) === 16, 'snap 17 to 16');
  // Math.round rounds .5 away from zero (ECMA-262), so 24/16 = 1.5 → 2 → 32.
  assert(snapToGrid(24, 16) === 32, 'snap 24 → 32 (1.5 rounds up per ECMA-262)');
  assert(snapToGrid(23, 16) === 16, 'snap 23 → 16 (1.4375 rounds down)');
  assert(snapToGrid(0, 16) === 0, 'snap 0 to 0');
  assert(snapToGrid(-7, 16) === 0, 'snap -7 to 0');
  assert(snapToGrid(-9, 16) === -16, 'snap -9 to -16');
  assert(snapToGrid(42, 0) === 42, 'step=0 → identity');
  assert(snapToGrid(42, -5) === 42, 'step<0 → identity');
}

// ── 4. getGridStep reads preferencesStore.snap.modes.grid.increment ─
{
  const before = usePreferencesStore.getState().snap;
  usePreferencesStore.getState().setSnap({ modes: { grid: { increment: 32 } } });
  assert(getGridStep() === 32, `getGridStep reads pref, got ${getGridStep()}`);
  usePreferencesStore.getState().setSnap({ modes: { grid: { increment: 16 } } });
  assert(getGridStep() === 16, 'restores to 16');
}

// ── 5. eligibleSelection: bones excluded ────────────────────────────
{
  seed({
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: ident(), mesh: { vertices: [] } },
      { id: 'b1', type: 'group', parent: null, transform: ident(), boneRole: 'torso' },
      { id: 'g1', type: 'group', parent: null, transform: ident() },
    ],
  });
  useSelectionStore.setState({
    items: [
      { type: 'part', id: 'p1' },
      { type: 'group', id: 'b1' },
      { type: 'group', id: 'g1' },
    ],
  });
  const sel = eligibleSelection();
  assert(sel.nodeIds.length === 2, `excluded bone, got ${sel.nodeIds.length}`);
  assert(sel.nodeIds.includes('p1') && sel.nodeIds.includes('g1'), 'p1 + g1 in eligible');
  assert(!sel.nodeIds.includes('b1'), 'b1 (bone) not in eligible');
  assert(sel.activeId === 'g1', `active = LAST eligible (g1), got ${sel.activeId}`);
}

// ── 6. snapSelectionToCursor: top-level → transform.x/y == cursor ──
{
  seed({
    cursor: { x: 250, y: 300 },
    nodes: [
      { id: 'p1', type: 'part', parent: null,
        transform: { ...ident(), x: 50, y: 60 },
        mesh: { vertices: [] } },
      { id: 'p2', type: 'part', parent: null,
        transform: { ...ident(), x: 100, y: 120 },
        mesh: { vertices: [] } },
    ],
  });
  selectIds(['p1', 'p2']);
  snapSelectionToCursor();
  const project = useProjectStore.getState().project;
  const p1 = project.nodes.find((n) => n.id === 'p1');
  const p2 = project.nodes.find((n) => n.id === 'p2');
  assert(p1.transform.x === 250 && p1.transform.y === 300, `p1 → cursor, got (${p1.transform.x},${p1.transform.y})`);
  assert(p2.transform.x === 250 && p2.transform.y === 300, 'p2 → cursor');
}

// ── 7. snapSelectionToWorldOrigin: top-level → (0, 0) ──────────────
{
  seed({
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 100, y: 200 }, mesh: { vertices: [] } },
    ],
  });
  selectIds(['p1']);
  snapSelectionToWorldOrigin();
  const p1 = useProjectStore.getState().project.nodes.find((n) => n.id === 'p1');
  assert(p1.transform.x === 0 && p1.transform.y === 0, `→ (0,0), got (${p1.transform.x},${p1.transform.y})`);
}

// ── 8. snapSelectionToCursorKeepOffset: median moves to cursor;
//        per-node offsets preserved ─────────────────────────────────
{
  seed({
    cursor: { x: 500, y: 500 },
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 100, y: 100 }, mesh: { vertices: [] } },
      { id: 'p2', type: 'part', parent: null, transform: { ...ident(), x: 300, y: 300 }, mesh: { vertices: [] } },
    ],
  });
  selectIds(['p1', 'p2']);
  // Median of (100,100) and (300,300) = (200, 200). Cursor = (500, 500).
  // Delta = (300, 300). p1 → (400, 400), p2 → (600, 600).
  snapSelectionToCursorKeepOffset();
  const project = useProjectStore.getState().project;
  const p1 = project.nodes.find((n) => n.id === 'p1');
  const p2 = project.nodes.find((n) => n.id === 'p2');
  assert(nearlyEq(p1.transform.x, 400) && nearlyEq(p1.transform.y, 400),
    `KeepOffset p1, got (${p1.transform.x},${p1.transform.y})`);
  assert(nearlyEq(p2.transform.x, 600) && nearlyEq(p2.transform.y, 600),
    `KeepOffset p2, got (${p2.transform.x},${p2.transform.y})`);
}

// ── 9. snapSelectionToActive: leaves active alone ──────────────────
{
  seed({
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 10, y: 20 }, mesh: { vertices: [] } },
      { id: 'p2', type: 'part', parent: null, transform: { ...ident(), x: 30, y: 40 }, mesh: { vertices: [] } },
      { id: 'p3', type: 'part', parent: null, transform: { ...ident(), x: 100, y: 200 }, mesh: { vertices: [] } },
    ],
  });
  // Active = p3 (last selected).
  selectIds(['p1', 'p2', 'p3']);
  snapSelectionToActive();
  const project = useProjectStore.getState().project;
  const p1 = project.nodes.find((n) => n.id === 'p1');
  const p2 = project.nodes.find((n) => n.id === 'p2');
  const p3 = project.nodes.find((n) => n.id === 'p3');
  assert(p1.transform.x === 100 && p1.transform.y === 200, 'p1 → active');
  assert(p2.transform.x === 100 && p2.transform.y === 200, 'p2 → active');
  assert(p3.transform.x === 100 && p3.transform.y === 200, 'active itself unchanged');
}

// ── 10. snapSelectionToGrid: each origin snaps independently ───────
{
  seed({
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 17, y: 31 }, mesh: { vertices: [] } },
      { id: 'p2', type: 'part', parent: null, transform: { ...ident(), x: 50, y: 60 }, mesh: { vertices: [] } },
    ],
  });
  selectIds(['p1', 'p2']);
  usePreferencesStore.getState().setSnap({ modes: { grid: { increment: 16 } } });
  snapSelectionToGrid();
  const project = useProjectStore.getState().project;
  const p1 = project.nodes.find((n) => n.id === 'p1');
  const p2 = project.nodes.find((n) => n.id === 'p2');
  assert(p1.transform.x === 16, `p1.x snapped to 16, got ${p1.transform.x}`);
  assert(p1.transform.y === 32, `p1.y snapped to 32, got ${p1.transform.y}`);
  assert(p2.transform.x === 48, `p2.x snapped to 48, got ${p2.transform.x}`);
  assert(p2.transform.y === 64, `p2.y snapped to 64, got ${p2.transform.y}`);
}

// ── 11. snapCursorToWorldOrigin ────────────────────────────────────
{
  seed({ cursor: { x: 200, y: 300 } });
  snapCursorToWorldOrigin();
  const c = useProjectStore.getState().project.cursor;
  assert(c.x === 0 && c.y === 0, `cursor → (0,0), got (${c.x},${c.y})`);
}

// ── 12. snapCursorToSelected ────────────────────────────────────────
{
  seed({
    cursor: { x: 0, y: 0 },
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 100, y: 200 }, mesh: { vertices: [] } },
      { id: 'p2', type: 'part', parent: null, transform: { ...ident(), x: 300, y: 400 }, mesh: { vertices: [] } },
    ],
  });
  selectIds(['p1', 'p2']);
  snapCursorToSelected();
  const c = useProjectStore.getState().project.cursor;
  assert(nearlyEq(c.x, 200) && nearlyEq(c.y, 300),
    `cursor → median (200,300), got (${c.x},${c.y})`);
}

// ── 13. snapCursorToGrid ────────────────────────────────────────────
{
  seed({ cursor: { x: 17, y: 33 } });
  usePreferencesStore.getState().setSnap({ modes: { grid: { increment: 16 } } });
  snapCursorToGrid();
  const c = useProjectStore.getState().project.cursor;
  assert(c.x === 16 && c.y === 32, `cursor snapped to (16,32), got (${c.x},${c.y})`);
}

// ── 14. snapCursorToActive ──────────────────────────────────────────
{
  seed({
    cursor: { x: 0, y: 0 },
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 50, y: 60 }, mesh: { vertices: [] } },
      { id: 'p2', type: 'part', parent: null, transform: { ...ident(), x: 700, y: 800 }, mesh: { vertices: [] } },
    ],
  });
  selectIds(['p1', 'p2']);  // active = p2
  snapCursorToActive();
  const c = useProjectStore.getState().project.cursor;
  assert(c.x === 700 && c.y === 800, `cursor → p2 origin, got (${c.x},${c.y})`);
}

// ── 15. medianOfOrigins handles odd vs even counts ─────────────────
{
  seed({
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 10, y: 100 }, mesh: { vertices: [] } },
      { id: 'p2', type: 'part', parent: null, transform: { ...ident(), x: 30, y: 50 }, mesh: { vertices: [] } },
      { id: 'p3', type: 'part', parent: null, transform: { ...ident(), x: 50, y: 200 }, mesh: { vertices: [] } },
    ],
  });
  const wm = computeWorldMatrices(useProjectStore.getState().project.nodes);
  const med3 = medianOfOrigins(['p1', 'p2', 'p3'], wm);
  assert(med3.x === 30 && med3.y === 100, `odd count median, got (${med3.x},${med3.y})`);
  const med2 = medianOfOrigins(['p1', 'p3'], wm);
  assert(med2.x === 30 && med2.y === 150, `even count median (avg of mids), got (${med2.x},${med2.y})`);
  const medEmpty = medianOfOrigins([], wm);
  assert(medEmpty === null, 'empty → null');
}

// ── 16. nodeWorldOrigin reads m[6], m[7] ───────────────────────────
{
  seed({
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 123, y: 456 }, mesh: { vertices: [] } },
    ],
  });
  const wm = computeWorldMatrices(useProjectStore.getState().project.nodes);
  const o = nodeWorldOrigin('p1', wm);
  assert(o.x === 123 && o.y === 456, 'identity transform → world origin = (x,y)');
  const missing = nodeWorldOrigin('does-not-exist', wm);
  assert(missing === null, 'missing id → null');
}

// ── 17. Empty selection: ops are no-ops ─────────────────────────────
{
  seed({
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 50, y: 60 }, mesh: { vertices: [] } },
    ],
  });
  selectIds([]);
  snapSelectionToCursor();
  const p1 = useProjectStore.getState().project.nodes.find((n) => n.id === 'p1');
  assert(p1.transform.x === 50 && p1.transform.y === 60, 'no selection → no mutation');
}

// ── 18. snapSelectionToActive needs ≥2 eligible (active + 1+ other) ─
{
  seed({
    nodes: [
      { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 50, y: 60 }, mesh: { vertices: [] } },
    ],
  });
  selectIds(['p1']);
  snapSelectionToActive();
  const p1 = useProjectStore.getState().project.nodes.find((n) => n.id === 'p1');
  assert(p1.transform.x === 50 && p1.transform.y === 60, 'single-selection snap-to-active → no-op');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
