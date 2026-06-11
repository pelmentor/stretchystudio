// Regression for the bone-rotation invisibility bug (2026-06-11).
//
// Root cause: `kernelArtMeshEval` populated `ctx._artMeshByIdCache` with
// PARTS ONLY at the top of the kernel. That same cache is then reused
// at line ~350 as the `byId` map passed to `applyBonePostChainSkin` →
// `resolveBoneWorldFromCtx`, which walks the bone parent chain via
// `byId.get(boneId)`. A parts-only map returns `undefined` for every
// bone group → `resolveBoneWorldFromCtx` short-circuits to identity →
// the bone WORLD never reaches the mesh. Symptom: rotating any bone
// in Pose Mode rotated the skeleton overlay but left the mesh frozen
// at rest.
//
// Asserted invariant: `ctx._artMeshByIdCache` (post-kernelArtMeshEval)
// contains EVERY project node — parts, groups, and bone groups alike.
// If a future change reintroduces the parts-only filter, this test
// fires before the user-visible regression does.
//
// Sister test: `test_groupRotationBoneEval` proves the END-TO-END
// LBS@30° produces the rotation-deformer-matched verts; this one
// asserts the CACHE-INVARIANT directly, so a future regression in
// either layer surfaces independently.
//
// Run: node scripts/test/test_artMeshByIdCache_includesBones.mjs

import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';
import { buildDepGraph } from '../../src/anim/depgraph/build.js';
import { evalDepGraph } from '../../src/anim/depgraph/eval.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

const REST = [350, 250, 450, 250, 350, 350, 450, 350];

function makeProject(poseRotation) {
  return {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    parameters: [],
    nodes: [
      // Bone group at canvas pivot (400, 300). poseRotation drives the test.
      { id: 'grp', type: 'group', boneRole: 'rightArm', name: 'rightArm', parent: null,
        transform: { pivotX: 400, pivotY: 300, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        pose: { rotation: poseRotation, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      // Non-bone visual folder — proves the cache walks group nodes too.
      { id: 'folder', type: 'group', name: 'folder', parent: 'grp' },
      // Part skinned to the bone at weight 1 (rigid follow).
      { id: 'face', type: 'part', name: 'face', visible: true, draw_order: 100,
        parent: 'folder', rigParent: null,
        mesh: {
          uvs: [0, 0, 1, 0, 0, 1, 1, 1],
          triangles: [0, 1, 2, 1, 3, 2],
          vertices: REST.slice(),
          boneWeights: [1, 1, 1, 1],
          jointBoneId: 'grp',
          runtime: {
            parent: { type: 'root', id: null },
            bindings: [],
            keyforms: [{ keyTuple: [], opacity: 1, vertexPositions: REST.slice() }],
          },
        } },
    ],
    animations: [], physicsRules: [],
  };
}

// ── §1 — cache holds EVERY node, not parts-only ──────────────────────

{
  const project = makeProject(0);
  synthesizeModifierStacks(project);
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, paramOverrides: new Map(), timeMs: 0 });

  // The artMesh kernel runs as part of evalDepGraph; _artMeshByIdCache
  // is populated lazily on first kernel call.
  const cache = ctx._artMeshByIdCache;
  ok(cache instanceof Map, '§1 — cache is a Map post-eval');
  ok(cache?.has('grp'), '§1 — cache has the BONE group "grp"');
  ok(cache?.has('folder'), '§1 — cache has the non-bone group "folder"');
  ok(cache?.has('face'), '§1 — cache has the part "face"');
  // Pre-fix the cache only had parts; this assertion would have failed.
  ok(cache?.get('grp')?.type === 'group', '§1 — "grp" entry resolves to the group node, not undefined');
  ok(cache?.get('grp')?.boneRole === 'rightArm', '§1 — "grp" carries its boneRole');
}

// ── §2 — end-to-end: bone rotation reaches the mesh ──────────────────

{
  const project = makeProject(30);
  synthesizeModifierStacks(project);
  const frames = evalProjectFrameViaDepgraph(project, {});
  const face = frames.find((f) => f.id === 'face');
  ok(face != null, '§2 — face frame emitted');
  // ROT30 around pivot (400, 300): (350,250) → (381.7, 231.7).
  const v0x = face.vertexPositions[0];
  const v0y = face.vertexPositions[1];
  ok(Math.abs(v0x - 381.699) < 0.05, `§2 — v0.x rotated to ~381.7 (got ${v0x.toFixed(3)})`);
  ok(Math.abs(v0y - 231.699) < 0.05, `§2 — v0.y rotated to ~231.7 (got ${v0y.toFixed(3)})`);
}

// ── §3 — kernelArtMeshEval still filters non-parts (no frame for groups) ──

{
  const project = makeProject(30);
  synthesizeModifierStacks(project);
  const frames = evalProjectFrameViaDepgraph(project, {});
  // 'grp' and 'folder' are groups; they must NOT produce art-mesh frames
  // even though they're now in the byId cache.
  ok(!frames.some((f) => f.id === 'grp'), '§3 — bone group does not emit a frame');
  ok(!frames.some((f) => f.id === 'folder'), '§3 — non-bone group does not emit a frame');
  ok(frames.some((f) => f.id === 'face'), '§3 — only the part emits a frame');
}

console.log(`artMeshByIdCache_includesBones: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
