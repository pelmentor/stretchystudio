// Tests for the rigInvariantCheck framework.
//
// Coverage philosophy: each invariant (I-1 through I-7) gets a positive
// fixture (clean project, ok=true) and a negative fixture (violated,
// ok=false) so a regression that flips a check's polarity is caught.
//
// Run: node scripts/test/test_rigInvariantCheck.mjs

import { runRigInvariantChecks } from '../../src/io/live2d/rig/rigInvariantCheck.js';

let passed = 0;
let failed = 0;
function assert(cond, name, info) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  if (info) console.error(`       ${info}`);
}

// Silence the logger for the duration of the test run — the framework
// emits logger.error on violations by design (that's the point), but
// it would pollute the test output.
import { logger } from '../../src/lib/logger.js';
const _origError = logger.error;
const _origInfo = logger.info;
logger.error = () => {};
logger.info = () => {};

// ── I-1: modifier-stack non-emptiness ─────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'object', objectKind: 'mesh',
        vertices: [0, 0, 1, 0, 1, 1, 0, 1] },
      { id: 'p1', type: 'part', name: 'p1',
        mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        modifiers: [{ type: 'lattice', objectId: 'lat1' }] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-1 clean: part with one modifier is ok',
    `violations: ${JSON.stringify(r.violations)}`);
}
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'face',
        mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        modifiers: [] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-1'] === 1, 'I-1 fail: empty modifiers triggers I-1',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-2: modifier leaf reachability ───────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'face',
        mesh: { vertices: [{ x: 0, y: 0 }] },
        modifiers: [{ type: 'lattice', objectId: 'doesNotExist' }] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-2'] === 1,
    'I-2 fail: dangling lattice objectId triggers I-2',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-3: lattice parent reachability ──────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: 'ghost' },
      { id: 'cage1', type: 'object', objectKind: 'mesh',
        vertices: [0, 0, 1, 0, 1, 1, 0, 1] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-3'] === 1,
    'I-3 fail: lattice with unresolvable parent triggers I-3',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-4: lattice cage shape ───────────────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'object', objectKind: 'mesh',
        vertices: [0, 0, 1, 0, 1, 1] }, // 3 verts ≠ 4 expected
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-4'] === 1,
    'I-4 fail: cage vertex count mismatches gridSize triggers I-4',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-5: keyform vertexPositions shape — exactly the handwear bug ────
{
  // The pre-fix handwear bug: object-shape verts copied as-is into
  // vertexPositions. The framework MUST catch this.
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'handwear-l',
        mesh: {
          vertices: [{ x: 500, y: 400 }, { x: 600, y: 400 }],
          runtime: {
            keyforms: [{
              keyTuple: [],
              opacity: 1,
              vertexPositions: [{ x: 500, y: 400 }, { x: 600, y: 400 }], // BAD — object array
            }],
          },
        },
        modifiers: [{ type: 'armature', boneId: 'bone1' }] },
      { id: 'bone1', type: 'group', name: 'bone1', boneRole: 'elbow',
        transform: { pivotX: 100, pivotY: 100 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-5'] ?? 0) > 0,
    'I-5 fail: object-shape vertexPositions triggers I-5 (handwear regression)',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}
{
  // The actual correct case — flat Float32Array vertexPositions.
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'handwear-l',
        mesh: {
          vertices: [{ x: 500, y: 400 }, { x: 600, y: 400 }],
          jointBoneId: 'bone1',
          boneWeights: [1, 1],
          runtime: {
            keyforms: [{
              keyTuple: [],
              opacity: 1,
              vertexPositions: new Float32Array([500, 400, 600, 400]),
            }],
          },
        },
        modifiers: [{ type: 'armature', boneId: 'bone1' }] },
      { id: 'bone1', type: 'group', name: 'bone1', boneRole: 'elbow',
        transform: { pivotX: 100, pivotY: 100 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(r.ok, 'I-5 clean: flat Float32Array vertexPositions is ok',
    `violations: ${JSON.stringify(r.violations)}`);
}

// ── I-5: non-finite numbers in vertexPositions ────────────────────────
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'face',
        mesh: {
          vertices: [{ x: 500, y: 400 }],
          runtime: {
            keyforms: [{
              keyTuple: [],
              opacity: 1,
              vertexPositions: new Float32Array([NaN, 400]),
            }],
          },
        },
        modifiers: [{ type: 'lattice', objectId: 'lat1' }] },
      { id: 'lat1', type: 'object', objectKind: 'lattice', name: 'L1',
        gridSize: { rows: 2, cols: 2 }, dataId: 'cage1', parent: null },
      { id: 'cage1', type: 'object', objectKind: 'mesh',
        vertices: [0, 0, 1, 0, 1, 1, 0, 1] },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-5'] ?? 0) > 0,
    'I-5 fail: NaN in vertexPositions triggers I-5',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-6: boneWeights consistency ──────────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', name: 'handwear-l',
        mesh: {
          vertices: [{ x: 500, y: 400 }, { x: 600, y: 400 }, { x: 700, y: 400 }],
          jointBoneId: 'bone1',
          boneWeights: [1], // 1 weight for 3 verts — wrong
          runtime: {
            keyforms: [{
              keyTuple: [], opacity: 1,
              vertexPositions: new Float32Array([500, 400, 600, 400, 700, 400]),
            }],
          },
        },
        modifiers: [{ type: 'armature', boneId: 'bone1' }] },
      { id: 'bone1', type: 'group', name: 'bone1', boneRole: 'elbow',
        transform: { pivotX: 100, pivotY: 100 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && (r.byInvariant['I-6'] ?? 0) > 0,
    'I-6 fail: boneWeights.length≠vertexCount triggers I-6',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── I-7: bone pivot finiteness ────────────────────────────────────────
{
  const project = {
    nodes: [
      { id: 'bone1', type: 'group', name: 'head', boneRole: 'head',
        transform: { pivotX: NaN, pivotY: 100 } },
    ],
  };
  const r = runRigInvariantChecks(project);
  assert(!r.ok && r.byInvariant['I-7'] === 1,
    'I-7 fail: NaN bone pivot triggers I-7',
    `byInvariant=${JSON.stringify(r.byInvariant)}`);
}

// ── degenerate input: null project / empty nodes ──────────────────────
{
  const r1 = runRigInvariantChecks(null);
  assert(r1.ok && r1.violationCount === 0, 'null project → clean summary');
  const r2 = runRigInvariantChecks({ nodes: [] });
  assert(r2.ok && r2.violationCount === 0, 'empty nodes → clean summary');
  const r3 = runRigInvariantChecks({});
  assert(r3.ok && r3.violationCount === 0, 'no nodes key → clean summary');
}

// restore the logger
logger.error = _origError;
logger.info = _origInfo;

console.log(`rigInvariantCheck: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
