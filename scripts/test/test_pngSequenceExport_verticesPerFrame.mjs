// Regression for the PNG sequence export "all frames identical to
// first frame" bug (2026-06-11).
//
// Root cause: `captureExportFrame` passed the depgraph's flat
// `Float32Array` directly to `scene.parts.uploadPositions`, which
// expects object-vert shape `[{x,y},…]`. Iterating a flat array as
// if it were object-array read `vertices[i].x` → `undefined` → NaN
// soup in the GPU buffer → the deformed per-frame upload was a no-op
// and every exported PNG fell back to whatever the canvas already had
// (the rest pose from the last live tick).
//
// What this test pins:
//   1. `evalProjectFrameViaDepgraph` IS time-correct — different
//      `timeMs` values produce different per-part vertex positions.
//      If this regresses, the bug is in the eval layer, not the
//      capture layer.
//   2. `frame.vertexPositions` is a flat `Float32Array` — sibling
//      callers (including `captureExportFrame`) MUST convert before
//      handing it to `uploadPositions`. The shape contract is
//      asserted here so a future depgraph refactor doesn't silently
//      mismatch consumers.
//   3. After the flat→object conversion, the entries are real
//      `{x:number, y:number}` records — not the `undefined.x` that
//      the bug produced for every vertex.
//
// Run: node scripts/test/test_pngSequenceExport_verticesPerFrame.mjs

import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';
import { computePoseOverrides, computeParamOverrides } from '../../src/renderer/animationEngine.js';
import { synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

const REST = [350, 250, 450, 250, 350, 350, 450, 350];

function makeProject() {
  return {
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false },
    parameters: [],
    nodes: [
      { id: 'grp', type: 'group', boneRole: 'rightArm', name: 'rightArm', parent: null,
        transform: { pivotX: 400, pivotY: 300, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'part', type: 'part', name: 'part', visible: true, draw_order: 100,
        parent: 'grp', rigParent: null,
        mesh: {
          uvs: [0, 0, 1, 0, 0, 1, 1, 1],
          triangles: [0, 1, 2, 1, 3, 2],
          vertices: REST.slice(),
          boneWeights: [1, 1, 1, 1],
          jointBoneId: 'grp',
          runtime: {
            parent: { type: 'root', id: null },
            bindings: [],
            keyforms: [{ keyTuple: [], opacity: 1, vertexPositions: REST.slice() }],
          },
        } },
    ],
    actions: [
      {
        id: 'act-rotate',
        name: 'rotate',
        duration: 1000,
        fps: 24,
        fcurves: [
          {
            rnaPath: 'objects["grp"].pose.rotation',
            keyforms: [
              { time: 0, value: 0, interpolation: 'linear' },
              { time: 1000, value: 90, interpolation: 'linear' },
            ],
          },
        ],
      },
    ],
    animations: [], physicsRules: [],
  };
}

// ── §1 — eval is time-correct ────────────────────────────────────────

const project = makeProject();
synthesizeModifierStacks(project);
const action = project.actions[0];

const samples = [0, 250, 500, 750, 1000];
/** @type {Array<{timeMs:number, frame:any}>} */
const evalOutputs = [];
for (const timeMs of samples) {
  const poseOverrides = computePoseOverrides(action, timeMs, false, 1000);
  const paramOv = computeParamOverrides(action, timeMs, false, 1000);
  const paramValues = {};
  for (const p of project.parameters) paramValues[p.id] = p.default ?? 0;
  for (const [pid, v] of paramOv) paramValues[pid] = v;
  const frames = evalProjectFrameViaDepgraph(project, paramValues, {
    action, timeMs, poseOverrides,
  });
  const partFrame = frames.find((f) => f.id === 'part');
  evalOutputs.push({ timeMs, frame: partFrame });
}

// Sanity — every timestamp emitted a frame.
for (const out of evalOutputs) {
  ok(out.frame != null, `§1 — frame emitted at t=${out.timeMs}ms`);
  ok(out.frame?.vertexPositions != null, `§1 — vertexPositions present at t=${out.timeMs}ms`);
}

// All-frames-different (the bug was all-frames-equal).
const v0_t0 = evalOutputs[0].frame.vertexPositions;
let anyDifferent = false;
for (let i = 1; i < evalOutputs.length; i++) {
  const v0_tN = evalOutputs[i].frame.vertexPositions;
  if (v0_tN[0] !== v0_t0[0] || v0_tN[1] !== v0_t0[1]) { anyDifferent = true; break; }
}
ok(anyDifferent, '§1 — vertex[0] differs across timeMs (not stuck at rest)');

// Rest pose at t=0; full rotation at t=1000ms.
const v0_t1000 = evalOutputs[4].frame.vertexPositions;
ok(Math.abs(v0_t0[0] - 350) < 0.01, '§1 — t=0 rests at REST[0].x = 350');
ok(Math.abs(v0_t1000[0] - 450) < 0.05, `§1 — t=1000 rotates v0.x toward 450 (got ${v0_t1000[0].toFixed(3)})`);

// ── §2 — vertexPositions is a flat Float32Array ──────────────────────

const sampleVP = evalOutputs[2].frame.vertexPositions;
ok(sampleVP instanceof Float32Array, '§2 — vertexPositions is a Float32Array');
ok(sampleVP.length === 8, `§2 — 4-vert quad → 8 floats (got ${sampleVP.length})`);
// A flat array of numbers does NOT have `.x`/`.y` on entries — that's
// exactly what the bug exploited.
ok(sampleVP[0] !== undefined && typeof sampleVP[0] === 'number',
  '§2 — flat entries are numbers (Float32Array values)');
ok(typeof (/** @type {any} */ (sampleVP[0])).x === 'undefined',
  '§2 — flat entries do NOT have .x — confirming the shape contract uploadPositions cannot consume directly');

// ── §3 — flat→object conversion produces uploadPositions-compatible verts ──

/**
 * Mirrors `captureExportFrame.js` (post-fix) + `CanvasViewport.jsx:1511-1516`.
 * @param {Float32Array} flat
 */
function flatToObjVerts(flat) {
  const len = flat.length >> 1;
  const out = new Array(len);
  for (let i = 0; i < len; i++) out[i] = { x: flat[i * 2], y: flat[i * 2 + 1] };
  return out;
}

const objVerts = flatToObjVerts(sampleVP);
ok(objVerts.length === 4, '§3 — converted object-array length = vertex count (4)');
ok(typeof objVerts[0].x === 'number' && Number.isFinite(objVerts[0].x),
  '§3 — converted .x is a finite number (NOT undefined → NaN, the bug shape)');
ok(typeof objVerts[0].y === 'number' && Number.isFinite(objVerts[0].y),
  '§3 — converted .y is a finite number');
ok(objVerts[0].x === sampleVP[0] && objVerts[0].y === sampleVP[1],
  '§3 — converted entries match flat values');

// Mimic the bug shape — what uploadPositions would do if handed the
// flat array directly. Asserting this fails proves why we need the
// conversion.
/** @type {any} */
const buggyAsObj = sampleVP;
ok(buggyAsObj[0].x === undefined,
  '§3 — buggy direct pass: reading .x off a flat Float32Array entry yields undefined (root cause of all-NaN GPU upload)');

console.log(`pngSequenceExport_verticesPerFrame: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
