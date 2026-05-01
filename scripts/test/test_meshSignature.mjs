// GAP-012 Phase A — meshSignature module unit tests.
//
// Verifies:
//   - signature is deterministic (same mesh → same signature)
//   - vertex count change → different signature
//   - triangle count change → different signature
//   - UV value change → different signature
//   - vertex reorder (positional UV change) → different signature
//   - validateProjectSignatures: stale / missing / unseededNew / ok buckets
//
// Run: node scripts/test/test_meshSignature.mjs

import {
  meshSignature,
  signaturesEqual,
  computeProjectSignatures,
  validateProjectSignatures,
  hasStaleRigData,
} from '../../src/io/meshSignature.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function makeMesh(vertCount, triCount, uvSeed) {
  const vertices = Array.from({ length: vertCount }, (_, i) => ({ x: i, y: i * 2 }));
  const triangles = Array.from({ length: triCount }, (_, i) => [i, i + 1, i + 2]);
  // UV pattern depends on uvSeed so different seeds → different signatures.
  const uvs = new Float32Array(vertCount * 2);
  for (let i = 0; i < vertCount; i++) {
    uvs[i * 2] = (i * 0.1 + uvSeed) % 1;
    uvs[i * 2 + 1] = (i * 0.13 + uvSeed * 0.7) % 1;
  }
  return { vertices, triangles, uvs };
}

// ── Determinism ────────────────────────────────────────────────────
{
  const m = makeMesh(10, 8, 0.5);
  const s1 = meshSignature(m);
  const s2 = meshSignature(m);
  assert(signaturesEqual(s1, s2), 'same mesh → same signature');
  assert(s1.vertexCount === 10, 'vertexCount captured');
  assert(s1.triCount === 8, 'triCount captured');
  assert(typeof s1.uvHash === 'number', 'uvHash is a number');
  assert(s1.uvHash !== 0, 'uvHash is non-zero for populated UVs');
}

// ── Float32Array vs Array equivalence ──────────────────────────────
{
  // The hasher canonicalises Array→Float32Array internally, so a
  // mesh with regular-Array uvs should hash identically to one with
  // Float32Array uvs (same values).
  const f32 = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const m1 = { vertices: [{}, {}], triangles: [], uvs: f32 };
  const m2 = { vertices: [{}, {}], triangles: [], uvs: Array.from(f32) };
  assert(signaturesEqual(meshSignature(m1), meshSignature(m2)),
    'Float32Array uvs hash same as Array uvs (same values)');
}

// ── Detection: vertex count change ─────────────────────────────────
{
  const a = meshSignature(makeMesh(10, 8, 0.5));
  const b = meshSignature(makeMesh(11, 8, 0.5));
  assert(!signaturesEqual(a, b), 'different vertexCount → different signature');
}

// ── Detection: triangle count change ───────────────────────────────
{
  const a = meshSignature(makeMesh(10, 8, 0.5));
  const b = meshSignature(makeMesh(10, 9, 0.5));
  assert(!signaturesEqual(a, b), 'different triCount → different signature');
}

// ── Detection: UV value change ─────────────────────────────────────
{
  const a = meshSignature(makeMesh(10, 8, 0.5));
  const b = meshSignature(makeMesh(10, 8, 0.6));
  assert(!signaturesEqual(a, b), 'different UV values → different signature');
}

// ── Detection: positional reorder of UVs ───────────────────────────
{
  // Same set of UVs, different order: should be detected as different
  // (positional, not sorted, by design).
  const m = makeMesh(4, 2, 0.5);
  const reordered = {
    vertices: m.vertices,
    triangles: m.triangles,
    uvs: new Float32Array([m.uvs[2], m.uvs[3], m.uvs[0], m.uvs[1], m.uvs[6], m.uvs[7], m.uvs[4], m.uvs[5]]),
  };
  assert(!signaturesEqual(meshSignature(m), meshSignature(reordered)),
    'positional reorder of UVs → different signature (not sorted by design)');
}

// ── Edge cases: null/empty mesh ────────────────────────────────────
{
  const empty = meshSignature(null);
  assert(empty.vertexCount === 0 && empty.triCount === 0 && empty.uvHash === 0,
    'null mesh → all-zero signature');
  const noMesh = meshSignature({});
  assert(noMesh.vertexCount === 0 && noMesh.triCount === 0,
    '{} mesh → all-zero signature');
  // signaturesEqual with null/undefined returns false even when both null
  assert(signaturesEqual(null, null) === false, 'signaturesEqual(null, null) = false');
  assert(signaturesEqual(empty, empty) === true, 'signaturesEqual on identical zero sigs = true');
}

// ── computeProjectSignatures ───────────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'g1', type: 'group' /* skipped */ },
      { id: 'p1', type: 'part', mesh: makeMesh(4, 2, 0.1) },
      { id: 'p2', type: 'part', mesh: makeMesh(6, 4, 0.2) },
      { id: 'p3', type: 'part', mesh: null /* skipped */ },
      { id: 'p4', type: 'part' /* no mesh property — skipped */ },
    ],
  };
  const sigs = computeProjectSignatures(project);
  assert(Object.keys(sigs).length === 2, 'computeProjectSignatures: 2 entries (g1, p3, p4 skipped)');
  assert(sigs.p1 && sigs.p1.vertexCount === 4, 'p1 signature captured');
  assert(sigs.p2 && sigs.p2.vertexCount === 6, 'p2 signature captured');
  assert(!sigs.g1, 'group nodes excluded');
  assert(!sigs.p3, 'part with mesh=null excluded');
}

// ── validateProjectSignatures ──────────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', mesh: makeMesh(4, 2, 0.1) },
      { id: 'p2', type: 'part', mesh: makeMesh(6, 4, 0.2) },
      { id: 'p3', type: 'part', mesh: makeMesh(8, 6, 0.3) },
      { id: 'pNew', type: 'part', mesh: makeMesh(2, 1, 0.4) }, // never seeded
    ],
    meshSignatures: {
      p1: meshSignature(makeMesh(4, 2, 0.1)),                 // unchanged
      p2: meshSignature(makeMesh(7, 4, 0.2)),                 // vertex count changed → stale
      p3: meshSignature(makeMesh(8, 6, 0.999)),               // UV changed → stale
      pGone: meshSignature(makeMesh(3, 1, 0.5)),              // node removed → missing
    },
  };
  const report = validateProjectSignatures(project);
  assert(report.ok.length === 1 && report.ok[0] === 'p1', 'p1 → ok');
  assert(report.stale.length === 2 && report.stale.includes('p2') && report.stale.includes('p3'),
    'p2 + p3 → stale');
  assert(report.missing.length === 1 && report.missing[0] === 'pGone', 'pGone → missing');
  assert(report.unseededNew.length === 1 && report.unseededNew[0] === 'pNew', 'pNew → unseededNew');
  assert(hasStaleRigData(report) === true, 'hasStaleRigData true with stale + missing');
}

// ── validateProjectSignatures with no prior store ──────────────────
{
  const project = {
    nodes: [{ id: 'p1', type: 'part', mesh: makeMesh(4, 2, 0.1) }],
    meshSignatures: null,
  };
  const report = validateProjectSignatures(project);
  assert(report.ok.length === 0 && report.stale.length === 0 && report.missing.length === 0,
    'no prior store → only unseededNew is populated');
  assert(report.unseededNew.length === 1 && report.unseededNew[0] === 'p1', 'p1 in unseededNew');
  assert(hasStaleRigData(report) === false,
    'hasStaleRigData false when only unseededNew (fresh-project case)');
}

// ── validateProjectSignatures with all-OK case ─────────────────────
{
  const m1 = makeMesh(4, 2, 0.1);
  const m2 = makeMesh(6, 4, 0.2);
  const project = {
    nodes: [
      { id: 'p1', type: 'part', mesh: m1 },
      { id: 'p2', type: 'part', mesh: m2 },
    ],
    meshSignatures: {
      p1: meshSignature(m1),
      p2: meshSignature(m2),
    },
  };
  const report = validateProjectSignatures(project);
  assert(report.ok.length === 2, 'all-ok case: 2 in ok bucket');
  assert(hasStaleRigData(report) === false, 'all-ok case: hasStaleRigData=false');
}

console.log(`meshSignature: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
