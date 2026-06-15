// Multi-variant base-fade — moc3 plan + cmo3 rig-data emit shape.
//
// A base part paired with TWO variants (.smile + .angry) must fade out on
// BOTH (opacity = ∏(1-pi)), not just the first. Covers the plain base-fade
// (eyebrow) and the eye-compound base (closure × N-variant). Mirrors the
// cmo3 (artMeshSourceEmit) and moc3 (meshBindingPlan) emit shapes.
// See `feedback_variant_base_fade_multi_suffix`.
//
// Run: node scripts/test/test_variantBaseFadeMultiEmit.mjs

import { buildMeshBindingPlan } from '../../src/io/live2d/moc3/meshBindingPlan.js';

let passed = 0, failed = 0;
const assertEq = (actual, expected, name) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${e}\n  actual:   ${a}`);
};
const assert = (c, m) => { if (c) passed++; else { failed++; console.error(`FAIL: ${m}`); } };

const BACKDROP = new Set(['face', 'ears', 'ears-l', 'ears-r', 'front hair', 'back hair']);
const mesh = (n = 3) => {
  const verts = [];
  for (let i = 0; i < n; i++) verts.push({ x: i * 10, y: i * 10 });
  return { vertices: verts, triangles: [[0, 1, 2]] };
};

// ── §1 moc3: plain base (eyebrow) with .smile + .angry → N-D product ──
{
  const base = { id: 'eb', name: 'eyebrow-l', type: 'part', visible: true, opacity: 1, mesh: mesh(), variantSuffix: null, variantOf: null };
  const vS = { id: 'eb_s', name: 'eyebrow-l.smile', type: 'part', visible: true, opacity: 0, mesh: mesh(), variantSuffix: 'smile', variantOf: 'eb' };
  const vA = { id: 'eb_a', name: 'eyebrow-l.angry', type: 'part', visible: true, opacity: 0, mesh: mesh(), variantSuffix: 'angry', variantOf: 'eb' };
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts: [base, vS, vA], groups: [], rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90], backdropTagsSet: BACKDROP,
  });
  const p = meshBindingPlan[0];
  assertEq(p.bindings, [{ paramId: 'ParamSmile', keys: [0, 1] }, { paramId: 'ParamAngry', keys: [0, 1] }],
    '§1 base binds BOTH variant params');
  // corners first-suffix-fastest: (0,0)(1,0)(0,1)(1,1) → opacity 1,0,0,0
  assertEq(p.keyformOpacities, [1, 0, 0, 0], '§1 opacity 1 only at all-zero corner');
  assert(p.perVertexPositions === null, '§1 base-fade has no geometry change');
  // variants still fade in on their own param
  assertEq(meshBindingPlan[1].keyformOpacities, [0, 1], '§1 smile fades in');
  assertEq(meshBindingPlan[2].paramId, 'ParamAngry', '§1 angry on ParamAngry');
  assertEq(meshBindingPlan[2].keyformOpacities, [0, 1], '§1 angry fades in');
}

// ── §2 moc3: eye-compound base (eyewhite) with .smile + .angry ────────
{
  const base = { id: 'ew', name: 'eyewhite-l', type: 'part', visible: true, opacity: 1, mesh: mesh(), variantSuffix: null, variantOf: null };
  const vS = { id: 'ew_s', name: 'eyewhite-l.smile', type: 'part', visible: true, opacity: 0, mesh: mesh(), variantSuffix: 'smile', variantOf: 'ew' };
  const vA = { id: 'ew_a', name: 'eyewhite-l.angry', type: 'part', visible: true, opacity: 0, mesh: mesh(), variantSuffix: 'angry', variantOf: 'ew' };
  const rigSpec = { eyeClosure: new Map([['ew', { closureSide: 'l', closedCanvasVerts: new Float32Array([0, 0, 5, 0, 10, 0]) }]]) };
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts: [base, vS, vA], groups: [], rigSpec,
    bakedKeyformAngles: [-90, -45, 0, 45, 90], backdropTagsSet: BACKDROP,
  });
  const p = meshBindingPlan[0];
  // 3 axes: closure + smile + angry
  assertEq(p.bindings, [
    { paramId: 'ParamEyeLOpen', keys: [0, 1] },
    { paramId: 'ParamSmile', keys: [0, 1] },
    { paramId: 'ParamAngry', keys: [0, 1] },
  ], '§2 base eye binds closure + BOTH variants');
  // 8 corners: closure fastest, opacity = variant product (closure-independent)
  // order: (c0,s0,a0)(c1,s0,a0)(c0,s1,a0)(c1,s1,a0)(c0,s0,a1)(c1,s0,a1)(c0,s1,a1)(c1,s1,a1)
  assertEq(p.keyformOpacities, [1, 1, 0, 0, 0, 0, 0, 0],
    '§2 opacity 1 only when BOTH variants 0 (either closure)');
  assertEq(p.perVertexPositions.length, 8, '§2 eight keyforms');
  // geometry alternates closed/open by closure (fastest)
  const closed = p.perVertexPositions[0];
  const open = p.perVertexPositions[1];
  assert(closed[0] === 0 && closed[2] === 5, '§2 corner 0 = closed verts');
  assert(open[0] === 0 && open[2] === 10, '§2 corner 1 = rest/open verts');
  // even indices closed, odd open
  assert(p.perVertexPositions.every((g, i) => (i % 2 === 0 ? g[2] === 5 : g[2] === 10)),
    '§2 closure varies fastest in geometry');
}

// ── §3 single-variant base stays legacy 1-D (no regression) ──────────
{
  const base = { id: 'eb', name: 'eyebrow-l', type: 'part', visible: true, opacity: 1, mesh: mesh(), variantSuffix: null, variantOf: null };
  const vS = { id: 'eb_s', name: 'eyebrow-l.smile', type: 'part', visible: true, opacity: 0, mesh: mesh(), variantSuffix: 'smile', variantOf: 'eb' };
  const { meshBindingPlan } = buildMeshBindingPlan({
    meshParts: [base, vS], groups: [], rigSpec: null,
    bakedKeyformAngles: [-90, -45, 0, 45, 90], backdropTagsSet: BACKDROP,
  });
  assertEq(meshBindingPlan[0].paramId, 'ParamSmile', '§3 N=1 base-fade on ParamSmile');
  assertEq(meshBindingPlan[0].keyformOpacities, [1, 0], '§3 N=1 legacy [1,0]');
  assertEq(meshBindingPlan[0].bindings, [{ paramId: 'ParamSmile', keys: [0, 1] }], '§3 N=1 single binding');
}

console.log(`variantBaseFadeMultiEmit: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
