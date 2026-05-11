// Toolset Plan Phase 7.B.1 — Sample Weight (eyedropper).
//
// Verifies `sampleWeightAt`:
//   - picks closest vertex within threshold
//   - writes editorStore.brushWeight
//   - returns { sampled, weight, vertexIndex }
//   - no-op outside weightPaint mode / no selection / no part / no mesh
//   - clamps sampled value to [0, 1]
//
// Run: node scripts/test/test_weightPaint_sample.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { sampleWeightAt } from '../../src/v3/operators/weightPaint/sample.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function nearlyEq(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

function seedPart(meshOverrides = {}) {
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
            vertices: [
              { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 },
            ],
            triangles: [0, 1, 2],
            weightGroups: { bone: [0.1, 0.5, 0.9] },
            activeWeightGroup: 'bone',
            ...meshOverrides,
          },
        },
      ],
      animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
}

// ── 1. sample picks closest vertex ──────────────────────────────────
{
  seedPart();
  useEditorStore.setState({
    editMode: 'weightPaint',
    selection: ['p1'],
    viewByMode: { ...useEditorStore.getState().viewByMode,
      viewport: { zoom: 1, panX: 0, panY: 0 } },
    brushWeight: 0,
    brushSize: 50,
  });
  const r = sampleWeightAt({ clientX: 0, clientY: 0, rect: { left: 0, top: 0 } });
  assert(r.sampled === true, 'sampled');
  assert(r.vertexIndex === 0, `picked v0, got ${r.vertexIndex}`);
  assert(nearlyEq(r.weight, 0.1), `weight 0.1, got ${r.weight}`);
  assert(nearlyEq(useEditorStore.getState().brushWeight, 0.1),
    `brushWeight written, got ${useEditorStore.getState().brushWeight}`);
}

// ── 2. picks middle vertex when cursor between ─────────────────────
{
  seedPart();
  useEditorStore.setState({
    editMode: 'weightPaint',
    selection: ['p1'],
    viewByMode: { ...useEditorStore.getState().viewByMode,
      viewport: { zoom: 1, panX: 0, panY: 0 } },
    brushSize: 200,
  });
  // Cursor at (98, 0) — closer to v1 (100,0) than v0 (0,0).
  const r = sampleWeightAt({ clientX: 98, clientY: 0, rect: { left: 0, top: 0 } });
  assert(r.vertexIndex === 1, `picked v1, got ${r.vertexIndex}`);
  assert(nearlyEq(r.weight, 0.5), `v1 weight 0.5`);
}

// ── 3. respects threshold (no pick outside radius) ─────────────────
{
  seedPart();
  useEditorStore.setState({
    editMode: 'weightPaint',
    selection: ['p1'],
    viewByMode: { ...useEditorStore.getState().viewByMode,
      viewport: { zoom: 1, panX: 0, panY: 0 } },
    brushSize: 5,
  });
  // Cursor far from all verts; brushSize/2 = 2.5; nothing within range.
  const r = sampleWeightAt({ clientX: 500, clientY: 500, rect: { left: 0, top: 0 } });
  assert(r.sampled === false, 'no pick outside threshold');
  assert(r.vertexIndex === null, 'no vertex returned');
}

// ── 4. explicit threshold override ─────────────────────────────────
{
  seedPart();
  useEditorStore.setState({
    editMode: 'weightPaint',
    selection: ['p1'],
    viewByMode: { ...useEditorStore.getState().viewByMode,
      viewport: { zoom: 1, panX: 0, panY: 0 } },
    brushSize: 5,
  });
  // Cursor 120 px from v1 — too far for default brushSize/2=2.5 but
  // within explicit 200 px threshold.
  const r = sampleWeightAt({
    clientX: 220, clientY: 0, rect: { left: 0, top: 0 }, threshold: 200,
  });
  assert(r.sampled === true, 'sampled with override threshold');
  assert(r.vertexIndex === 1, `closest is v1, got ${r.vertexIndex}`);
}

// ── 5. no-op outside weightPaint mode ──────────────────────────────
{
  seedPart();
  useEditorStore.setState({
    editMode: 'edit',
    selection: ['p1'],
  });
  const r = sampleWeightAt({ clientX: 0, clientY: 0, rect: { left: 0, top: 0 } });
  assert(r.sampled === false, 'edit mode → no sample');
}

// ── 6. no-op when no selection ────────────────────────────────────
{
  seedPart();
  useEditorStore.setState({
    editMode: 'weightPaint',
    selection: [],
  });
  const r = sampleWeightAt({ clientX: 0, clientY: 0, rect: { left: 0, top: 0 } });
  assert(r.sampled === false, 'no selection → no sample');
}

// ── 7. no-op when selected isn't a part ───────────────────────────
{
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 34,
      canvas: { width: 800, height: 600 }, cursor: { x: 400, y: 300 },
      textures: [], animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
      nodes: [{ id: 'g', type: 'group', parent: null }],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useEditorStore.setState({
    editMode: 'weightPaint', selection: ['g'],
  });
  const r = sampleWeightAt({ clientX: 0, clientY: 0, rect: { left: 0, top: 0 } });
  assert(r.sampled === false, 'group selected → no sample');
}

// ── 8. clamps to [0,1] ────────────────────────────────────────────
{
  seedPart({ weightGroups: { bone: [-0.5, 1.5, 0.5] }, activeWeightGroup: 'bone' });
  useEditorStore.setState({
    editMode: 'weightPaint',
    selection: ['p1'],
    viewByMode: { ...useEditorStore.getState().viewByMode,
      viewport: { zoom: 1, panX: 0, panY: 0 } },
    brushSize: 50,
  });
  const r0 = sampleWeightAt({ clientX: 0, clientY: 0, rect: { left: 0, top: 0 } });
  assert(r0.weight === 0, `negative clamped to 0, got ${r0.weight}`);
  const r1 = sampleWeightAt({ clientX: 100, clientY: 0, rect: { left: 0, top: 0 } });
  assert(r1.weight === 1, `>1 clamped to 1, got ${r1.weight}`);
}

// ── 9. zoom + pan applied to projection ───────────────────────────
{
  seedPart();
  useEditorStore.setState({
    editMode: 'weightPaint',
    selection: ['p1'],
    viewByMode: { ...useEditorStore.getState().viewByMode,
      viewport: { zoom: 2, panX: 10, panY: 5 } },
    brushSize: 50,
  });
  // v1 at canvas (100, 0); projected = (100*2 + 10, 0*2 + 5) = (210, 5).
  const r = sampleWeightAt({ clientX: 210, clientY: 5, rect: { left: 0, top: 0 } });
  assert(r.vertexIndex === 1, `zoom + pan projection, got v${r.vertexIndex}`);
}

// ── 10. fallback to mesh.boneWeights when no activeWeightGroup ────
{
  seedPart({ boneWeights: [0.2, 0.4, 0.6], activeWeightGroup: null });
  useEditorStore.setState({
    editMode: 'weightPaint',
    selection: ['p1'],
    viewByMode: { ...useEditorStore.getState().viewByMode,
      viewport: { zoom: 1, panX: 0, panY: 0 } },
    brushSize: 50,
  });
  const r = sampleWeightAt({ clientX: 0, clientY: 0, rect: { left: 0, top: 0 } });
  assert(nearlyEq(r.weight, 0.2),
    `boneWeights fallback v0=0.2, got ${r.weight}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
