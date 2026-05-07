// Phase 0.4 — byte-fidelity harness smoke test.
//
// Validates the harness PIPELINE on a synthetic minimal project:
//   - diffBuffers reports identical / divergent / length-delta correctly
//   - exportMoc3Buffer produces deterministic output
//   - runByteFidelitySweep round-trips project → bytes → diff cleanly
//
// The actual Shelby gate (PSD-derived fixture vs user-saved baseline)
// runs locally via `scripts/byteFidelity/check_shelby.mjs` with env
// vars; that fixture isn't checked in. This test verifies the harness
// itself doesn't introduce non-determinism.
//
// Run: node scripts/test/test_shelbyByteFidelity.mjs

import {
  diffBuffers,
  fnv1aHashBuffer,
  exportMoc3Buffer,
  prepareProject,
  runByteFidelitySweep,
} from '../byteFidelity/byteFidelityHarness.mjs';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// ---- diffBuffers ----

{
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([1, 2, 3, 4]);
  const d = diffBuffers(a, b);
  assert(d.identical, 'diff: identical buffers report identical');
  assertEq(d.firstDivergenceAt, null, 'diff: identical → null divergence offset');
  assertEq(d.divergentByteCount, 0, 'diff: identical → 0 divergent bytes');
}

{
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([1, 2, 9, 4]);
  const d = diffBuffers(a, b);
  assert(!d.identical, 'diff: 1-byte divergence → not identical');
  assertEq(d.firstDivergenceAt, 2, 'diff: first divergence at offset 2');
  assertEq(d.divergentByteCount, 1, 'diff: 1 divergent byte');
}

{
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new Uint8Array([1, 2, 3, 4]);
  const d = diffBuffers(a, b);
  assert(!d.identical, 'diff: length delta → not identical');
  assertEq(d.actualLen, 5, 'diff: actual length 5');
  assertEq(d.expectedLen, 4, 'diff: expected length 4');
  assertEq(d.firstDivergenceAt, 4, 'diff: divergence at first absent byte');
  assertEq(d.divergentByteCount, 1, 'diff: length delta = 1 divergent byte');
}

// ---- fnv1aHashBuffer determinism ----

{
  const a = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const h1 = fnv1aHashBuffer(a);
  const h2 = fnv1aHashBuffer(a);
  assertEq(h1, h2, 'hash: same buffer → same hash');
  assertEq(h1.length, 8, 'hash: 32-bit hex length 8');
  const b = new Uint8Array([0xde, 0xad, 0xbe, 0xee]);
  assert(fnv1aHashBuffer(b) !== h1, 'hash: 1-byte change → different hash');
}

// ---- prepareProject runs migrations ----

{
  const project = {
    nodes: [
      { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'face', type: 'part', rigParent: 'BodyXWarp',
        mesh: { vertices: [], uvs: [], triangles: [] } },
    ],
  };
  prepareProject(project);
  assert(typeof project.schemaVersion === 'number',
    'prepareProject: schemaVersion set');
  assert(project.schemaVersion >= 21,
    `prepareProject: schemaVersion >= 21 (got ${project.schemaVersion})`);
}

// ---- exportMoc3Buffer determinism ----

{
  // Minimal project that satisfies generateMoc3 invariants. moc3writer
  // tolerates empty rig + zero meshes and emits a near-empty header.
  const project = {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    nodes: [],
    parameters: [],
    physics_groups: [],
    animations: [],
    textures: [],
    bodyWarpLayout: null,
    schemaVersion: 21,
  };
  const a = exportMoc3Buffer(project);
  const b = exportMoc3Buffer(project);
  assert(a instanceof ArrayBuffer, 'exportMoc3Buffer: returns ArrayBuffer');
  assertEq(fnv1aHashBuffer(a), fnv1aHashBuffer(b),
    'exportMoc3Buffer: deterministic across runs');
}

// ---- runByteFidelitySweep ----

{
  const project = {
    canvas: { width: 800, height: 600, x: 0, y: 0 },
    nodes: [],
    parameters: [],
    physics_groups: [],
    animations: [],
    textures: [],
    bodyWarpLayout: null,
    schemaVersion: 21,
  };
  const r1 = runByteFidelitySweep(project, null);
  assert(r1.moc3Diff === null, 'sweep: null baseline → null diff');
  assert(r1.moc3Bytes instanceof ArrayBuffer, 'sweep: produced moc3 bytes');

  // Now diff against itself — should report identical.
  const r2 = runByteFidelitySweep(project, r1.moc3Bytes);
  assert(r2.moc3Diff?.identical === true,
    'sweep: round-trip against own bytes → identical');

  // Tampered baseline → divergence.
  const tampered = new Uint8Array(r1.moc3Bytes.byteLength);
  tampered.set(new Uint8Array(r1.moc3Bytes));
  if (tampered.length > 0) tampered[Math.floor(tampered.length / 2)] ^= 0xff;
  const r3 = runByteFidelitySweep(project, tampered);
  assert(r3.moc3Diff?.identical === false,
    'sweep: tampered baseline → divergence detected');
  assert(typeof r3.moc3Diff?.firstDivergenceAt === 'number',
    'sweep: divergence reports first offset');
}

// ---- Result ----

console.log(`shelbyByteFidelity (smoke): ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
