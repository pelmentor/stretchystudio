// scripts/test/test_autoSkinning.mjs — v52 auto-skin coverage.
//
// Pins the closest-bone heuristic + the three skip predicates
// (existing weights, existing jointBoneId, bone-ancestor present)
// + the idempotency guarantee for the v52 migration.

import {
  assignRigidSkinningToPart,
  autoSkinAllParts,
} from '../../src/io/live2d/rig/autoSkinning.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; } else { fail += 1; console.error(`FAIL: ${msg}`); }
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) console.error(`expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
  ok(same, msg);
}

// Minimal project factory: bones + part with mesh at given centroid.
function makeProject({ bones, parts }) {
  const nodes = [];
  for (const b of bones) {
    nodes.push({
      id: b.id,
      name: b.name ?? b.id,
      type: 'group',
      boneRole: b.role ?? 'custom',
      parent: b.parent ?? null,
      transform: { pivotX: b.px, pivotY: b.py },
    });
  }
  for (const p of parts) {
    nodes.push({
      id: p.id,
      name: p.name ?? p.id,
      type: 'part',
      parent: p.parent ?? null,
      mesh: p.mesh,
    });
  }
  return { nodes, parameters: [] };
}

// ─────────────────────────────────────────────────────────────────────
// Section 1 — closest-bone heuristic by centroid → pivot distance
// ─────────────────────────────────────────────────────────────────────

{
  // Three bones at (-100, 0), (0, 0), (+100, 0).
  // Part centroid at (50, 0) → closest is centre bone (0,0)? No,
  // distance to (0,0) is 50, distance to (+100,0) is 50. Tied — first
  // wins by iteration order. So make the closer winner unambiguous:
  // centroid at (60, 0) — closer to (+100, 0) than (0, 0).
  const project = makeProject({
    bones: [
      { id: 'boneL', name: 'leftSide',  role: 'leftArm',  px: -100, py: 0 },
      { id: 'boneC', name: 'centre',    role: 'torso',    px:    0, py: 0 },
      { id: 'boneR', name: 'rightSide', role: 'rightArm', px:  100, py: 0 },
    ],
    parts: [
      {
        id: 'partA',
        parent: null,
        mesh: { vertices: [
          // bbox centre = (60, 0) — closer to boneR than boneC.
          { x: 55, y: -5 }, { x: 65, y:  5 },
        ] },
      },
    ],
  });
  const result = assignRigidSkinningToPart(
    project.nodes.find((n) => n.id === 'partA'),
    project,
  );
  ok(result === true, '§1 — closest-bone heuristic: write succeeded');
  const mesh = project.nodes.find((n) => n.id === 'partA').mesh;
  eq(mesh.jointBoneId, 'boneR', '§1 — closest bone is boneR (centroid 60,0)');
  eq(mesh.boneWeights, [1, 1], '§1 — rigid [1,1] weights matching vertex count');
}

// ─────────────────────────────────────────────────────────────────────
// Section 2 — skip predicates
// ─────────────────────────────────────────────────────────────────────

// 2a — existing boneWeights → skip.
{
  const project = makeProject({
    bones: [{ id: 'bone1', role: 'head', px: 0, py: 0 }],
    parts: [{
      id: 'partA',
      parent: null,
      mesh: {
        vertices: [{ x: 0, y: 0 }],
        boneWeights: [0.5],
        jointBoneId: 'someOtherBone',
      },
    }],
  });
  const result = assignRigidSkinningToPart(
    project.nodes.find((n) => n.id === 'partA'),
    project,
  );
  ok(result === false, '§2a — skip when existing boneWeights present');
  const mesh = project.nodes.find((n) => n.id === 'partA').mesh;
  eq(mesh.boneWeights, [0.5], '§2a — original weights unchanged');
  eq(mesh.jointBoneId, 'someOtherBone', '§2a — original jointBoneId unchanged');
}

// 2b — existing jointBoneId (no weights yet) → skip.
{
  const project = makeProject({
    bones: [{ id: 'bone1', role: 'head', px: 0, py: 0 }],
    parts: [{
      id: 'partA',
      parent: null,
      mesh: {
        vertices: [{ x: 0, y: 0 }],
        jointBoneId: 'manuallyBound',
      },
    }],
  });
  const result = assignRigidSkinningToPart(
    project.nodes.find((n) => n.id === 'partA'),
    project,
  );
  ok(result === false, '§2b — skip when existing jointBoneId present');
  const mesh = project.nodes.find((n) => n.id === 'partA').mesh;
  ok(!Array.isArray(mesh.boneWeights), '§2b — no weights written');
  eq(mesh.jointBoneId, 'manuallyBound', '§2b — manual jointBoneId preserved');
}

// 2c — bone ancestor in parent chain → skip (overlay path covers it).
{
  const project = makeProject({
    bones: [
      { id: 'rightArm', name: 'rightArm', role: 'rightArm', px:  100, py: 0 },
      { id: 'leftArm',  name: 'leftArm',  role: 'leftArm',  px: -100, py: 0 },
    ],
    parts: [
      // part is parented to leftArm bone — overlay should cover it.
      {
        id: 'partA',
        parent: 'leftArm',
        mesh: { vertices: [{ x: 90, y: 0 }] },  // spatially closer to rightArm
      },
    ],
  });
  const result = assignRigidSkinningToPart(
    project.nodes.find((n) => n.id === 'partA'),
    project,
  );
  ok(result === false, '§2c — skip when bone ancestor present (overlay covers it)');
  const mesh = project.nodes.find((n) => n.id === 'partA').mesh;
  ok(!Array.isArray(mesh.boneWeights), '§2c — no weights written (avoids v31 double-rotation regression)');
  ok(!mesh.jointBoneId, '§2c — no jointBoneId written');
}

// 2d — part parented to warp/group (NOT bone) → ancestor null → assign.
{
  const project = makeProject({
    bones: [{ id: 'rightArm', name: 'rightArm', role: 'rightArm', px: 100, py: 0 }],
    parts: [
      // Add an intermediate non-bone group as the parent.
      {
        id: 'partA',
        parent: 'warpGroup',
        mesh: { vertices: [{ x: 95, y: 0 }] },
      },
    ],
  });
  // Insert a non-bone group between part and root.
  project.nodes.push({
    id: 'warpGroup', name: 'warp', type: 'group',
    // no boneRole → not a bone
    parent: null,
    transform: { pivotX: 0, pivotY: 0 },
  });
  const result = assignRigidSkinningToPart(
    project.nodes.find((n) => n.id === 'partA'),
    project,
  );
  ok(result === true, '§2d — non-bone parent chain → assign fires (Kora\'s shape)');
  const mesh = project.nodes.find((n) => n.id === 'partA').mesh;
  eq(mesh.jointBoneId, 'rightArm', '§2d — assigned to nearest bone');
}

// 2e — no bones in project → skip gracefully.
{
  const project = makeProject({
    bones: [],
    parts: [{ id: 'partA', parent: null, mesh: { vertices: [{ x: 0, y: 0 }] } }],
  });
  const result = assignRigidSkinningToPart(
    project.nodes.find((n) => n.id === 'partA'),
    project,
  );
  ok(result === false, '§2e — no bones → skip');
}

// 2f — empty mesh → skip.
{
  const project = makeProject({
    bones: [{ id: 'bone1', role: 'head', px: 0, py: 0 }],
    parts: [{ id: 'partA', parent: null, mesh: { vertices: [] } }],
  });
  const result = assignRigidSkinningToPart(
    project.nodes.find((n) => n.id === 'partA'),
    project,
  );
  ok(result === false, '§2f — empty mesh → skip');
}

// ─────────────────────────────────────────────────────────────────────
// Section 3 — idempotency (v52 migration safety)
// ─────────────────────────────────────────────────────────────────────

{
  const project = makeProject({
    bones: [{ id: 'bone1', role: 'head', px: 0, py: 0 }],
    parts: [{ id: 'partA', parent: null, mesh: { vertices: [{ x: 5, y: 5 }] } }],
  });
  const r1 = autoSkinAllParts(project);
  eq(r1.partsAssigned, 1, '§3 — first run assigns 1 part');
  const r2 = autoSkinAllParts(project);
  eq(r2.partsAssigned, 0, '§3 — second run idempotent (skip already-skinned)');
  const r3 = autoSkinAllParts(project);
  eq(r3.partsAssigned, 0, '§3 — third run also a no-op');
}

// ─────────────────────────────────────────────────────────────────────
// Section 4 — autoSkinAllParts summary shape
// ─────────────────────────────────────────────────────────────────────

{
  const project = makeProject({
    bones: [
      { id: 'rightArm',  name: 'rightArm',  role: 'rightArm',  px:  100, py: 0 },
      { id: 'leftArm',   name: 'leftArm',   role: 'leftArm',   px: -100, py: 0 },
      { id: 'head',      name: 'head',      role: 'head',      px:    0, py: 200 },
    ],
    parts: [
      { id: 'p1', parent: null, mesh: { vertices: [{ x:  95, y:   0 }] } }, // → rightArm
      { id: 'p2', parent: null, mesh: { vertices: [{ x: -95, y:   0 }] } }, // → leftArm
      { id: 'p3', parent: null, mesh: { vertices: [{ x:   0, y: 195 }] } }, // → head
      { id: 'p4', parent: null, mesh: { vertices: [{ x:  98, y:   2 }] } }, // → rightArm
    ],
  });
  const r = autoSkinAllParts(project);
  eq(r.partsScanned, 4, '§4 — partsScanned counts every part type=part');
  eq(r.partsAssigned, 4, '§4 — partsAssigned counts the writes');
  eq(r.byBone.rightArm, 2, '§4 — byBone histogram counts per-bone');
  eq(r.byBone.leftArm,  1, '§4 — byBone histogram per-bone (left)');
  eq(r.byBone.head,     1, '§4 — byBone histogram per-bone (head)');
}

console.log(`autoSkinning: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
