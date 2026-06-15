// REPRO / VERIFY — the N-D base-fade keyform hides the base for EVERY
// variant, with NO depgraph override (i.e. what Cubism gets from export).
//
// We tag the base 'face' (backdrop) so _resolvePairedVariantSuffixes
// returns [] and the artMesh.js base-fade override is SKIPPED — the eval
// reads the raw keyform blend. If the base goes to 0 at angry=1 AND
// smile=1, the baked product grid alone is correct (override redundant).
//
// Run: node scripts/test/repro_variantBaseFadeMulti.mjs

import { selectRigSpec } from '../../src/io/live2d/rig/selectRigSpec.js';
import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { buildVariantProductGridCorners } from '../../src/io/live2d/rig/variantFadeGrid.js';

const TRI = [200, 150, 600, 150, 400, 450];
let pass = 0, fail = 0;
const near = (a, b, m) => { if (Math.abs(a - b) < 1e-6) pass++; else { fail++; console.error(`FAIL: ${m} (got ${a}, want ${b})`); } };

// N-D base-fade runtime keyforms EXACTLY as artMeshSourceEmit now emits:
// corners first-suffix-fastest, opacity 1 only at origin, bound to both params.
function nDBaseRuntime(suffixParams) {
  const corners = buildVariantProductGridCorners(suffixParams.length);
  return {
    bindings: suffixParams.map((p) => ({ parameterId: p, keys: [0, 1], interpolation: 'LINEAR' })),
    keyforms: corners.map((c) => ({
      keyTuple: c.keyIndices.slice(),
      vertexPositions: [...TRI],
      opacity: c.opacity,
    })),
  };
}

function mkPart(id, name, runtime, extra = {}) {
  return {
    id, type: 'part', name, visible: true,
    opacity: extra.opacity ?? 1, draw_order: extra.draw_order ?? 0,
    variantOf: extra.variantOf, variantSuffix: extra.variantSuffix,
    modifiers: [],
    mesh: { vertices: [...TRI], triangles: [0, 1, 2], uvs: [0, 0, 1, 0, 0.5, 1], runtime },
  };
}

// Base tagged 'face' → backdrop → override OFF → raw keyform blend only.
const project = {
  canvas: { width: 800, height: 600 },
  parameters: [
    { id: 'ParamSmile', min: 0, max: 1, default: 0 },
    { id: 'ParamAngry', min: 0, max: 1, default: 0 },
  ],
  nodes: [
    { id: 'g1', type: 'group', name: 'Body', parent: null, visible: true, opacity: 1 },
    mkPart('base', 'face', nDBaseRuntime(['ParamSmile', 'ParamAngry']), { draw_order: 0 }),
    mkPart('vSmile', 'face.smile', { bindings: [{ parameterId: 'ParamSmile', keys: [0, 1] }], keyforms: [{ keyTuple: [0], vertexPositions: [...TRI], opacity: 0 }, { keyTuple: [1], vertexPositions: [...TRI], opacity: 1 }] }, { variantOf: 'base', variantSuffix: 'smile', opacity: 0, draw_order: 1 }),
    mkPart('vAngry', 'face.angry', { bindings: [{ parameterId: 'ParamAngry', keys: [0, 1] }], keyforms: [{ keyTuple: [0], vertexPositions: [...TRI], opacity: 0 }, { keyTuple: [1], vertexPositions: [...TRI], opacity: 1 }] }, { variantOf: 'base', variantSuffix: 'angry', opacity: 0, draw_order: 2 }),
  ],
};

const rigSpec = selectRigSpec(project);
const baseAm = rigSpec.artMeshes.find(a => a.id === 'base');
console.log('base.pairedVariantSuffixes =', JSON.stringify(baseAm?.pairedVariantSuffixes), '(empty ⇒ override OFF, raw keyform)');

const op = (vals) => {
  const f = evalProjectFrameViaDepgraph(project, vals, { rigSpec });
  const g = (id) => f.find(x => x.id === id)?.opacity;
  return { base: g('base'), smile: g('vSmile'), angry: g('vAngry') };
};

const rest = op({ ParamSmile: 0, ParamAngry: 0 });
const smile = op({ ParamSmile: 1, ParamAngry: 0 });
const angry = op({ ParamSmile: 0, ParamAngry: 1 });
const mid = op({ ParamSmile: 0.5, ParamAngry: 0.5 });
console.log('rest   ', rest);
console.log('smile=1', smile);
console.log('angry=1', angry, '  ← THE BUG: base must be 0 here, not 1');
console.log('mid    ', mid);

near(rest.base, 1, 'rest: base visible');
near(smile.base, 0, 'smile=1: base hidden (raw keyform, no override)');
near(angry.base, 0, 'angry=1: base hidden (raw keyform, no override) — the fix');
near(mid.base, 0.25, 'mid: base = (1-.5)(1-.5) = 0.25 product');
near(angry.smile, 0, 'angry=1: smile variant hidden');
near(angry.angry, 1, 'angry=1: angry variant visible');

console.log(`\nbaseFadeMulti: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
