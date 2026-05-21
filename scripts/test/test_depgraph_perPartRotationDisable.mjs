// Per-part modifier disable for ROTATION-leaf parts (2026-05-21).
//
// The reported bug: a bone-baked part (legwear) whose modifier stack is
//   [rotation GroupRotation, ..., lattice BodyWarp, ...]
// kept deforming with ParamBreath even after the user disabled the body
// warp's viewport display (eye icon → clears `mode & MODE_REALTIME`).
//
// Root cause: the leaf rotation's canvas-final matrix is composed (via the
// global ROTATION_SETUP_PROBE / MATRIX_BUILD) through the rotation's GLOBAL
// `def.parent` chain — which includes the body warp. Because the rotation
// is canvas-final it collapses the chain, so the lattice modifiers BELOW it
// in the stack are absorbed into that matrix and toggling them does nothing.
//
// Fix: when a part disables an ancestor, the rotation's canvas-final matrix
// is recomputed (`computePerPartRotationCanvasFinal`) by FD-probing its
// pivot through the part's EFFECTIVE (enabled) chain, so the disabled warp
// is genuinely excluded. The all-enabled path still reuses the global op
// verbatim (byte-identical — oracle/parity untouched).
//
// Run: node scripts/test/test_depgraph_perPartRotationDisable.mjs

import { buildDepGraph } from '../../src/anim/depgraph/build.js';
import { evalDepGraph } from '../../src/anim/depgraph/eval.js';
import { MODIFIER_MODE_RENDER } from '../../src/anim/modifierTypeInfo.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// A root warp `W` that SHIFTS with ParamX (P=0 identity 0..100; P=1 shifts
// +50 in X), a rotation `R` (identity angle) parented to W with pivot at the
// warp-local centre (0.5, 0.5), and a part `p` whose single vertex sits at
// (0,0) and rides R then W. With angle 0 the rotation maps (0,0) → its
// canvas-final pivot, so the part's output vertex == R's probed pivot —
// which moves with ParamX ONLY while W contributes to the probe.
function makeProject() {
  return {
    canvas: { width: 100, height: 100, x: 0, y: 0 },
    parameters: [{ id: 'P', default: 0 }],
    nodes: [
      { id: 'W', type: 'deformer', deformerKind: 'warp', parent: null,
        gridSize: { rows: 1, cols: 1 },
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], positions: [0, 0, 100, 0, 0, 100, 100, 100], opacity: 1 },
          { keyTuple: [1], positions: [50, 0, 150, 0, 50, 100, 150, 100], opacity: 1 },
        ],
        isQuadTransform: false },
      { id: 'R', type: 'deformer', deformerKind: 'rotation', parent: 'W',
        baseAngle: 0,
        bindings: [],
        keyforms: [{ keyTuple: [], angle: 0, originX: 0.5, originY: 0.5, scale: 1, opacity: 1 }] },
      { id: 'p', type: 'part', name: 'p',
        rigParent: 'R',
        mesh: {
          vertices: [0, 0], uvs: [], triangles: [],
          runtime: {
            parent: { type: 'rotation', id: 'R' },
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [0, 0], opacity: 1 }],
          },
        },
        modifiers: [
          { type: 'rotation', deformerId: 'R', enabled: true },
          { type: 'warp', deformerId: 'W', enabled: true },
        ] },
    ],
    animations: [], physicsRules: [],
  };
}

function evalPartVerts(project, pValue) {
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0,
    paramOverrides: new Map([['P', pValue]]) });
  for (const [name, value] of ctx.outputs) {
    if (name.includes('p/GEOMETRY/ART_MESH_EVAL')) {
      return value?.vertexPositions ? Array.from(value.vertexPositions) : null;
    }
  }
  return null;
}

// ---- 1. Warp ENABLED: the rotation pivot follows ParamX (non-vacuous) ----
{
  const proj = makeProject();
  const at0 = evalPartVerts(proj, 0);
  const at1 = evalPartVerts(proj, 1);
  assert(Array.isArray(at0) && Array.isArray(at1), 'enabled: produced verts');
  assert(JSON.stringify(at0) !== JSON.stringify(at1),
    `enabled: part moves with ParamX (warp drives the rotation pivot) (at0=${JSON.stringify(at0)} at1=${JSON.stringify(at1)})`);
  // Sanity: P=0 lands at warp-centre (50,50); P=1 at the shifted centre (100,50).
  assert(Math.abs(at0[0] - 50) < 0.5 && Math.abs(at0[1] - 50) < 0.5,
    `enabled P=0: pivot ≈ (50,50) (got ${JSON.stringify(at0)})`);
  assert(Math.abs(at1[0] - 100) < 0.5 && Math.abs(at1[1] - 50) < 0.5,
    `enabled P=1: pivot ≈ (100,50) (got ${JSON.stringify(at1)})`);
}

// ---- 2. Warp eye DISABLED: the rotation no longer follows ParamX ----
// This is the fix: the leaf rotation's canvas-final matrix is recomputed
// through the part's effective chain (W excluded), so ParamX has no effect.
{
  const proj = makeProject();
  const wMod = proj.nodes.find((n) => n.id === 'p').modifiers[1];
  wMod.mode = MODIFIER_MODE_RENDER; // viewport (REALTIME) bit cleared = eye off
  assert(wMod.enabled !== false, 'disabled: warp still enabled (only mode cleared)');

  const at0 = evalPartVerts(proj, 0);
  const at1 = evalPartVerts(proj, 1);
  assert(JSON.stringify(at0) === JSON.stringify(at1),
    `disabled: ParamX no longer moves the part — Breath effect removed (at0=${JSON.stringify(at0)} at1=${JSON.stringify(at1)})`);

  // And it must DIFFER from the enabled result at P=1 (proves the warp's
  // contribution was actually removed, not merely frozen at the enabled value).
  const enabledAt1 = evalPartVerts(makeProject(), 1);
  assert(JSON.stringify(at1) !== JSON.stringify(enabledAt1),
    `disabled vs enabled at P=1 differ (warp contribution excluded) (disabled=${JSON.stringify(at1)} enabled=${JSON.stringify(enabledAt1)})`);
}

// ---- 3. ✓/× enabled=false path also excludes the warp (DEPGRAPH only) ----
// SCOPE: this pins the DEPGRAPH (viewport / Live Preview) engine. The eye
// toggle (MODE_REALTIME) is viewport-only, so the depgraph fix fully covers
// it. The ✓/× `enabled` flag, however, ALSO affects the EXPORT path
// (chainEval/selectRigSpec) — and chainEval was NOT changed this session: its
// per-part `modifierChain` walk uses per-part lift for warp steps but the
// GLOBAL rotation matrix for rotation steps (chainEval.js:293-304), so a
// rotation-leaf part whose ancestor warp is enabled=false will still bake the
// warp into its pivot on EXPORT. That export-side gap is NOT pinned here. See
// the chainEval rotation-leaf gap noted in the session close-out.
{
  const proj = makeProject();
  proj.nodes.find((n) => n.id === 'p').modifiers[1].enabled = false;
  const at0 = evalPartVerts(proj, 0);
  const at1 = evalPartVerts(proj, 1);
  assert(JSON.stringify(at0) === JSON.stringify(at1),
    'enabled=false: ParamX no longer moves the part in the depgraph (both toggles honored)');
}

console.log(`depgraph_perPartRotationDisable: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
