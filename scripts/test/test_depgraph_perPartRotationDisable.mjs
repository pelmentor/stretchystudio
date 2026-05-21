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
        // Rest grid (identity, == the P=0 keyform). A DISABLED warp composes
        // at this rest grid (frame-preserving pass-through), not excluded.
        baseGrid: [0, 0, 100, 0, 0, 100, 100, 100],
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

// ---- 2. Warp eye DISABLED: REST-semantics (held at rest, NOT flung) ----
// The fix: a disabled warp composes at its REST grid (baseGrid), so it
// contributes its frame mapping but no param deformation. The part holds at
// its rest position — it must NOT fly off-canvas (the reported bug, which the
// old "exclude the warp" semantics caused by collapsing the pivot frame).
{
  const proj = makeProject();
  const wMod = proj.nodes.find((n) => n.id === 'p').modifiers[1];
  wMod.mode = MODIFIER_MODE_RENDER; // viewport (REALTIME) bit cleared = eye off
  assert(wMod.enabled !== false, 'disabled: warp still enabled (only mode cleared)');

  const at0 = evalPartVerts(proj, 0);
  const at1 = evalPartVerts(proj, 1);
  assert(JSON.stringify(at0) === JSON.stringify(at1),
    `disabled: ParamX no longer moves the part (at0=${JSON.stringify(at0)} at1=${JSON.stringify(at1)})`);

  // REST equivalence: disabling W ≡ W frozen at its rest param. With W at
  // rest the pivot is the warp-centre (50,50) — the part stays put, NOT at
  // the origin/off-canvas. Pinned against W enabled with ParamX at rest (0).
  const enabledAtRest = evalPartVerts(makeProject(), 0);
  assert(JSON.stringify(at1) === JSON.stringify(enabledAtRest),
    `disabled ≡ W-at-rest (held in place, not flung) (disabled=${JSON.stringify(at1)} restRef=${JSON.stringify(enabledAtRest)})`);
  assert(Math.abs(at1[0] - 50) < 0.5 && Math.abs(at1[1] - 50) < 0.5,
    `disabled: part at rest pivot ≈ (50,50), NOT flung off-canvas (got ${JSON.stringify(at1)})`);

  // And it must differ from the enabled result at P=1 (the deformation IS removed).
  const enabledAt1 = evalPartVerts(makeProject(), 1);
  assert(JSON.stringify(at1) !== JSON.stringify(enabledAt1),
    `disabled vs enabled at P=1 differ (deformation removed) (disabled=${JSON.stringify(at1)} enabled=${JSON.stringify(enabledAt1)})`);
}

// ---- 3. ✓/× enabled=false → same REST-semantics as the eye bit ----
// The ✓/× `enabled` flag and the eye (mode) bit both go through
// isModifierEnabled, so disabling either holds the part at rest (not flung).
// SCOPE: the eye bit is viewport-only (depgraph). The ✓/× `enabled` flag also
// affects the EXPORT engine (chainEval/selectRigSpec), which uses EXCLUDE
// semantics for disabled warps (matching the cmo3 export, which structurally
// drops disabled modifiers via synthesizeDeformerNodesForExport). So viewport
// (rest) and export (exclude) intentionally differ for a disabled warp — the
// viewport favours nice authoring (no jump); export mirrors the dropped
// structure. The export side is covered by test_chainEval_perPartRotationDisable.
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
