// V4 Phase 4a — tests for src/v3/editors/properties/sections/vertexGroupsLayout.js
//
// Locks in: legacy single-bone fallback, modern weightGroups map,
// stats computation (mean / min-nonzero / max / nonZero count),
// section-visibility predicate.
//
// Run: node scripts/test/test_vertexGroupsLayout.mjs

import {
  buildVertexGroupSummaries,
  meshHasVertexGroups,
} from '../../src/v3/editors/properties/sections/vertexGroupsLayout.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function close(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// ── meshHasVertexGroups ────────────────────────────────────────────

assert(meshHasVertexGroups(null) === false, 'null node: no groups');
assert(meshHasVertexGroups({}) === false, 'no mesh: no groups');
assert(meshHasVertexGroups({ mesh: { vertices: [] } }) === false,
  'mesh without weights/jointBoneId: no groups');
assert(
  meshHasVertexGroups({ mesh: { vertices: [], jointBoneId: 'bone1' } }) === true,
  'mesh with jointBoneId only (no weights yet): groups visible',
);
assert(
  meshHasVertexGroups({ mesh: { vertices: [], boneWeights: [0.5] } }) === true,
  'mesh with boneWeights: groups visible',
);
assert(
  meshHasVertexGroups({ mesh: { vertices: [], weightGroups: { hand: [0.5] } } }) === true,
  'mesh with modern weightGroups: groups visible',
);

// ── Legacy: empty input → empty array ──────────────────────────────

{
  const out = buildVertexGroupSummaries(null, []);
  assert(out.length === 0, 'null node: empty array');
}

{
  const out = buildVertexGroupSummaries({ mesh: {} }, []);
  assert(out.length === 0, 'mesh without weights: empty array');
}

// ── Legacy: single bone weights ────────────────────────────────────

{
  const node = {
    mesh: {
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
      boneWeights: [0, 0.25, 0.5, 1.0],
      jointBoneId: 'leftElbow',
    },
  };
  const bones = [{ id: 'leftElbow', name: 'L Elbow' }];
  const out = buildVertexGroupSummaries(node, bones);
  assert(out.length === 1, 'legacy: one summary');
  const s = out[0];
  assert(s.name === 'L Elbow', 'legacy: resolves bone name from id');
  assert(s.boneId === 'leftElbow', 'legacy: keeps boneId');
  assert(s.totalVertices === 4, 'legacy: totalVertices = 4');
  assert(s.vertexCount === 3, 'legacy: nonZeroCount = 3 (0 weight excluded)');
  assert(close(s.mean, (0 + 0.25 + 0.5 + 1.0) / 4), 'legacy: mean = sum/n');
  assert(close(s.min, 0.25), 'legacy: min = smallest non-zero weight');
  assert(close(s.max, 1.0), 'legacy: max');
  assert(s.active === false, 'legacy: active=false (no activeWeightGroup)');
  assert(s.source === 'legacy', 'legacy: source flag');
}

{
  // Bone group not in the project — name falls back to id.
  const node = {
    mesh: {
      vertices: [{}, {}],
      boneWeights: [1, 1],
      jointBoneId: 'orphanedBone',
    },
  };
  const out = buildVertexGroupSummaries(node, []);
  assert(out[0].name === 'orphanedBone',
    'legacy: bone-name fallback to boneId when group missing');
}

{
  const node = {
    mesh: { vertices: [{}], boneWeights: [0.5] },
  };
  const out = buildVertexGroupSummaries(node, []);
  assert(out[0].name === '(unnamed bone)',
    'legacy: name fallback when no boneId, no group');
  assert(out[0].boneId === null, 'legacy: boneId null when missing');
}

// ── Legacy: all-zero weights → min = 0 (no non-zero) ───────────────

{
  const node = {
    mesh: { vertices: [{}, {}, {}], boneWeights: [0, 0, 0], jointBoneId: 'b1' },
  };
  const out = buildVertexGroupSummaries(node, []);
  assert(out[0].mean === 0 && out[0].min === 0 && out[0].max === 0,
    'legacy: all-zero stats are all 0');
  assert(out[0].vertexCount === 0,
    'legacy: nonZeroCount=0 when all weights are 0');
}

// ── Modern: multi-group + activeWeightGroup ────────────────────────

{
  const node = {
    mesh: {
      vertices: [{}, {}, {}],
      weightGroups: {
        leftArm:  [1.0, 0.5, 0.0],
        rightArm: [0.0, 0.5, 1.0],
      },
      activeWeightGroup: 'leftArm',
    },
  };
  const bones = [
    { id: 'b-left',  name: 'leftArm' },
    { id: 'b-right', name: 'rightArm' },
  ];
  const out = buildVertexGroupSummaries(node, bones);
  assert(out.length === 2, 'modern: two summaries');
  const left = out.find((s) => s.name === 'leftArm');
  const right = out.find((s) => s.name === 'rightArm');
  assert(left?.boneId === 'b-left', 'modern: resolves boneId by name');
  assert(left?.active === true, 'modern: leftArm is active');
  assert(right?.active === false, 'modern: rightArm is not active');
  assert(left?.source === 'modern', 'modern: source flag');
  assert(close(left?.mean ?? -1, (1 + 0.5) / 3), 'modern: mean');
  assert(close(left?.max ?? -1, 1.0), 'modern: max');
  assert(close(left?.min ?? -1, 0.5), 'modern: min-nonzero');
  assert(left?.vertexCount === 2, 'modern: nonZeroCount');
}

// ── Modern path takes precedence over legacy when both exist ───────

{
  const node = {
    mesh: {
      vertices: [{}, {}],
      boneWeights: [0.9, 0.9],     // legacy data
      jointBoneId: 'old',
      weightGroups: { newGroup: [0.1, 0.2] },
    },
  };
  const out = buildVertexGroupSummaries(node, []);
  assert(out.length === 1 && out[0].name === 'newGroup' && out[0].source === 'modern',
    'modern path wins over legacy when both present');
}

// ── Modern path with empty map → falls through to legacy ───────────

{
  const node = {
    mesh: {
      vertices: [{}, {}],
      boneWeights: [1, 0],
      jointBoneId: 'foo',
      weightGroups: {},
    },
  };
  const out = buildVertexGroupSummaries(node, []);
  assert(out.length === 1 && out[0].source === 'legacy',
    'empty modern map: legacy fallback');
}

// ── Float32Array weights also work ─────────────────────────────────

{
  const node = {
    mesh: {
      vertices: [{}, {}, {}],
      boneWeights: new Float32Array([0.0, 0.5, 1.0]),
      jointBoneId: 'bone',
    },
  };
  const out = buildVertexGroupSummaries(node, []);
  assert(out.length === 1, 'Float32Array boneWeights: counted');
  assert(close(out[0].max, 1.0), 'Float32Array stats: max correct');
}

console.log(`vertexGroupsLayout: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
