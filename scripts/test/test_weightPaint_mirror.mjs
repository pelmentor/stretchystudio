// Toolset Plan Phase 7.B.3 — Mirror Weights.
//
// Verifies:
//   - buildMirrorVertexMap: pairs vertices via X-axis reflection
//   - pairGroupNames: detects L/R suffix pairings
//   - findGroupPairs: discovers all pairs in a group set
//   - mirrorWeights('topology'): copies active group through vertex map
//   - mirrorWeights('byName'): swaps L/R groups via vertex map
//   - eligibleForMirror: gates correctly
//
// Run: node scripts/test/test_weightPaint_mirror.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import {
  buildMirrorVertexMap, pairGroupNames, findGroupPairs,
  mirrorWeights, eligibleForMirror,
} from '../../src/v3/operators/weightPaint/mirror.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function nearlyEq(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

// ── 1. buildMirrorVertexMap pairs symmetric quad ───────────────────
{
  // Symmetric across x=5: (0,0) ↔ (10,0); (3,8) ↔ (7,8).
  const verts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 8 }, { x: 7, y: 8 }];
  const m = buildMirrorVertexMap(verts, 'x');
  assert(m.get(0) === 1 && m.get(1) === 0, '0↔1 paired');
  assert(m.get(2) === 3 && m.get(3) === 2, '2↔3 paired');
}

// ── 2. vertex on axis pairs with itself ────────────────────────────
{
  const verts = [{ x: 5, y: 0 }, { x: 0, y: 8 }, { x: 10, y: 8 }];
  const m = buildMirrorVertexMap(verts, 'x');
  assert(m.get(0) === 0, 'on-axis vertex self-pairs');
  assert(m.get(1) === 2 && m.get(2) === 1, 'off-axis paired');
}

// ── 3. unpaired vertex absent from map ────────────────────────────
{
  const verts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 8 }];  // (3,8) unpaired
  const m = buildMirrorVertexMap(verts, 'x');
  assert(m.get(0) === 1 && m.get(1) === 0, 'paired pair');
  assert(!m.has(2), 'unpaired absent');
}

// ── 4. flat-array verts supported ─────────────────────────────────
{
  const flat = [0, 0, 10, 0, 5, 8];  // v0=(0,0), v1=(10,0), v2=(5,8) on axis
  const m = buildMirrorVertexMap(flat, 'x');
  assert(m.get(0) === 1 && m.get(1) === 0, 'flat 0↔1');
  assert(m.get(2) === 2, 'flat axis self-pair');
}

// ── 5. y-axis mode supported ──────────────────────────────────────
{
  // Mirror across y=5: (0,0) ↔ (0,10), (8,3) ↔ (8,7).
  const verts = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 8, y: 3 }, { x: 8, y: 7 }];
  const m = buildMirrorVertexMap(verts, 'y');
  assert(m.get(0) === 1 && m.get(1) === 0, 'y 0↔1');
  assert(m.get(2) === 3, 'y 2↔3');
}

// ── 6. z-axis returns empty (2D no-op) ────────────────────────────
{
  const verts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const m = buildMirrorVertexMap(verts, 'z');
  assert(m.size === 0, 'z empty');
}

// ── 7. pairGroupNames _L/_R ───────────────────────────────────────
{
  assert(pairGroupNames('arm_L', 'arm_R')?.left === 'arm_L', '_L → left');
  assert(pairGroupNames('arm_L', 'arm_R')?.right === 'arm_R', '_R → right');
  assert(pairGroupNames('arm_R', 'arm_L')?.left === 'arm_L', 'order-independent');
  assert(pairGroupNames('arm.L', 'arm.R')?.right === 'arm.R', '.R suffix');
  assert(pairGroupNames('handLeft', 'handRight')?.left === 'handLeft', 'Left/Right suffix');
  assert(pairGroupNames('arm_L', 'leg_R') === null, 'mismatched bases → null');
  assert(pairGroupNames('arm', 'arm') === null, 'no suffix → null');
  assert(pairGroupNames('_L', '_R') === null, 'empty base rejected');
}

// ── 8. findGroupPairs ─────────────────────────────────────────────
{
  const pairs = findGroupPairs(['arm_L', 'arm_R', 'leg_L', 'leg_R', 'spine']);
  assert(pairs.length === 2, `2 pairs, got ${pairs.length}`);
  assert(pairs.some((p) => p.left === 'arm_L' && p.right === 'arm_R'), 'arm pair');
  assert(pairs.some((p) => p.left === 'leg_L' && p.right === 'leg_R'), 'leg pair');
}

// ── 9. mirrorWeights topology mode ────────────────────────────────
function seedSymmetric() {
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 34,
      canvas: { width: 800, height: 600, x: 0, y: 0 },
      cursor: { x: 400, y: 300 },
      textures: [],
      nodes: [
        { id: 'p1', type: 'part', parent: null,
          weightPaintSettings: { xMirror: false },
          mesh: {
            // Symmetric across x=5: 0↔1, 2↔3
            vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 8 }, { x: 7, y: 8 }],
            triangles: [0, 1, 2, 1, 3, 2],
            weightGroups: {
              left:  [1.0, 0.0, 0.8, 0.0],   // weight on left-side verts
              right: [0.0, 1.0, 0.0, 0.8],   // weight on right-side verts
            },
            activeWeightGroup: 'left',
          },
        },
      ],
      animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useEditorStore.setState({
    editMode: 'weightPaint',
    selection: ['p1'],
  });
  useSelectionStore.setState({ items: [{ type: 'part', id: 'p1' }] });
}

{
  seedSymmetric();
  const r = mirrorWeights({ axis: 'x', mode: 'topology' });
  assert(!r.skipped, 'not skipped');
  assert(r.mirrored === 1, 'one group mirrored');
  assert(r.vertexPairs >= 4, `4 vertex pairs (incl self-pair singletons), got ${r.vertexPairs}`);
  // After mirror via topology: active group = 'left' [1,0,0.8,0], so v0=1
  // copies to v1; v1=0 copies to v0; v2=0.8 copies to v3; v3=0 copies to v2.
  // Net: [0, 1, 0, 0.8].
  const after = useProjectStore.getState().project.nodes[0].mesh.weightGroups.left;
  assert(nearlyEq(after[0], 0), `v0 → 0 (was v1=0), got ${after[0]}`);
  assert(nearlyEq(after[1], 1), `v1 → 1 (was v0=1), got ${after[1]}`);
  assert(nearlyEq(after[2], 0), `v2 → 0`);
  assert(nearlyEq(after[3], 0.8), `v3 → 0.8`);
}

// ── 10. mirrorWeights byName mode ────────────────────────────────
{
  // Set up groups paired by name.
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 34,
      canvas: { width: 800, height: 600, x: 0, y: 0 },
      cursor: { x: 400, y: 300 },
      textures: [],
      nodes: [
        { id: 'p1', type: 'part', parent: null,
          weightPaintSettings: { xMirror: false },
          mesh: {
            vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 8 }, { x: 7, y: 8 }],
            triangles: [0, 1, 2, 1, 3, 2],
            weightGroups: {
              arm_L: [1.0, 0.0, 0.5, 0.0],
              arm_R: [0.0, 0.0, 0.0, 0.0],   // empty — gets filled by mirror
              other: [0.5, 0.5, 0.5, 0.5],
            },
            activeWeightGroup: 'arm_L',
          },
        },
      ],
      animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useEditorStore.setState({ editMode: 'weightPaint', selection: ['p1'] });
  useSelectionStore.setState({ items: [{ type: 'part', id: 'p1' }] });
  const r = mirrorWeights({ axis: 'x', mode: 'byName' });
  assert(!r.skipped, 'byName not skipped');
  assert(r.groupPairs === 1, `1 group pair, got ${r.groupPairs}`);
  assert(r.mirrored === 1, '1 pair processed');
  const arm_L = useProjectStore.getState().project.nodes[0].mesh.weightGroups.arm_L;
  const arm_R = useProjectStore.getState().project.nodes[0].mesh.weightGroups.arm_R;
  // arm_L was [1, 0, 0.5, 0]; arm_R copies arm_L's weight at the mirrored
  // index. v0↔v1 → arm_R[1] = arm_L[0] = 1; arm_R[0] = arm_L[1] = 0.
  // v2↔v3 → arm_R[3] = arm_L[2] = 0.5; arm_R[2] = arm_L[3] = 0.
  // arm_L receives the (originally empty) arm_R values too.
  assert(nearlyEq(arm_R[0], 0), `arm_R[0] = 0, got ${arm_R[0]}`);
  assert(nearlyEq(arm_R[1], 1), `arm_R[1] = 1, got ${arm_R[1]}`);
  assert(nearlyEq(arm_R[3], 0.5), `arm_R[3] = 0.5, got ${arm_R[3]}`);
  // arm_L receives arm_R's original (zero) weights at mirrored positions.
  assert(nearlyEq(arm_L[0], 0), `arm_L[0] = 0 (from arm_R[1]=0), got ${arm_L[0]}`);
  // 'other' is not paired — left untouched.
  const other = useProjectStore.getState().project.nodes[0].mesh.weightGroups.other;
  assert(nearlyEq(other[0], 0.5) && nearlyEq(other[1], 0.5),
    'unpaired group untouched');
}

// ── 11. eligibleForMirror gates correctly ────────────────────────
{
  // Outside weightPaint mode → false
  useEditorStore.setState({ editMode: 'edit', selection: ['p1'] });
  assert(eligibleForMirror() === false, 'edit mode → not eligible');
  // weightPaint with no selection → false
  useEditorStore.setState({ editMode: 'weightPaint', selection: [] });
  assert(eligibleForMirror() === false, 'no selection → not eligible');
}

// ── 12. unsupported axis returns skipped ─────────────────────────
{
  seedSymmetric();
  const r = mirrorWeights({ axis: 'z', mode: 'topology' });
  assert(r.skipped === true, 'z axis skipped');
  assert(r.mirrored === 0, 'no mirror');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
