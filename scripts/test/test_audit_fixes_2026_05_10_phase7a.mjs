// Pins for Phase 7.A audit-fix sweep (2026-05-10).
//
// 5 HIGH + 1 MED + 6 cite fixes (D-4..D-9) FIXED.
// G-4 + D-10 + D-11 + D-12 + D-13 DOCUMENTED-AS-DEVIATION.
//
// Each assertion locks in either:
//   - a behavior change (FIX) the audit demanded
//   - a documentation banner (DOCUMENT-AS-DEVIATION) so future audits
//     don't re-flag the same deviation
//
// Run: node scripts/test/test_audit_fixes_2026_05_10_phase7a.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { useEditMenuStore } from '../../src/store/editMenuStore.js';
import { undo, undoCount, clearHistory } from '../../src/store/undoHistory.js';
import { meanOfOrigins, snapSelectionToCursor } from '../../src/v3/operators/object/snap.js';
import { mirrorSelected } from '../../src/v3/operators/object/mirror.js';
import { setParent, clearParent } from '../../src/v3/operators/object/parent.js';
import { setOriginForSelection } from '../../src/v3/operators/object/setOrigin.js';
import { computeWorldMatrices } from '../../src/renderer/transforms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, '../..');
const READ = (p) => readFileSync(resolve(REPO, p), 'utf8');

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

function seed(nodes, cursor = { x: 400, y: 300 }) {
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

// ════════════════════════════════════════════════════════════════════
// G-1 (HIGH) — beginBatch passes project; Ctrl+Z reverses snap ops
// ════════════════════════════════════════════════════════════════════

// Static cite: every snap.js / mirror.js / parent.js / setOrigin.js
// `beginBatch(` call has the `project` argument.
{
  for (const file of [
    'src/v3/operators/object/snap.js',
    'src/v3/operators/object/mirror.js',
    'src/v3/operators/object/parent.js',
    'src/v3/operators/object/setOrigin.js',
  ]) {
    const src = READ(file);
    const beginCalls = [...src.matchAll(/beginBatch\(([^)]*)\)/g)];
    // Filter out the `import { beginBatch }` line which doesn't have an arg.
    const exec = beginCalls.filter((m) => !src.slice(0, m.index).endsWith('import { '));
    for (const m of exec) {
      const arg = m[1].trim();
      const isImport = src.slice(Math.max(0, m.index - 80), m.index).includes('import {');
      if (isImport) continue;
      assert(arg === 'project', `G-1: ${file} beginBatch(${arg}) — expected beginBatch(project)`);
    }
  }
}

// Behavioural: snap mutations are reversible via Ctrl+Z.
{
  seed([
    { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 100, y: 100 }, mesh: { vertices: [] } },
    { id: 'p2', type: 'part', parent: null, transform: { ...ident(), x: 200, y: 200 }, mesh: { vertices: [] } },
  ]);
  useSelectionStore.setState({
    items: [{ type: 'part', id: 'p1' }, { type: 'part', id: 'p2' }],
  });
  const project = useProjectStore.getState().project;
  // Capture pre-snap positions.
  const preP1 = { x: project.nodes[0].transform.x, y: project.nodes[0].transform.y };
  const preP2 = { x: project.nodes[1].transform.x, y: project.nodes[1].transform.y };
  snapSelectionToCursor();
  // Undo.
  assert(undoCount() >= 1, `G-1: undo stack populated, count=${undoCount()}`);
  const updateProject = useProjectStore.getState().updateProject;
  undo(useProjectStore.getState().project, (snapshot) => {
    updateProject((proj) => Object.assign(proj, snapshot), { skipHistory: true });
  });
  const post = useProjectStore.getState().project.nodes;
  assert(post[0].transform.x === preP1.x && post[0].transform.y === preP1.y,
    `G-1: undo restores p1 to pre-snap (${preP1.x},${preP1.y}), got (${post[0].transform.x},${post[0].transform.y})`);
  assert(post[1].transform.x === preP2.x && post[1].transform.y === preP2.y,
    'G-1: undo restores p2');
}

// ════════════════════════════════════════════════════════════════════
// G-2 (HIGH) — geometryVersion in CanvasViewport mesh-sync deps
// ════════════════════════════════════════════════════════════════════
{
  const src = READ('src/components/canvas/CanvasViewport.jsx');
  assert(src.includes('lastUploadedGeomVersionRef'),
    'G-2: lastUploadedGeomVersionRef ref present');
  assert(src.includes('versionControl.geometryVersion ?? 0'),
    'G-2: reads versionControl.geometryVersion');
  // Effect dep array includes geometryVersion.
  const depMatch = src.match(/\}, \[project\.nodes, project\.textures, versionControl\.textureVersion, versionControl\.geometryVersion\]\);/);
  assert(depMatch !== null,
    'G-2: mesh-sync useEffect dep array includes versionControl.geometryVersion');
  assert(src.includes('Audit fix G-2'), 'G-2: comment present');
}

// ════════════════════════════════════════════════════════════════════
// G-3 (MED) — Esc handlers in 3 popovers stopPropagation
// ════════════════════════════════════════════════════════════════════
{
  for (const file of ['SnapMenu.jsx', 'ClearParentMenu.jsx', 'SetOriginMenu.jsx']) {
    const src = READ(`src/v3/shell/${file}`);
    // The Esc branch must call stopPropagation.
    const escBlock = src.indexOf("if (e.key === 'Escape')");
    assert(escBlock >= 0, `G-3: ${file} has Escape handler`);
    const escEnd = src.indexOf('}', escBlock + 100);
    const block = src.slice(escBlock, escEnd);
    assert(block.includes('e.stopPropagation()'),
      `G-3: ${file} Escape branch calls stopPropagation`);
  }
}

// MirrorAxisMenu was already immunized — pin that it stays.
{
  const src = READ('src/v3/shell/MirrorAxisMenu.jsx');
  assert(src.includes('e.stopPropagation()'),
    'G-3: MirrorAxisMenu retains stopPropagation');
}

// ════════════════════════════════════════════════════════════════════
// G-4 (DOCUMENT-AS-DEVIATION) — Shift+S no Edit Mode gate yet
// ════════════════════════════════════════════════════════════════════
{
  const src = READ('src/v3/keymap/default.js');
  assert(src.includes('G-4 (DOCUMENT-AS-DEVIATION)'),
    'G-4: deviation banner in default.js');
  assert(/Phase 7\.B.*vertex.snap/i.test(src) || /Phase 7\.B/.test(src),
    'G-4: defers to Phase 7.B');
}

// ════════════════════════════════════════════════════════════════════
// D-1 (HIGH) — clearParent('inverse') no-ops + toast; KEEPS parent
// ════════════════════════════════════════════════════════════════════
{
  seed([
    { id: 'p', type: 'group', parent: null, transform: ident() },
    { id: 'c', type: 'part', parent: 'p', transform: ident(), mesh: { vertices: [] } },
  ]);
  useSelectionStore.setState({ items: [{ type: 'part', id: 'c' }] });
  const r = clearParent('inverse');
  assert(r.cleared === 0 && r.inverseUnsupported === true,
    `D-1: inverse no-ops (cleared=0, inverseUnsupported=true), got ${JSON.stringify(r)}`);
  const c = useProjectStore.getState().project.nodes.find((n) => n.id === 'c');
  assert(c.parent === 'p', 'D-1: parent NOT cleared in inverse mode');
}

// Static cite: clearParent doc references object_relations.cc:411-420
{
  const src = READ('src/v3/operators/object/parent.js');
  assert(src.includes('object_relations.cc:411-420') || src.includes(':411-420'),
    'D-1: cite to Blender CLEAR_PARENT_INVERSE source range');
}

// ════════════════════════════════════════════════════════════════════
// D-2 (HIGH) — meanOfOrigins replaces medianOfOrigins; arithmetic mean
// ════════════════════════════════════════════════════════════════════
{
  // Function exists with new name; old name removed.
  const src = READ('src/v3/operators/object/snap.js');
  assert(src.includes('export function meanOfOrigins'),
    'D-2: meanOfOrigins exported');
  assert(!/^export const medianOfOrigins\s*=/m.test(src),
    'D-2: old medianOfOrigins alias removed (Rule №2 — no migration baggage)');
  // Behavioural: 3-element check the audit's example case.
  // Origins (0,0), (100,0), (200,100) → mean (100, 33.333...). Pre-fix
  // statistical median per-axis would have been (100, 0).
  seed([
    { id: 'p1', type: 'part', parent: null, transform: { ...ident(), x: 0, y: 0 }, mesh: { vertices: [] } },
    { id: 'p2', type: 'part', parent: null, transform: { ...ident(), x: 100, y: 0 }, mesh: { vertices: [] } },
    { id: 'p3', type: 'part', parent: null, transform: { ...ident(), x: 200, y: 100 }, mesh: { vertices: [] } },
  ]);
  const wm = computeWorldMatrices(useProjectStore.getState().project.nodes);
  const m = meanOfOrigins(['p1', 'p2', 'p3'], wm);
  assert(nearlyEq(m.x, 100) && nearlyEq(m.y, 100/3),
    `D-2: mean = (100, 33.33), got (${m.x},${m.y})`);
}

// ════════════════════════════════════════════════════════════════════
// D-3 (HIGH) — SnapMenu has 8 items (4+4), not 9
// ════════════════════════════════════════════════════════════════════
{
  const src = READ('src/v3/shell/SnapMenu.jsx');
  // Count COLUMN_LEFT items (object literal entries).
  const leftMatch = src.match(/const COLUMN_LEFT = \[([\s\S]*?)\];/);
  const rightMatch = src.match(/const COLUMN_RIGHT = \[([\s\S]*?)\];/);
  assert(leftMatch !== null && rightMatch !== null, 'D-3: COLUMN_LEFT + COLUMN_RIGHT defined');
  if (leftMatch && rightMatch) {
    const leftCount = (leftMatch[1].match(/\{ id:/g) ?? []).length;
    const rightCount = (rightMatch[1].match(/\{ id:/g) ?? []).length;
    assert(leftCount === 4, `D-3: COLUMN_LEFT has 4 items, got ${leftCount}`);
    assert(rightCount === 4, `D-3: COLUMN_RIGHT has 4 items, got ${rightCount}`);
    assert(!leftMatch[1].includes('selectionToWorldOrigin'),
      'D-3: Selection to World Origin removed from menu');
  }
}

// ════════════════════════════════════════════════════════════════════
// D-4..D-9 (FIX) — source citation drift corrected
// ════════════════════════════════════════════════════════════════════
{
  // D-4: snap.js + setOrigin.js + registry use correct file/line refs.
  const snap = READ('src/v3/operators/object/snap.js');
  assert(snap.includes('view3d_snap.cc'), 'D-4: snap.js cites view3d_snap.cc');
  assert(snap.includes('audit fix D-4'), 'D-4: snap.js banner present');

  const setOrigin = READ('src/v3/operators/object/setOrigin.js');
  assert(setOrigin.includes('object_transform.cc:1873'),
    'D-4: setOrigin.js cites :1873 for OBJECT_OT_origin_set');

  // D-5: keymap default.js cites correct lines.
  const km = READ('src/v3/keymap/default.js');
  assert(km.includes('blender_default.py:1833'), 'D-5: Shift+S cite :1833 (km_view3d_generic)');
  assert(km.includes('blender_default.py:4509'), 'D-5: Ctrl+P cite :4509');
  assert(km.includes('blender_default.py:4510'), 'D-5: Alt+P cite :4510');
  assert(km.includes('blender_default.py:4512'), 'D-5: Ctrl+M cite :4512');

  // D-6: SnapMenu cites :6181-6203
  const snapMenu = READ('src/v3/shell/SnapMenu.jsx');
  assert(snapMenu.includes('space_view3d.py:6181-6203'),
    'D-6: SnapMenu cites :6181-6203 for VIEW3D_MT_snap_pie');

  // D-7: ClearParentMenu cites object_relations.cc:444 (or :315 for enum)
  const clearMenu = READ('src/v3/shell/ClearParentMenu.jsx');
  assert(clearMenu.includes('object_relations.cc:444'),
    'D-7: ClearParentMenu cites :444 for OBJECT_OT_parent_clear');

  // D-8: parent.js cites object_relations.cc:1100 for OBJECT_OT_parent_set
  const parent = READ('src/v3/operators/object/parent.js');
  assert(parent.includes('object_relations.cc:1100'),
    'D-8: parent.js cites :1100 for OBJECT_OT_parent_set');

  // D-9: mirror.js + MirrorAxisMenu cite transform_ops.cc:1172
  const mirror = READ('src/v3/operators/object/mirror.js');
  assert(mirror.includes('transform_ops.cc:1172'),
    'D-9: mirror.js cites :1172 for TRANSFORM_OT_mirror');
  const mirrorMenu = READ('src/v3/shell/MirrorAxisMenu.jsx');
  assert(mirrorMenu.includes('transform_ops.cc:1172'),
    'D-9: MirrorAxisMenu cites :1172');
}

// ════════════════════════════════════════════════════════════════════
// D-10 / D-11 / D-12 / D-13 (DOCUMENT-AS-DEVIATION) — banners present
// ════════════════════════════════════════════════════════════════════
{
  const setOrigin = READ('src/v3/operators/object/setOrigin.js');
  assert(setOrigin.includes('Audit D-10 (DOCUMENT-AS-DEVIATION)'),
    'D-10: meshMedian banner');
  assert(setOrigin.includes('Audit D-11 (DOCUMENT-AS-DEVIATION)'),
    'D-11: meshBBoxCenter banner');
  const setOriginMenu = READ('src/v3/shell/SetOriginMenu.jsx');
  assert(setOriginMenu.includes('Audit D-12'),
    'D-12: SetOriginMenu banner for missing Geometry to Origin');
  const snap = READ('src/v3/operators/object/snap.js');
  assert(snap.includes('Audit D-13'),
    'D-13: readCursor banner for canvas-centre vs world-origin default');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
