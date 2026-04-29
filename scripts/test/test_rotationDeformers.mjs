// v3 Phase 0F.29 - tests for src/io/live2d/rig/rotationDeformers.js
//
// buildFaceRotationSpec + buildGroupRotationSpec produce the
// RotationDeformerSpec entries that go into rigSpec. cmo3writer +
// moc3writer both consume these. A bug here means face/group
// rotation breaks in every export.
//
// Run: node scripts/test/test_rotationDeformers.mjs

import {
  buildFaceRotationSpec,
  buildGroupRotationSpec,
} from '../../src/io/live2d/rig/rotationDeformers.js';

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

// ── buildFaceRotationSpec: warp-parented (default chain) ─────────

{
  const { spec } = buildFaceRotationSpec({
    facePivotCanvasX: 400,
    facePivotCanvasY: 300,
    parentType: 'warp',
    parentDeformerId: 'BodyXWarp',
    canvasToBodyXX: (x) => x / 800,  // simulate warp-normalise
    canvasToBodyXY: (y) => y / 600,
  });

  assert(spec.id === 'FaceRotation', 'face spec: id');
  assert(spec.name === 'Face Rotation', 'face spec: name');
  assert(spec.parent.type === 'warp', 'face spec: parent type warp');
  assert(spec.parent.id === 'BodyXWarp', 'face spec: parent id');
  assert(spec.bindings.length === 1, 'face spec: 1 binding');
  assert(spec.bindings[0].parameterId === 'ParamAngleZ', 'face spec: binds ParamAngleZ');
  assert(JSON.stringify(spec.bindings[0].keys) === '[-30,0,30]',
    'face spec: default keys');
  assert(spec.keyforms.length === 3, 'face spec: 3 keyforms');
  // Pivot under warp parent is normalised
  assert(spec.keyforms[0].originX === 0.5, 'face spec: pivot X normalised (400/800)');
  assert(spec.keyforms[0].originY === 0.5, 'face spec: pivot Y normalised (300/600)');
  // Default angles ±10° per Hiyori
  assert(spec.keyforms[0].angle === -10, 'face spec: -30 → -10°');
  assert(spec.keyforms[1].angle === 0, 'face spec: 0 → 0°');
  assert(spec.keyforms[2].angle === 10, 'face spec: +30 → +10°');
}

// ── buildFaceRotationSpec: rotation-parented (under head rotation) ─

{
  const { spec } = buildFaceRotationSpec({
    facePivotCanvasX: 400,
    facePivotCanvasY: 300,
    parentType: 'rotation',
    parentDeformerId: 'GroupRotation_head',
    parentPivotCanvas: { x: 350, y: 250 },
    canvasToBodyXX: () => 0,  // unused under rotation
    canvasToBodyXY: () => 0,
  });

  assert(spec.parent.type === 'rotation', 'face/rot: parent type rotation');
  // Pivot under rotation is canvas-px offset from parent pivot
  assert(spec.keyforms[0].originX === 50, 'face/rot: pivot offset X (400-350)');
  assert(spec.keyforms[0].originY === 50, 'face/rot: pivot offset Y (300-250)');
}

// ── buildFaceRotationSpec: validation ────────────────────────────

{
  // Missing parentPivotCanvas under rotation → throws
  assertThrows(() => buildFaceRotationSpec({
    facePivotCanvasX: 0, facePivotCanvasY: 0,
    parentType: 'rotation',
    parentDeformerId: 'X',
    canvasToBodyXX: () => 0,
    canvasToBodyXY: () => 0,
  }), 'face: rotation parent without pivotCanvas throws');

  // Mismatched paramKeys / angles lengths
  assertThrows(() => buildFaceRotationSpec({
    facePivotCanvasX: 0, facePivotCanvasY: 0,
    parentType: 'warp',
    parentDeformerId: 'X',
    canvasToBodyXX: () => 0,
    canvasToBodyXY: () => 0,
    paramKeys: [-30, 0],
    angles: [-10, 0, 10],
  }), 'face: param/angle length mismatch throws');
}

// ── buildFaceRotationSpec: custom param keys + angles ────────────

{
  const { spec } = buildFaceRotationSpec({
    facePivotCanvasX: 0, facePivotCanvasY: 0,
    parentType: 'warp',
    parentDeformerId: 'X',
    canvasToBodyXX: () => 0,
    canvasToBodyXY: () => 0,
    paramKeys: [-45, 0, 45],
    angles:    [-15, 0, 15],
  });
  assert(JSON.stringify(spec.bindings[0].keys) === '[-45,0,45]',
    'face: custom keys');
  assert(spec.keyforms[0].angle === -15, 'face: custom angle');
}

// ── buildGroupRotationSpec: defaults ─────────────────────────────

{
  const { spec } = buildGroupRotationSpec({
    id: 'GroupRotation_neck',
    name: 'Rotation neck',
    paramId: 'ParamRotation_neck',
    pivotCanvas: { x: 400, y: 100 },
  });

  assert(spec.id === 'GroupRotation_neck', 'group: id pass-through');
  assert(spec.name === 'Rotation neck', 'group: name pass-through');
  assert(spec.parent.type === 'root', 'group: starts ROOT-parented (re-parented later)');
  assert(spec.parent.id === null, 'group: ROOT id is null');
  assert(spec.bindings[0].parameterId === 'ParamRotation_neck', 'group: paramId');

  // Default keys + angles (1:1 ±30)
  assert(JSON.stringify(spec.bindings[0].keys) === '[-30,0,30]', 'group: default keys');
  assert(spec.keyforms[0].angle === -30, 'group: default angle -30');
  assert(spec.keyforms[2].angle === 30, 'group: default angle +30');

  // Pivot stored in canvas frame (translator handles conversion)
  assert(spec.keyforms[0].originX === 400, 'group: pivot X canvas frame');
  assert(spec.keyforms[0].originY === 100, 'group: pivot Y canvas frame');
}

// ── buildGroupRotationSpec: custom mapping ───────────────────────

{
  const { spec } = buildGroupRotationSpec({
    id: 'GroupRotation_arm',
    name: 'arm',
    paramId: 'P',
    pivotCanvas: { x: 0, y: 0 },
    paramKeys: [-90, 0, 90],
    angles:    [-45, 0, 45],
  });
  assert(spec.bindings[0].keys[0] === -90, 'group custom: keys');
  assert(spec.keyforms[0].angle === -45, 'group custom: half-mapping');
}

// ── buildGroupRotationSpec: validation ───────────────────────────

assertThrows(() => buildGroupRotationSpec({
  id: 'X', name: 'X', paramId: 'P',
  pivotCanvas: { x: 0, y: 0 },
  paramKeys: [-30, 0],
  angles: [-30, 0, 30],
}), 'group: param/angle length mismatch throws');

// ── Spec shape invariants (both builders) ────────────────────────

{
  const specs = [
    buildFaceRotationSpec({
      facePivotCanvasX: 0, facePivotCanvasY: 0,
      parentType: 'warp', parentDeformerId: 'X',
      canvasToBodyXX: () => 0, canvasToBodyXY: () => 0,
    }).spec,
    buildGroupRotationSpec({
      id: 'X', name: 'X', paramId: 'P', pivotCanvas: { x: 0, y: 0 },
    }).spec,
  ];

  for (const spec of specs) {
    if (spec.handleLengthOnCanvas !== 200) {
      failed++; console.error('FAIL: handleLength != 200'); break;
    }
    if (spec.circleRadiusOnCanvas !== 100) {
      failed++; console.error('FAIL: circleRadius != 100'); break;
    }
    if (spec.baseAngle !== 0) {
      failed++; console.error('FAIL: baseAngle != 0'); break;
    }
    if (spec.isVisible !== true || spec.isLocked !== false) {
      failed++; console.error('FAIL: visibility flags'); break;
    }
    if (spec.useBoneUiTestImpl !== true) {
      failed++; console.error('FAIL: useBoneUiTestImpl'); break;
    }
  }
  passed++;
}

console.log(`rotationDeformers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
