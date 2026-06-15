// Depgraph eval of a BASE EYE compound (closure × smile × angry = 3 axes),
// shaped exactly as artMeshSourceEmit now emits. Base tagged 'face'
// (backdrop) so the artMesh.js base-fade override is OFF → we test the raw
// N-D keyform blend = what Cubism gets. Verifies:
//   - opacity = (1-Smile)(1-Angry), independent of blink
//   - geometry blends on the closure axis at every variant value (blink
//     still works while smile/angry fade)
// See `feedback_variant_base_fade_multi_suffix`.
//
// Run: node scripts/test/test_variantBaseFadeEyeDepgraph.mjs

import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';
import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { buildEyeCompoundBaseGridCorners } from '../../src/io/live2d/rig/variantFadeGrid.js';

let pass = 0, fail = 0;
const near = (a, b, m) => { if (typeof a === 'number' && Math.abs(a - b) < 1e-6) pass++; else { fail++; console.error(`FAIL: ${m} (got ${a}, want ${b})`); } };

const OPEN = [200, 150, 600, 150, 400, 450];   // rest / open geometry
const CLOSED = [200, 300, 600, 300, 400, 300];  // collapsed-to-midline closed eye

// Base eye runtime keyforms: closure × smile × angry, exactly as the new
// artMeshSourceEmit base-eye branch builds them.
function baseEyeRuntime() {
  const corners = buildEyeCompoundBaseGridCorners(2); // smile, angry
  return {
    bindings: [
      { parameterId: 'ParamEyeLOpen', keys: [0, 1], interpolation: 'LINEAR' },
      { parameterId: 'ParamSmile', keys: [0, 1], interpolation: 'LINEAR' },
      { parameterId: 'ParamAngry', keys: [0, 1], interpolation: 'LINEAR' },
    ],
    keyforms: corners.map((c) => ({
      keyTuple: [c.closureKey, ...c.keyIndices],
      vertexPositions: c.geometry === 'closed' ? [...CLOSED] : [...OPEN],
      opacity: c.opacity,
    })),
  };
}

const part = (id, name, runtime, extra = {}) => ({
  id, type: 'part', name, visible: true, opacity: extra.opacity ?? 1,
  draw_order: extra.draw_order ?? 0, variantOf: extra.variantOf, variantSuffix: extra.variantSuffix,
  modifiers: [],
  mesh: { vertices: [...OPEN], triangles: [0, 1, 2], uvs: [0, 0, 1, 0, 0.5, 1], runtime },
});

const project = {
  canvas: { width: 800, height: 600 },
  parameters: [
    { id: 'ParamEyeLOpen', min: 0, max: 1, default: 1 },
    { id: 'ParamSmile', min: 0, max: 1, default: 0 },
    { id: 'ParamAngry', min: 0, max: 1, default: 0 },
  ],
  nodes: [
    { id: 'g', type: 'group', name: 'Body', parent: null, visible: true, opacity: 1 },
    // tag 'face' → backdrop → override OFF (we read the raw keyform blend).
    part('base', 'face', baseEyeRuntime(), { draw_order: 0 }),
    part('vS', 'face.smile', { bindings: [{ parameterId: 'ParamSmile', keys: [0, 1] }], keyforms: [{ keyTuple: [0], vertexPositions: [...OPEN], opacity: 0 }, { keyTuple: [1], vertexPositions: [...OPEN], opacity: 1 }] }, { variantOf: 'base', variantSuffix: 'smile', opacity: 0, draw_order: 1 }),
    part('vA', 'face.angry', { bindings: [{ parameterId: 'ParamAngry', keys: [0, 1] }], keyforms: [{ keyTuple: [0], vertexPositions: [...OPEN], opacity: 0 }, { keyTuple: [1], vertexPositions: [...OPEN], opacity: 1 }] }, { variantOf: 'base', variantSuffix: 'angry', opacity: 0, draw_order: 2 }),
  ],
};

const rigSpec = selectRigSpec(project);
const frame = (vals) => {
  const f = evalProjectFrameViaDepgraph(project, vals, { rigSpec });
  return f.find((x) => x.id === 'base');
};

// Opacity = (1-Smile)(1-Angry), independent of blink (ParamEyeLOpen).
near(frame({ ParamEyeLOpen: 1, ParamSmile: 0, ParamAngry: 0 }).opacity, 1, 'rest open: base 1');
near(frame({ ParamEyeLOpen: 0, ParamSmile: 0, ParamAngry: 0 }).opacity, 1, 'rest closed (blink): base still 1');
near(frame({ ParamEyeLOpen: 1, ParamSmile: 0, ParamAngry: 1 }).opacity, 0, 'angry=1: base hidden (THE FIX) regardless of blink');
near(frame({ ParamEyeLOpen: 0, ParamSmile: 0, ParamAngry: 1 }).opacity, 0, 'angry=1 + blink: base hidden');
near(frame({ ParamEyeLOpen: 1, ParamSmile: 1, ParamAngry: 0 }).opacity, 0, 'smile=1: base hidden');
near(frame({ ParamEyeLOpen: 1, ParamSmile: 0.5, ParamAngry: 0.5 }).opacity, 0.25, 'mid: product 0.25');

// Geometry blends on closure (blink works) at variant=0 AND while a variant fades.
const openV = frame({ ParamEyeLOpen: 1, ParamSmile: 0, ParamAngry: 0 }).vertexPositions;
const closedV = frame({ ParamEyeLOpen: 0, ParamSmile: 0, ParamAngry: 0 }).vertexPositions;
near(openV[1], 150, 'open: vertex y = 150 (open geometry)');
near(closedV[1], 300, 'closed: vertex y = 300 (closed geometry) — blink works');
// blink still deforms geometry even while angry is partially active
const halfBlinkAngry = frame({ ParamEyeLOpen: 0, ParamSmile: 0, ParamAngry: 0.5 }).vertexPositions;
near(halfBlinkAngry[1], 300, 'blink geometry intact while angry=0.5 fades opacity');

console.log(`\nvariantBaseFadeEyeDepgraph: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
