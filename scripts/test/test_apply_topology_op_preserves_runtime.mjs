// 2026-06-04 — applyTopologyOp must preserve mesh.runtime + remap keyforms.
//
// User report (2026-06-04): "When I deleted a chunk of mesh, the part
// stopped reacting to anything in live preview - frozen."
//
// Root cause: `applyTopologyOp` did `if (m.runtime) delete m.runtime;`
// (R4 audit fix G-1 comment). `kernelArtMeshEval` then early-returned
// `if (!runtime) return null;`, so the renderer skipped the part until
// the next manual Init Rig.
//
// Fix: instead of clearing, remap `mesh.runtime.keyforms[].vertexPositions`
// in-place using the same `vertexSources` / `vertexWeights` the
// blendShape delta remap consumes.
//
// This test validates the surgical remap end-to-end via `deleteVertices`
// + `applyTopologyOp` against a Zustand-mounted project store. Mirrors
// the layout of `test_topology_op_selection_remap.mjs`.
//
// Run: node scripts/test/test_apply_topology_op_preserves_runtime.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { applyTopologyOp } from '../../src/v3/operators/edit/applyTopologyOp.js';
import { deleteVertices } from '../../src/v3/operators/edit/deleteVerts.js';
import { mergeAtCenter } from '../../src/v3/operators/edit/merge.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-3) { return Math.abs(a - b) < eps; }

const PART_ID = 'p1';

function setupPentaMesh() {
  useProjectStore.getState().resetProject();
  useEditorStore.getState().clearAllVertexSelections();

  // 5-vert mesh with 3 triangles: [0,1,2], [0,2,3], [2,3,4].
  // Vert 4 only appears in the third triangle — deleting it drops one
  // tri and leaves a valid 4-vert mesh with 2 tris (above the rig
  // pipeline's 3-vert / non-empty-tris floor).
  //
  // `mesh.runtime` carries one binding (`ParamSmile`) plus two keyforms.
  // vertexPositions are the interleaved Float32Arrays the kernel reads.
  useProjectStore.getState().updateProject((proj) => {
    proj.nodes = [
      {
        id: PART_ID,
        type: 'part',
        name: 'penta',
        parent: null,
        visible: true,
        imageWidth: 100,
        imageHeight: 100,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        mesh: {
          vertices: [
            { x:  0, y:  0, restX:  0, restY:  0 },
            { x: 10, y:  0, restX: 10, restY:  0 },
            { x: 10, y: 10, restX: 10, restY: 10 },
            { x:  0, y: 10, restX:  0, restY: 10 },
            { x: 20, y: 20, restX: 20, restY: 20 },
          ],
          uvs: new Float32Array([0,0, 1,0, 1,1, 0,1, 2,2]),
          triangles: [[0,1,2], [0,2,3], [2,3,4]],
          edgeIndices: new Set([0,1,2,3,4]),
          runtime: {
            bindings: [
              { parameterId: 'ParamSmile', keys: [0, 1], interpolation: 'LINEAR' },
            ],
            keyforms: [
              {
                keyTuple: [0],
                opacity: 1,
                vertexPositions: new Float32Array([0,0, 10,0, 10,10, 0,10, 20,20]),
              },
              {
                keyTuple: [1],
                opacity: 1,
                vertexPositions: new Float32Array([5,5, 15,5, 15,15, 5,15, 25,25]),
              },
            ],
          },
        },
        blendShapes: [],
      },
    ];
  });
}

// 1 — delete vertex 4 → runtime survives, keyforms shrink from 5 to 4 verts.
{
  setupPentaMesh();
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = deleteVertices(mesh, new Set([4]));
  assert(result !== null, 'delete: precondition deleteVertices returns result');
  applyTopologyOp(PART_ID, result);

  const newMesh = useProjectStore.getState().project.nodes[0].mesh;
  assert(newMesh.runtime != null, 'delete: runtime is NOT cleared (fix freeze)');
  assert(Array.isArray(newMesh.runtime.keyforms),
    'delete: runtime.keyforms remains an array');
  assert(newMesh.runtime.keyforms.length === 2,
    'delete: both keyforms preserved');

  // Pre-op: 5 verts. Post-delete-vert-4: 4 verts. Survivors 0..3 keep
  // their indices verbatim; vert 4 vanishes; the [2,3,4] triangle that
  // depended on vert 4 also dropped, leaving 2 surviving tris.
  const kf0 = newMesh.runtime.keyforms[0].vertexPositions;
  const kf1 = newMesh.runtime.keyforms[1].vertexPositions;
  assert(kf0 instanceof Float32Array, 'delete: keyform0 vertexPositions is Float32Array');
  assert(kf0.length === 8, `delete: keyform0 has 4 verts × 2 = 8 (got ${kf0.length})`);
  assert(kf1.length === 8, `delete: keyform1 has 4 verts × 2 = 8 (got ${kf1.length})`);

  // Survivors copied verbatim — keyform0: (0,0)(10,0)(10,10)(0,10).
  assert(approx(kf0[0],  0), 'delete: keyform0 vert0.x = 0');
  assert(approx(kf0[1],  0), 'delete: keyform0 vert0.y = 0');
  assert(approx(kf0[2], 10), 'delete: keyform0 vert1.x = 10');
  assert(approx(kf0[3],  0), 'delete: keyform0 vert1.y = 0');
  assert(approx(kf0[4], 10), 'delete: keyform0 vert2.x = 10');
  assert(approx(kf0[5], 10), 'delete: keyform0 vert2.y = 10');
  assert(approx(kf0[6],  0), 'delete: keyform0 vert3.x = 0');
  assert(approx(kf0[7], 10), 'delete: keyform0 vert3.y = 10');

  // keyform1: (5,5)(15,5)(15,15)(5,15) — vert 4 (25,25) is dropped.
  assert(approx(kf1[0],  5), 'delete: keyform1 vert0.x = 5');
  assert(approx(kf1[1],  5), 'delete: keyform1 vert0.y = 5');
  assert(approx(kf1[6],  5), 'delete: keyform1 vert3.x = 5');
  assert(approx(kf1[7], 15), 'delete: keyform1 vert3.y = 15');

  // Bindings are param-keyed descriptors — left untouched.
  assert(Array.isArray(newMesh.runtime.bindings)
         && newMesh.runtime.bindings.length === 1,
    'delete: bindings preserved');
  assert(newMesh.runtime.bindings[0].parameterId === 'ParamSmile',
    'delete: binding parameterId preserved');
}

// 2 — merge verts 0+1 into one → keyforms collapse from 5 to 4 verts; new
//     vert 0 position = mean of source positions.
{
  setupPentaMesh();
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = mergeAtCenter(mesh, [0, 1]);
  assert(result !== null, 'merge: precondition mergeAtCenter returns result');
  applyTopologyOp(PART_ID, result);

  const newMesh = useProjectStore.getState().project.nodes[0].mesh;
  assert(newMesh.runtime != null, 'merge: runtime preserved');
  assert(newMesh.runtime.keyforms.length === 2, 'merge: 2 keyforms');

  // Keyform 0 old: (0,0)(10,0)(10,10)(0,10)(20,20). After merging 0+1:
  // new 0 = mean(0,0)+(10,0) = (5,0); new 1 = old 2 = (10,10); new 2 = old
  // 3 = (0,10); new 3 = old 4 = (20,20).
  const kf0 = newMesh.runtime.keyforms[0].vertexPositions;
  assert(kf0.length === 8, `merge: keyform0 has 4 verts (got ${kf0.length / 2})`);
  assert(approx(kf0[0], 5), `merge: keyform0 merged vert.x = 5 (got ${kf0[0]})`);
  assert(approx(kf0[1], 0), `merge: keyform0 merged vert.y = 0 (got ${kf0[1]})`);
  assert(approx(kf0[6], 20), `merge: keyform0 trailing vert.x = 20 (got ${kf0[6]})`);
  assert(approx(kf0[7], 20), `merge: keyform0 trailing vert.y = 20 (got ${kf0[7]})`);

  // Keyform 1 — verts 0,1 originally (5,5),(15,5) → merged = (10, 5).
  const kf1 = newMesh.runtime.keyforms[1].vertexPositions;
  assert(approx(kf1[0], 10), `merge: keyform1 merged vert.x = 10 (got ${kf1[0]})`);
  assert(approx(kf1[1], 5),  `merge: keyform1 merged vert.y = 5 (got ${kf1[1]})`);
}

// 3 — runtime with no keyforms array (defensive): doesn't throw, mesh
//     mutation still runs.
{
  setupPentaMesh();
  useProjectStore.getState().updateProject((proj) => {
    proj.nodes[0].mesh.runtime.keyforms = null;
  });
  const proj = useProjectStore.getState().project;
  const mesh = proj.nodes[0].mesh;
  const result = deleteVertices(mesh, new Set([4]));
  // Just verify no throw.
  let threw = false;
  try { applyTopologyOp(PART_ID, result); } catch (e) { threw = true; }
  assert(!threw, 'defensive: applyTopologyOp with null keyforms does not throw');
  const newMesh = useProjectStore.getState().project.nodes[0].mesh;
  assert(newMesh.vertices.length === 4,
    `defensive: mesh still mutated to 4 verts post-delete (got ${newMesh.vertices.length})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
