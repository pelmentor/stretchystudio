// Toolset Plan Phase 7.B.5 — Normalize All Vertex Groups.
//
// Verifies `normalizeAllWeights`:
//   - per-vertex sum across all groups → divide each by sum
//   - already-normalized vertices skipped (no-op)
//   - zero-sum vertices skipped (left at zero)
//   - eligibleForNormalize gates correctly
//   - active group sync (mesh.boneWeights mirrored)
//
// Run: node scripts/test/test_weightPaint_normalize.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import {
  normalizeAllWeights, eligibleForNormalize,
} from '../../src/v3/operators/weightPaint/normalize.js';
import { clearHistory } from '../../src/store/undoHistory.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function nearlyEq(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

function seed(meshOverrides) {
  clearHistory();
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 34,
      canvas: { width: 800, height: 600 }, cursor: { x: 400, y: 300 },
      textures: [], animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
      nodes: [
        { id: 'p1', type: 'part', parent: null,
          weightPaintSettings: { xMirror: false },
          mesh: {
            vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
            triangles: [0, 1, 2],
            ...meshOverrides,
          },
        },
      ],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useEditorStore.setState({
    editMode: 'weightPaint', selection: ['p1'],
  });
}

// ── 1. typical normalize: 3-group character vertex ─────────────────
{
  // v0: arm=0.4, body=0.4, head=0; sum=0.8 → 0.5, 0.5, 0
  // v1: arm=1, body=1, head=1; sum=3 → 1/3, 1/3, 1/3
  // v2: arm=2, body=0, head=0; sum=2 → 1, 0, 0
  seed({
    weightGroups: {
      arm:  [0.4, 1, 2],
      body: [0.4, 1, 0],
      head: [0,   1, 0],
    },
    activeWeightGroup: 'arm',
  });
  const r = normalizeAllWeights();
  assert(!r.skipped, 'not skipped');
  assert(r.normalized === 3, `3 verts normalized, got ${r.normalized}`);
  assert(r.zeroSumVerts === 0, 'no zero-sum');
  const w = useProjectStore.getState().project.nodes[0].mesh.weightGroups;
  assert(nearlyEq(w.arm[0], 0.5) && nearlyEq(w.body[0], 0.5) && nearlyEq(w.head[0], 0),
    `v0 → 0.5/0.5/0, got ${w.arm[0]}/${w.body[0]}/${w.head[0]}`);
  assert(nearlyEq(w.arm[1], 1/3) && nearlyEq(w.body[1], 1/3) && nearlyEq(w.head[1], 1/3),
    `v1 → 1/3 each`);
  assert(nearlyEq(w.arm[2], 1) && nearlyEq(w.body[2], 0) && nearlyEq(w.head[2], 0),
    `v2 → 1/0/0`);
  // Sum check
  for (let i = 0; i < 3; i++) {
    const s = w.arm[i] + w.body[i] + w.head[i];
    assert(nearlyEq(s, 1) || nearlyEq(s, 0),
      `v${i} sum = 1, got ${s}`);
  }
}

// ── 2. zero-sum verts left alone ──────────────────────────────────
{
  seed({
    weightGroups: {
      g1: [0, 0.5, 0],
      g2: [0, 0.5, 0],
    },
    activeWeightGroup: 'g1',
  });
  const r = normalizeAllWeights();
  assert(!r.skipped, 'not skipped');
  assert(r.zeroSumVerts === 2, `2 zero-sum verts, got ${r.zeroSumVerts}`);
  assert(r.normalized === 0, 'middle vert already at sum=1, no normalize needed');
  const w = useProjectStore.getState().project.nodes[0].mesh.weightGroups;
  assert(w.g1[0] === 0 && w.g1[2] === 0, 'zero-sum verts unchanged');
}

// ── 3. mesh.boneWeights mirrored when active group rewritten ──────
{
  seed({
    weightGroups: {
      arm:  [2, 0, 0],   // active
      body: [0, 0, 0],
    },
    activeWeightGroup: 'arm',
  });
  normalizeAllWeights();
  const mesh = useProjectStore.getState().project.nodes[0].mesh;
  assert(nearlyEq(mesh.weightGroups.arm[0], 1), 'arm[0] = 1');
  assert(Array.isArray(mesh.boneWeights), 'boneWeights present');
  assert(nearlyEq(mesh.boneWeights[0], 1),
    `boneWeights mirrored, got ${mesh.boneWeights[0]}`);
}

// ── 4. eligibleForNormalize gates ─────────────────────────────────
{
  // Wrong mode
  seed({ weightGroups: { g1: [1, 1, 1] }, activeWeightGroup: 'g1' });
  useEditorStore.setState({ editMode: 'edit', selection: ['p1'] });
  assert(eligibleForNormalize() === false, 'edit mode → ineligible');
  // weightPaint with no selection
  useEditorStore.setState({ editMode: 'weightPaint', selection: [] });
  assert(eligibleForNormalize() === false, 'no selection → ineligible');
  // weightPaint, valid selection
  useEditorStore.setState({ editMode: 'weightPaint', selection: ['p1'] });
  assert(eligibleForNormalize() === true, 'has weights → eligible');
  // No weight groups → ineligible
  seed({ weightGroups: {} });
  useEditorStore.setState({ editMode: 'weightPaint', selection: ['p1'] });
  assert(eligibleForNormalize() === false, 'no groups → ineligible');
}

// ── 5. all-zero groups → skipped ─────────────────────────────────
{
  seed({
    weightGroups: { g1: [0, 0, 0], g2: [0, 0, 0] },
    activeWeightGroup: 'g1',
  });
  const r = normalizeAllWeights();
  // skipped:false because we did the analysis (groupCount/vertexCount in result),
  // but normalized:0 because every vert is zero-sum.
  assert(r.skipped === false, 'not skipped');
  assert(r.normalized === 0, 'all-zero → no normalize');
  assert(r.zeroSumVerts === 3, '3 zero-sum');
}

// ── 6. group-length mismatch → skipped ────────────────────────────
{
  seed({
    weightGroups: { g1: [1, 1, 1], g2: [1, 1] },  // length mismatch
    activeWeightGroup: 'g1',
  });
  const r = normalizeAllWeights();
  assert(r.skipped === true, 'mismatch → skipped');
  assert(r.normalized === 0, 'no work done');
}

// ── 7. already-normalized verts left alone ───────────────────────
{
  // v0: 0.3 + 0.7 = 1.0; v1: 0.5 + 0.5 = 1.0
  seed({
    weightGroups: { g1: [0.3, 0.5], g2: [0.7, 0.5] },
    activeWeightGroup: 'g1',
  });
  // For seed with 2 verts:
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: [{
        ...useProjectStore.getState().project.nodes[0],
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
          triangles: [0, 1, 0],
          weightGroups: { g1: [0.3, 0.5], g2: [0.7, 0.5] },
          activeWeightGroup: 'g1',
        },
      }],
    },
    hasUnsavedChanges: false,
  });
  const r = normalizeAllWeights();
  assert(r.normalized === 0,
    `already-normalized verts skipped, got normalized=${r.normalized}`);
  const g1 = useProjectStore.getState().project.nodes[0].mesh.weightGroups.g1;
  assert(nearlyEq(g1[0], 0.3) && nearlyEq(g1[1], 0.5), 'unchanged');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
