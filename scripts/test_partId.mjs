// v3 Phase -1D — Tests for src/lib/partId.js (canonical part-ID
// identity guards) and round-trip identity between rigSpec.artMeshes
// IDs and chainEval frame.id.
//
// Run: node scripts/test_partId.mjs

import {
  assertPartId,
  assertSamePartId,
  sanitisePartName,
} from '../src/lib/partId.js';
import { evalRig } from '../src/io/live2d/runtime/evaluator/chainEval.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertThrows(fn, name) {
  try { fn(); failed++; console.error(`FAIL: ${name} (no throw)`); }
  catch { passed++; }
}

// ── assertPartId ─────────────────────────────────────────────────────

assert(assertPartId('abc') === 'abc', 'assertPartId returns input string');
assert(assertPartId('node_xyz_42') === 'node_xyz_42', 'assertPartId: complex string');

assertThrows(() => assertPartId(null), 'assertPartId throws on null');
assertThrows(() => assertPartId(undefined), 'assertPartId throws on undefined');
assertThrows(() => assertPartId(42), 'assertPartId throws on number');
assertThrows(() => assertPartId(''), 'assertPartId throws on empty string');
assertThrows(() => assertPartId({}), 'assertPartId throws on object');

// Label appears in error message
try { assertPartId(null, 'meshSpec.id'); }
catch (e) { assert(/meshSpec\.id/.test(e.message), 'assertPartId: label in error message'); }

// ── assertSamePartId ─────────────────────────────────────────────────

assertSamePartId('abc', 'abc'); passed++;  // no-op match
assertThrows(() => assertSamePartId('abc', 'xyz'), 'assertSamePartId throws on mismatch');
assertThrows(
  () => assertSamePartId('abc', ''),
  'assertSamePartId throws when one is empty',
);

// Context appears in error
try { assertSamePartId('a', 'b', 'frame ↔ node'); }
catch (e) {
  assert(/frame ↔ node/.test(e.message), 'assertSamePartId: context in error');
  assert(/"a"/.test(e.message) && /"b"/.test(e.message), 'assertSamePartId: both ids quoted');
}

// ── sanitisePartName ─────────────────────────────────────────────────

assert(sanitisePartName('Body Front') === 'Body_Front', 'sanitise: space → underscore');
assert(sanitisePartName('hair.strand-01') === 'hair_strand_01', 'sanitise: dot/hyphen → underscore');
assert(sanitisePartName('arm/left') === 'arm_left', 'sanitise: slash → underscore');
assert(sanitisePartName('OK_already') === 'OK_already', 'sanitise: already-safe is identity');
assert(sanitisePartName('日本語') === '___', 'sanitise: non-ASCII → underscores');
assert(sanitisePartName('') === '_', 'sanitise: empty input → fallback "_"');
assert(sanitisePartName(null) === '_', 'sanitise: null → fallback');
assert(sanitisePartName(undefined) === '_', 'sanitise: undefined → fallback');

// Sanitisation is collision-prone by design — verify two different
// names can hash to the same sanitisedName so the convention is
// honest about not being a primary key.
assert(
  sanitisePartName('Body Front') === sanitisePartName('Body_Front'),
  'sanitise: collision possible (this is by design, sanitisedName ≠ primary key)',
);

// ── Round-trip: rigSpec artMesh.id → evalRig frame.id (full identity) ─
//
// This is the regression test that the v2 plan called out as Risk #6:
// every artMesh in rigSpec must show up in evalRig's output with its
// id intact. Silent drops were the bug class — this loop fails loudly
// if any mesh gets renamed by the evaluator.

{
  const rigSpec = {
    parameters: [{ id: 'P', min: 0, max: 1, default: 0.5 }],
    parts: [],
    warpDeformers: [],
    rotationDeformers: [],
    physicsRules: [],
    canvas: { w: 100, h: 100 },
    artMeshes: [
      {
        id: 'mesh_a',
        name: 'mesh_a',
        parent: { type: 'root', id: null },
        verticesCanvas: new Float32Array([0, 0, 1, 0, 1, 1]),
        triangles: new Uint16Array([0, 1, 2]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1]),
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], vertexPositions: new Float32Array([0, 0, 1, 0, 1, 1]) },
          { keyTuple: [1], vertexPositions: new Float32Array([0, 0, 2, 0, 2, 2]) },
        ],
      },
      {
        id: 'mesh_b',
        name: 'mesh_b',
        parent: { type: 'root', id: null },
        verticesCanvas: new Float32Array([5, 5, 6, 5, 6, 6]),
        triangles: new Uint16Array([0, 1, 2]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1]),
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], vertexPositions: new Float32Array([5, 5, 6, 5, 6, 6]) },
          { keyTuple: [1], vertexPositions: new Float32Array([5, 5, 7, 5, 7, 7]) },
        ],
      },
      {
        id: 'mesh.with.dots',  // ← deliberately gnarly: dots in the id
        name: 'mesh.with.dots',
        parent: { type: 'root', id: null },
        verticesCanvas: new Float32Array([10, 10, 11, 10, 11, 11]),
        triangles: new Uint16Array([0, 1, 2]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1]),
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], vertexPositions: new Float32Array([10, 10, 11, 10, 11, 11]) },
          { keyTuple: [1], vertexPositions: new Float32Array([10, 10, 12, 10, 12, 12]) },
        ],
      },
    ],
  };

  const frames = evalRig(rigSpec, { P: 0.5 });
  assert(frames.length === 3, 'roundtrip: 3 art meshes → 3 frames');

  const frameIds = new Set(frames.map(f => f.id));
  for (const m of rigSpec.artMeshes) {
    assert(
      frameIds.has(m.id),
      `roundtrip: artMesh ${JSON.stringify(m.id)} present in frames`,
    );
    // Every frame.id must be a valid PartId — guards catch silent
    // empty/null leaks from the evaluator.
    const frame = frames.find(f => f.id === m.id);
    assertSamePartId(frame.id, m.id, `frame ↔ artMesh (${m.name})`); passed++;
    assertPartId(frame.id, `frame ${frame.id}`); passed++;
  }
}

console.log(`partId: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
