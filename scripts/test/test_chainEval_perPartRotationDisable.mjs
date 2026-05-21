// Per-part modifier disable for ROTATION-leaf parts — chainEval / export
// engine (2026-05-21). The export engine had the same gap the depgraph did:
// `evalArtMeshFrame`'s per-part `modifierChain` walk used per-part lift for
// warp steps but the GLOBAL rotation matrix (`getState`/`getRotationSetup`,
// composed through the rotation's global `def.parent` chain) for rotation
// steps. So a rotation-leaf part that excluded a body warp from its chain
// (✓/×-disable → selectRigSpec omits it) still had the warp baked into its
// canvas-final pivot on export.
//
// Fix: `getRotationMatForChain` recomputes the rotation's canvas-final matrix
// through the part's effective chain when it DIVERGES from the rotation's
// global parent chain. Divergence-gated → the all-enabled chain reuses the
// global Setup verbatim (byte-identical — the byte-fidelity oracle + the
// depgraph↔chainEval sideBySide harness, both all-enabled, stay green).
//
// Run: node scripts/test/test_chainEval_perPartRotationDisable.mjs

import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// Root warp `W` shifts +50 in X with ParamX (P=0 identity; P=1 shifted), a
// rotation `R` (identity angle) parented to W with pivot at the warp-local
// centre (0.5,0.5), and an art mesh `p` (single vertex at (0,0)) riding R.
// With angle 0 the rotation maps (0,0) → its canvas-final pivot, so p's
// output == R's probed pivot — which follows ParamX only while W is in the
// effective chain.
function makeRigSpec(modifierChain) {
  return {
    canvas: { w: 100, h: 100 },
    warpDeformers: [
      { id: 'W', parent: { type: 'root', id: null },
        gridSize: { rows: 1, cols: 1 },
        bindings: [{ parameterId: 'P', keys: [0, 1] }],
        keyforms: [
          { keyTuple: [0], positions: [0, 0, 100, 0, 0, 100, 100, 100], opacity: 1 },
          { keyTuple: [1], positions: [50, 0, 150, 0, 50, 100, 150, 100], opacity: 1 },
        ],
        isQuadTransform: false },
    ],
    rotationDeformers: [
      { id: 'R', parent: { type: 'warp', id: 'W' }, baseAngle: 0,
        bindings: [],
        keyforms: [{ keyTuple: [], angle: 0, originX: 0.5, originY: 0.5, scale: 1, opacity: 1 }] },
    ],
    artMeshes: [
      { id: 'p',
        bindings: [],
        keyforms: [{ keyTuple: [], vertexPositions: [0, 0], opacity: 1 }],
        parent: { type: 'rotation', id: 'R' },
        modifierChain,
      },
    ],
  };
}

function evalPartVerts(modifierChain, pValue) {
  const frames = evalRig(makeRigSpec(modifierChain), { P: pValue });
  const f = frames.find((fr) => fr.id === 'p');
  return f?.vertexPositions ? Array.from(f.vertexPositions) : null;
}

const CHAIN_FULL = [{ type: 'rotation', id: 'R' }, { type: 'warp', id: 'W' }];
const CHAIN_NO_WARP = [{ type: 'rotation', id: 'R' }]; // W excluded (disabled)

// ---- 1. Full chain (warp enabled): pivot follows ParamX (non-vacuous) ----
{
  const at0 = evalPartVerts(CHAIN_FULL, 0);
  const at1 = evalPartVerts(CHAIN_FULL, 1);
  assert(Array.isArray(at0) && Array.isArray(at1), 'full: produced verts');
  assert(JSON.stringify(at0) !== JSON.stringify(at1),
    `full: part moves with ParamX (at0=${JSON.stringify(at0)} at1=${JSON.stringify(at1)})`);
  assert(Math.abs(at0[0] - 50) < 0.5 && Math.abs(at0[1] - 50) < 0.5,
    `full P=0: pivot ≈ (50,50) (got ${JSON.stringify(at0)})`);
  assert(Math.abs(at1[0] - 100) < 0.5 && Math.abs(at1[1] - 50) < 0.5,
    `full P=1: pivot ≈ (100,50) (got ${JSON.stringify(at1)})`);
}

// ---- 2. Warp excluded from chain: rotation no longer follows ParamX ----
// This is the fix: the leaf rotation's canvas-final matrix is recomputed
// through the part's effective chain (W excluded), so ParamX has no effect.
{
  const at0 = evalPartVerts(CHAIN_NO_WARP, 0);
  const at1 = evalPartVerts(CHAIN_NO_WARP, 1);
  assert(JSON.stringify(at0) === JSON.stringify(at1),
    `excluded: ParamX no longer moves the part — warp contribution removed (at0=${JSON.stringify(at0)} at1=${JSON.stringify(at1)})`);
  const fullAt1 = evalPartVerts(CHAIN_FULL, 1);
  assert(JSON.stringify(at1) !== JSON.stringify(fullAt1),
    `excluded vs full at P=1 differ (warp excluded, not frozen) (excluded=${JSON.stringify(at1)} full=${JSON.stringify(fullAt1)})`);
}

// ---- 3. All-enabled byte-stability: full chain == global parent walk ----
// The full chain matches R's global parent chain, so getRotationMatForChain
// must take the divergence fast-path (global getState) — i.e. the modifier-
// chain result equals omitting modifierChain entirely (global pointer walk).
{
  const withChain = evalPartVerts(CHAIN_FULL, 1);
  const rig = makeRigSpec(undefined); // no modifierChain → legacy global walk
  const frames = evalRig(rig, { P: 1 });
  const globalWalk = Array.from(frames.find((fr) => fr.id === 'p').vertexPositions);
  assert(JSON.stringify(withChain) === JSON.stringify(globalWalk),
    `all-enabled: modifierChain result == global parent walk (chain=${JSON.stringify(withChain)} global=${JSON.stringify(globalWalk)})`);
}

console.log(`chainEval_perPartRotationDisable: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
