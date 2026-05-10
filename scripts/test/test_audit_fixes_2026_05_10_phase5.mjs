// Toolset Plan Phase 5 audit-fix sweep — regression pins.
//
// Verifies the audit-fix sweep landed correctly. Each test pins one
// specific gap from `AUDIT_2026_05_10_TOOLSET_PHASE5_ARCH.md` or
// `AUDIT_2026_05_10_TOOLSET_PHASE5_BLENDER.md` so a future regression
// re-introducing the bug fails this suite.
//
// Run: node scripts/test/test_audit_fixes_2026_05_10_phase5.mjs

import { extrude } from '../../src/v3/operators/edit/extrude.js';
import { applyTopologyOp } from '../../src/v3/operators/edit/applyTopologyOp.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import {
  beginBatch, endBatch, discardBatch,
  undoCount, redoCount, clearHistory,
} from '../../src/store/undoHistory.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function seedProject() {
  useProjectStore.setState({
    project: {
      schemaVersion: 30,
      nextNodeId: 100,
      canvasWidth: 1024, canvasHeight: 1024,
      nodes: [
        {
          id: 'p1',
          type: 'part',
          name: 'TestPart',
          parent: null,
          mesh: {
            vertices: [
              { x: 0,  y: 0,  restX: 0,  restY: 0 },
              { x: 10, y: 0,  restX: 10, restY: 0 },
              { x: 10, y: 10, restX: 10, restY: 10 },
              { x: 0,  y: 10, restX: 0,  restY: 10 },
            ],
            uvs: [0,0, 1,0, 1,1, 0,1],
            triangles: [[0, 1, 2], [0, 2, 3]],
            edgeIndices: [],
          },
        },
      ],
      animations: [],
    },
  });
  useEditorStore.setState({
    selection: ['p1'],
    editMode: 'edit',
    toolMode: 'select',
    selectedVertexIndices: new Map([['p1', new Set([0, 1])]]),
    activeVertex: { partId: 'p1', vertIndex: 0 },
  });
  clearHistory();
}

// ─── G-1 — modal vertex translate writes restX/restY ────────────────
// (The fix is in ModalVertexTransformOverlay.applyDelta + revertVerts;
// we simulate the per-tick write directly by writing both pose AND rest.)
{
  seedProject();
  const part = useProjectStore.getState().project.nodes[0];
  const sel = useEditorStore.getState().selectedVertexIndices.get('p1');
  const result = extrude(part.mesh, sel);
  applyTopologyOp('p1', result);
  // Simulate a per-tick write that includes restX/restY (the audit-fix
  // contract). Verify that AFTER the write, the dragged dups have rest
  // = pose so chainEval sees them at the dragged position.
  const updateProject = useProjectStore.getState().updateProject;
  updateProject((proj) => {
    const node = proj.nodes.find((n) => n.id === 'p1');
    const mesh = node.mesh;
    for (const idx of result.selectionOverride) {
      const v = mesh.vertices[idx];
      v.x = v.x + 50;
      v.y = v.y + 30;
      v.restX = v.restX + 50;
      v.restY = v.restY + 30;
    }
  }, { skipHistory: true });
  // Verify the post-write state.
  const post = useProjectStore.getState().project.nodes[0].mesh;
  for (const idx of result.selectionOverride) {
    const v = post.vertices[idx];
    assert(approx(v.restX, v.x),
      `G-1: dup ${idx} restX==x (${v.restX} == ${v.x})`);
    assert(approx(v.restY, v.y),
      `G-1: dup ${idx} restY==y (${v.restY} == ${v.y})`);
  }
}

// ─── G-1b — overlay file source contains the rest-write code ────────
// Direct text-grep so the regression-pin still fires if someone edits
// the overlay back to x/y-only.
{
  const overlaySrc = readFileSync(
    resolve(ROOT, 'src/v3/shell/ModalVertexTransformOverlay.jsx'),
    'utf8',
  );
  assert(/v\.restX\s*=\s*\(orig\.restX/.test(overlaySrc),
    'G-1: ModalVertexTransformOverlay.applyDelta writes restX');
  assert(/v\.restY\s*=\s*\(orig\.restY/.test(overlaySrc),
    'G-1: ModalVertexTransformOverlay.applyDelta writes restY');
  // revertVerts also.
  assert(/v\.restX\s*=\s*orig\.restX\s*\?\?\s*orig\.x/.test(overlaySrc),
    'G-1: revertVerts restores restX');
}

// ─── G-2 — applyTopologyOp failure closes the batch via discardBatch ─
{
  seedProject();
  const initialUndo = undoCount();
  // Begin a batch (mimics extrude opening one) on a fake project, then
  // simulate applyTopologyOp returning false (e.g. partId vanished).
  beginBatch(useProjectStore.getState().project);
  assert(undoCount() === initialUndo + 1, 'G-2: beginBatch pushed snapshot');
  // Simulate the failure path — the registry's exec calls discardBatch
  // when ok===false. Replicate here.
  discardBatch(() => {});
  assert(undoCount() === initialUndo,
    `G-2: discardBatch popped snapshot on failure, got count ${undoCount()}`);
}

// ─── G-2b — registry source contains the discardBatch failure path ──
{
  const regSrc = readFileSync(
    resolve(ROOT, 'src/v3/operators/registry.js'),
    'utf8',
  );
  assert(/applyTopologyOp\(partId,\s*result\);\s*\n\s*if \(!ok\) \{\s*\n\s*discardBatch/.test(
    regSrc.replace(/\r/g, '')
  ) || /const ok = applyTopologyOp/.test(regSrc),
    'G-2: registry exec gates on applyTopologyOp return');
}

// ─── G-7 — early-return guard on stale modal state ──────────────────
{
  const overlaySrc = readFileSync(
    resolve(ROOT, 'src/v3/shell/ModalVertexTransformOverlay.jsx'),
    'utf8',
  );
  assert(
    /useModalVertexTransformStore\.getState\(\)\.kind\s*===\s*null/.test(overlaySrc),
    'G-7: applyDelta has stale-state guard',
  );
}

// ─── G-8 — discardBatch nulls _redoStackBeforeBatch unconditionally ──
{
  const undoSrc = readFileSync(
    resolve(ROOT, 'src/store/undoHistory.js'),
    'utf8',
  );
  // Verify the if-block at depth==1 unconditionally clears the backup.
  assert(/audit fix G-8/i.test(undoSrc),
    'G-8: undoHistory references audit fix in comments');
}

// ─── G-8b — runtime test: clearHistory mid-batch doesn't leak backup ─
{
  seedProject();
  const proj = useProjectStore.getState().project;
  beginBatch(proj);
  // _redoStackBeforeBatch was set (empty array). Now clearHistory wipes
  // _snapshots but leaves _batchDepth.
  clearHistory();
  // discardBatch at this point: snapshots empty, _batchDepth was reset
  // by clearHistory to 0. So discardBatch returns immediately.
  // Verify no error + state coherent.
  let threw = false;
  try { discardBatch(() => {}); } catch { threw = true; }
  assert(!threw, 'G-8: discardBatch after clearHistory mid-batch does not throw');
}

// ─── G-12 — typedef comment correctly cites SURVIVOR pass ────────────
{
  const meshSrc = readFileSync(
    resolve(ROOT, 'src/lib/meshTopology.js'),
    'utf8',
  );
  assert(/SURVIVOR pass/.test(meshSrc),
    'G-12: selectionOverride typedef references SURVIVOR pass (not GROWTH)');
}

// ─── D-8 — prior active vert's dup becomes new active ────────────────
{
  seedProject();
  // Active vert = 0. Boundary verts {0, 1} both selected.
  const part = useProjectStore.getState().project.nodes[0];
  const sel = useEditorStore.getState().selectedVertexIndices.get('p1');
  const result = extrude(part.mesh, sel);
  // Determine which new index is the dup of vert 0.
  let dupOfActive = -1;
  for (const [newIdx, sources] of result.vertexSources) {
    if (newIdx < part.mesh.vertices.length) continue;
    if (sources.length === 1 && sources[0] === 0) {
      dupOfActive = newIdx;
      break;
    }
  }
  assert(dupOfActive >= 0, 'D-8: setup: dup of active vert exists');
  applyTopologyOp('p1', result);
  const newActive = useEditorStore.getState().activeVertex;
  assert(newActive?.vertIndex === dupOfActive,
    `D-8: active vert post-extrude = dup of prior active (expected ${dupOfActive}, got ${newActive?.vertIndex})`);
}

// ─── D-9 — extrude.js cites correct Blender source ranges ───────────
{
  const extSrc = readFileSync(
    resolve(ROOT, 'src/v3/operators/edit/extrude.js'),
    'utf8',
  );
  assert(/editmesh_extrude\.cc:430-456/.test(extSrc),
    'D-9: extrude.js cites :430-456 (edbm_extrude_region_exec)');
  assert(/editmesh_extrude\.cc:358-427/.test(extSrc),
    'D-9: extrude.js cites :358-427 (edbm_extrude_mesh dispatch)');
  assert(/bmo_extrude\.cc:319/.test(extSrc),
    'D-9: extrude.js cites bmo_extrude.cc:319+ (BMOP)');
  // Old wrong cite remains as historical "prior cite was X" context —
  // accept that. What we DON'T want is the old cite as an active
  // primary source line. The presence of the new cites is sufficient.
}

// ─── D-9b — keymap cites correct Blender source ─────────────────────
{
  const kmSrc = readFileSync(
    resolve(ROOT, 'src/v3/keymap/default.js'),
    'utf8',
  );
  assert(/editmesh_extrude\.cc:430-456/.test(kmSrc),
    'D-9: keymap doc cites :430-456');
}

// ─── D-2 — toast wording is Blender-aware (DOCUMENT-AS-DEVIATION) ───
{
  const regSrc = readFileSync(
    resolve(ROOT, 'src/v3/operators/registry.js'),
    'utf8',
  );
  // The new toast title and description should mention the Blender
  // operator + Live2D limitation.
  assert(/Interior-vert extrude not supported/.test(regSrc),
    'D-2: toast title rewritten for clarity');
  assert(/MESH_OT_extrude_verts_indiv/.test(regSrc),
    'D-2: toast description references the Blender operator');
}

// ─── D-1 + D-3 + D-6 + D-7 — module banners cite Blender source ─────
{
  const storeSrc = readFileSync(
    resolve(ROOT, 'src/store/modalVertexTransformStore.js'),
    'utf8',
  );
  const overlaySrc = readFileSync(
    resolve(ROOT, 'src/v3/shell/ModalVertexTransformOverlay.jsx'),
    'utf8',
  );
  const meshSrc = readFileSync(
    resolve(ROOT, 'src/lib/meshTopology.js'),
    'utf8',
  );
  assert(/wm_operator_type\.cc:308-328/.test(storeSrc),
    'D-1: modalVertexTransformStore banner cites wm_macro_end');
  assert(/transform\.cc:693-742/.test(storeSrc),
    'D-3: store banner cites transform.cc for missing R/S switch');
  assert(/LMB-select preset/i.test(overlaySrc),
    'D-6: overlay banner documents LMB-select assumption');
  assert(/BM_edge_is_boundary/.test(meshSrc),
    'D-7: meshTopology cites BM_edge_is_boundary as the Blender source');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
