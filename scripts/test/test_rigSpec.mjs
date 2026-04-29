// v3 Phase 0F.21 - tests for src/io/live2d/rig/rigSpec.js
//
// Tiny module - 3 exports - but the rig data layer's ground truth.
// Locking in the empty-rig shape and lookup semantics so changes
// to rigSpec.js don't silently break the cmo3/moc3 translators that
// depend on the shape.
//
// Run: node scripts/test/test_rigSpec.mjs

import {
  emptyRigSpec,
  findDeformer,
  findPart,
} from '../../src/io/live2d/rig/rigSpec.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── emptyRigSpec ──────────────────────────────────────────────────

{
  const r = emptyRigSpec({ w: 800, h: 600 });

  // Shape: every collection is an empty array
  assert(Array.isArray(r.parameters) && r.parameters.length === 0,
    'empty: parameters []');
  assert(Array.isArray(r.parts) && r.parts.length === 0, 'empty: parts []');
  assert(Array.isArray(r.warpDeformers) && r.warpDeformers.length === 0,
    'empty: warpDeformers []');
  assert(Array.isArray(r.rotationDeformers) && r.rotationDeformers.length === 0,
    'empty: rotationDeformers []');
  assert(Array.isArray(r.artMeshes) && r.artMeshes.length === 0,
    'empty: artMeshes []');
  assert(Array.isArray(r.physicsRules) && r.physicsRules.length === 0,
    'empty: physicsRules []');

  // Canvas passed through
  assert(r.canvas.w === 800 && r.canvas.h === 600, 'empty: canvas pass-through');

  // Body-warp / chain pointers null on empty rig
  assert(r.canvasToInnermostX === null, 'empty: canvasToInnermostX null');
  assert(r.canvasToInnermostY === null, 'empty: canvasToInnermostY null');
  assert(r.innermostBodyWarpId === null, 'empty: innermostBodyWarpId null');
  assert(r.bodyWarpChain === null, 'empty: bodyWarpChain null');
  assert(r.debug === null, 'empty: debug null');

  // Each call returns a fresh rig (mutation-safe)
  const r2 = emptyRigSpec({ w: 800, h: 600 });
  assert(r !== r2, 'empty: each call is fresh');
  assert(r.parameters !== r2.parameters, 'empty: arrays not shared');
}

// ── findDeformer ──────────────────────────────────────────────────

{
  const rig = emptyRigSpec({ w: 100, h: 100 });
  rig.warpDeformers.push({ id: 'BodyXWarp' }, { id: 'NeckWarp' });
  rig.rotationDeformers.push({ id: 'FaceRotation' }, { id: 'LeftElbow' });

  // Hits in warp list
  assert(findDeformer(rig, 'BodyXWarp')?.id === 'BodyXWarp',
    'findDeformer: warp by id');
  assert(findDeformer(rig, 'NeckWarp')?.id === 'NeckWarp',
    'findDeformer: 2nd warp');

  // Hits in rotation list
  assert(findDeformer(rig, 'FaceRotation')?.id === 'FaceRotation',
    'findDeformer: rotation by id');
  assert(findDeformer(rig, 'LeftElbow')?.id === 'LeftElbow',
    'findDeformer: 2nd rotation');

  // Miss returns null
  assert(findDeformer(rig, 'does-not-exist') === null,
    'findDeformer: miss → null');
  assert(findDeformer(rig, '') === null,
    'findDeformer: empty id → null');

  // Warp wins on naming collision (warp list searched first)
  rig.warpDeformers.push({ id: 'shared', kind: 'warp-version' });
  rig.rotationDeformers.push({ id: 'shared', kind: 'rotation-version' });
  assert(findDeformer(rig, 'shared')?.kind === 'warp-version',
    'findDeformer: warp wins on id collision');
}

// ── findPart ──────────────────────────────────────────────────────

{
  const rig = emptyRigSpec({ w: 100, h: 100 });
  rig.parts.push({ id: 'p1', name: 'face' }, { id: 'p2', name: 'body' });

  assert(findPart(rig, 'p1')?.name === 'face', 'findPart: by id');
  assert(findPart(rig, 'p2')?.name === 'body', 'findPart: 2nd');
  assert(findPart(rig, 'gone') === null, 'findPart: miss → null');
  assert(findPart(rig, '') === null, 'findPart: empty → null');
}

console.log(`rigSpec: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
