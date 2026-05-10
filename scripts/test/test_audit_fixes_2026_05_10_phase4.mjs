// Toolset Phase 4 audit-fix sweep regression pins (2026-05-10).
//
// Pins the 5 HIGH + key MED fixes from the dual audit
// (architecture + Blender-fidelity). Future regressions in these
// behaviours will fail this suite even when the per-op suites
// stay green.
//
// Pins:
//   D-1   subdivide cuts=2 = 9 sub-tris (Blender single-pass), NOT 16
//          (pre-fix iterative); cuts=2 vert count matches triangular
//          grid (3 + 6 + 1 interior = 10), interior vert is centroid
//          via vertexWeights = [1/3, 1/3, 1/3].
//   D-1b  subdivide vertexWeights field is set (parallel to vertexSources)
//          and edge midpoints get [1-t, t] weights for cuts > 1.
//   D-2   subdivide module doc explicitly flags Loop-style (NOT
//          Catmull-Clark) smoothness as an SS deviation.
//   D-3   mergeAtFirst is exported and behaves like mergeAtLast (modulo
//          which vert it targets).
//   G-1   applyTopologyOp clears node.mesh.runtime in the updateProject
//          recipe.
//   G-2   subdivide on a mesh whose `edgeIndices` is a plain Array (NOT
//          a Set — the post-load shape per projectFile.js:214) does not
//          throw and inherits boundary status correctly.
//   G-5   subdivide with smoothness > 0 leaves restX/restY as the
//          geometric midpoint (not the smoothed pose position).
//   G-6   enumerateOneRingPolygon returns null on non-manifold topology
//          (two fans sharing only the centre).
//
// Run: node scripts/test/test_audit_fixes_2026_05_10_phase4.mjs

import { subdivide } from '../../src/v3/operators/edit/subdivide.js';
import { mergeAtFirst, mergeAtLast } from '../../src/v3/operators/edit/merge.js';
import { applyTopologyOp } from '../../src/v3/operators/edit/applyTopologyOp.js';
import { enumerateOneRingPolygon } from '../../src/lib/meshTopology.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// ── D-1: cuts=2 = 9 sub-tris (NOT 16) ──────────────────────────────
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:10,y:0 }, { x:5,y:10 }],
    uvs: new Float32Array(6),
    triangles: [[0, 1, 2]],
    edgeIndices: null,
  };
  const r = subdivide(mesh, [0, 1, 2], { cuts: 2, smoothness: 0 });
  assert(r !== null, 'D-1: cuts=2 returns result');
  assert(r.triangles.length === 9, `D-1: cuts=2 = 9 sub-tris (Blender), got ${r.triangles.length}`);
  assert(r.vertices.length === 10, `D-1: cuts=2 = 10 verts, got ${r.vertices.length}`);
  // Find the interior centroid via vertexWeights.
  let centroidFound = false;
  for (let i = 3; i < r.vertices.length; i++) {
    const w = r.vertexWeights?.get(i);
    if (w && w.length === 3 && approx(w[0], 1/3) && approx(w[1], 1/3) && approx(w[2], 1/3)) {
      centroidFound = true;
      break;
    }
  }
  assert(centroidFound, 'D-1: cuts=2 has interior vert at α=β=γ=1/3 (centroid)');
}

// ── D-1b: vertexWeights set for edge midpoints (cuts > 1) ──────────
{
  const mesh = {
    vertices: [{ x:0,y:0 }, { x:10,y:0 }, { x:5,y:10 }],
    uvs: new Float32Array(6),
    triangles: [[0, 1, 2]],
    edgeIndices: null,
  };
  const r = subdivide(mesh, [0, 1, 2], { cuts: 2, smoothness: 0 });
  assert(r.vertexWeights instanceof Map, 'D-1b: vertexWeights is a Map');
  // For cuts=2 each edge has 2 midpoints at t=1/3 and t=2/3.
  // Find at least one [1/3, 2/3] or [2/3, 1/3] weight pair.
  let foundLerpWeight = false;
  for (let i = 3; i < r.vertices.length; i++) {
    const w = r.vertexWeights?.get(i);
    if (w && w.length === 2) {
      const matches = (approx(w[0], 1/3) && approx(w[1], 2/3))
                   || (approx(w[0], 2/3) && approx(w[1], 1/3));
      if (matches) { foundLerpWeight = true; break; }
    }
  }
  assert(foundLerpWeight, 'D-1b: edge midpoints carry [1-t, t] lerp weights');
}

// ── D-2: subdivide module doc flags Loop-style as SS deviation ─────
{
  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = dirname(__filename);
  const subdividePath = resolve(__dirname, '../../src/v3/operators/edit/subdivide.js');
  const src = readFileSync(subdividePath, 'utf8');
  assert(src.includes('Loop-subdivision-style'),
    'D-2: subdivide.js doc mentions Loop-subdivision-style');
  assert(src.includes('SS deviation') || src.includes('SS uses') || src.includes('deliberate SS deviation'),
    'D-2: subdivide.js doc flags smoothness as SS deviation from Blender');
}

// ── D-3: mergeAtFirst exists and behaves like mergeAtLast ──────────
{
  const mesh = {
    vertices: [
      { x: 0,  y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ],
    uvs: new Float32Array(8),
    triangles: [],
    edgeIndices: null,
  };
  const rFirst = mergeAtFirst(mesh, [0, 1, 2], 0);
  assert(rFirst !== null, 'D-3: mergeAtFirst returns result');
  assert(approx(rFirst.vertices[0].x, 0),
    `D-3: mergeAtFirst targets first idx (x=0), got x=${rFirst.vertices[0].x}`);
  const rLast = mergeAtLast(mesh, [0, 1, 2], 2);
  assert(approx(rLast.vertices[0].x, 20),
    `D-3: mergeAtLast targets last idx (x=20), got x=${rLast.vertices[0].x}`);
}

// ── G-1: applyTopologyOp clears node.mesh.runtime ──────────────────
{
  useProjectStore.getState().resetProject();
  useEditorStore.getState().clearAllVertexSelections();
  useProjectStore.getState().updateProject((proj) => {
    proj.nodes = [{
      id: 'p1', type: 'part', name: 'square', parent: null, visible: true,
      imageWidth: 100, imageHeight: 100,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
      mesh: {
        vertices: [
          { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 },
        ],
        uvs: [0,0, 1,0, 0.5,1],
        triangles: [[0, 1, 2]],
        edgeIndices: new Set([0, 1, 2]),
        runtime: { keyforms: [{ vertexPositions: [0,0, 10,0, 5,10] }] },
      },
      blendShapes: [],
    }];
  });
  // Run a subdivide op via applyTopologyOp.
  useEditorStore.getState().setVertexSelectionForPart('p1', new Set([0, 1, 2]));
  const result = subdivide(
    useProjectStore.getState().project.nodes[0].mesh,
    [0, 1, 2], { cuts: 1 },
  );
  applyTopologyOp('p1', result);
  const after = useProjectStore.getState().project.nodes[0].mesh;
  assert(after.runtime === undefined,
    `G-1: mesh.runtime cleared after topology op, got ${after.runtime ? 'present' : 'absent'}`);
}

// ── G-2: subdivide tolerates plain-Array edgeIndices (post-load shape) ──
{
  const mesh = {
    vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 },
    ],
    uvs: new Float32Array(6),
    triangles: [[0, 1, 2]],
    edgeIndices: [0, 1, 2], // plain Array, NOT Set — post-load shape
  };
  let threw = false;
  let r = null;
  try {
    r = subdivide(mesh, [0, 1, 2], { cuts: 1 });
  } catch (err) {
    threw = true;
  }
  assert(!threw, 'G-2: subdivide does not throw on plain-Array edgeIndices');
  assert(r !== null, 'G-2: subdivide returns result on plain-Array edgeIndices');
  // All 3 boundary midpoints should inherit boundary status.
  assert(r.edgeIndices.size === 6,
    `G-2: midpoints inherit boundary correctly (3 corners + 3 mids), got ${r.edgeIndices.size}`);
}

// ── G-5: smoothness leaves restX/restY untouched ───────────────────
{
  const mesh = {
    vertices: [
      { x: 0,  y: 0,  restX: 0,  restY: 0 },
      { x: 10, y: 0,  restX: 10, restY: 0 },
      { x: 5,  y: 10, restX: 5,  restY: 10 },
      { x: 15, y: 10, restX: 15, restY: 10 },
    ],
    uvs: new Float32Array(8),
    triangles: [[0, 1, 2], [1, 3, 2]],
    edgeIndices: null,
  };
  const r = subdivide(mesh, [0, 1, 2, 3], { cuts: 1, smoothness: 1 });
  assert(r !== null, 'G-5: subdivide with smoothness=1 returns result');
  // Find midpoint of (0, 1) — its rest should be the geometric midpoint (5, 0).
  for (let i = 4; i < r.vertices.length; i++) {
    const sources = r.vertexSources.get(i);
    if (sources?.length !== 2) continue;
    if (sources[0] === 0 && sources[1] === 1 || sources[0] === 1 && sources[1] === 0) {
      const v = r.vertices[i];
      assert(approx(v.restX, 5) && approx(v.restY, 0),
        `G-5: midpoint of (0,1) restX/restY = (5, 0) regardless of smoothness, got (${v.restX}, ${v.restY})`);
      break;
    }
  }
}

// ── G-6: enumerateOneRingPolygon returns null on non-manifold ──────
{
  // Centre vertex 0; two fans of 3 verts each (1,2,3) and (4,5,6),
  // sharing only the centre. Each fan has triangles (0,1,2), (0,2,3),
  // (0,4,5), (0,5,6). Directed edges from centre: 1→2, 2→3, 4→5, 5→6.
  // No conflict — manifold-ish actually (two disconnected open paths).
  // To force a conflict: make two triangles around the centre produce
  // the same outgoing u → ?  edge with different targets.
  //   Tri (0, 1, 2): u=1, v=2
  //   Tri (0, 1, 3): u=1, v=3  ← second triangle, same u, different v
  const triangles = [
    [0, 1, 2],
    [0, 1, 3],  // duplicates u=1 with different v
  ];
  const result = enumerateOneRingPolygon(triangles, 0);
  assert(result === null, 'G-6: enumerateOneRingPolygon returns null on duplicate u→v');
}

// ── Summary ────────────────────────────────────────────────────────
console.log(`audit_fixes_2026_05_10_phase4: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
