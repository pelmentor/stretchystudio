// GAP-013 / Hole I-3 — paramReferences module unit tests.
//
// Verifies:
//   - findReferences enumerates the three categories (actionFCurves,
//     bindings, physicsInputs) correctly
//   - empty/malformed inputs return empty report without throwing
//   - findOrphanReferences detects references with no matching parameter
//   - tag-gated standard params are NOT allowlisted (they DO become
//     orphan when the tag goes away — that's the whole point)
//   - unconditional standard params + ParamRotation_* prefix ARE
//     allowlisted
//
// Post-v36: walks `project.actions[].fcurves[]` (with rnaPath addressing)
// instead of legacy `project.animations[].tracks[].paramId`.
//
// Run: node scripts/test/test_paramReferences.mjs

import {
  findReferences,
  findOrphanReferences,
} from '../../src/io/live2d/rig/paramReferences.js';
import { buildParamFCurve, buildNodeFCurve } from '../../src/anim/animationFCurve.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── findReferences: action fcurves ─────────────────────────────────
{
  const project = {
    actions: [
      {
        id: 'anim1',
        fcurves: [
          buildNodeFCurve('g1', 'x', [{ time: 0, value: 0 }]),                // not a param ref
          buildParamFCurve('ParamAngleX', [{ time: 0, value: 0 }]),           // hit
          buildParamFCurve('ParamSmile', [{ time: 0, value: 0 }]),            // not the target
          buildParamFCurve('ParamAngleX', [{ time: 0, value: 0 }]),           // second hit
        ],
      },
    ],
  };
  const r = findReferences(project, 'ParamAngleX');
  assert(r.actionFCurves.length === 2, `actionFCurves: 2 hits for ParamAngleX (got ${r.actionFCurves.length})`);
  assert(r.actionFCurves[0].location === 'action:anim1:fcurve[1]',
    `first hit at fcurve[1] (got ${r.actionFCurves[0].location})`);
  assert(r.actionFCurves[1].location === 'action:anim1:fcurve[3]',
    `second hit at fcurve[3] (got ${r.actionFCurves[1].location})`);
  assert(r.bindings.length === 0, 'no binding hits');
  assert(r.physicsInputs.length === 0, 'no physics hits');
  assert(r.total === 2, 'total = 2');
}

// ── findReferences: bindings on deformer nodes (BFA-006 Phase 6) ─────
{
  const project = {
    nodes: [
      { id: 'FaceParallax', type: 'deformer', deformerKind: 'warp',
        bindings: [
          { parameterId: 'ParamAngleX' },
          { parameterId: 'ParamAngleY' },
        ],
      },
      { id: 'BodyWarpZ', type: 'deformer', deformerKind: 'warp',
        bindings: [{ parameterId: 'ParamBodyAngleZ' }],
      },
      { id: 'BodyWarpY', type: 'deformer', deformerKind: 'warp',
        bindings: [{ parameterId: 'ParamAngleX' }],
      },
      { id: 'RigWarp_hair-front', type: 'deformer', deformerKind: 'warp',
        targetPartId: 'hair-front',
        bindings: [{ parameterId: 'ParamHairFront' }],
      },
      { id: 'RigWarp_top-front', type: 'deformer', deformerKind: 'warp',
        targetPartId: 'top-front',
        bindings: [{ parameterId: 'ParamShirt' }],
      },
    ],
  };

  const angleX = findReferences(project, 'ParamAngleX');
  assert(angleX.bindings.length === 2, 'ParamAngleX: 2 binding hits');
  const locs = angleX.bindings.map(b => b.location).sort();
  assert(locs.includes('deformer[FaceParallax]:bindings[0]'), 'FaceParallax binding location');
  assert(locs.includes('deformer[BodyWarpY]:bindings[0]'), 'BodyWarpY binding location');

  const hair = findReferences(project, 'ParamHairFront');
  assert(hair.bindings.length === 1, 'ParamHairFront: 1 rigWarp binding hit');
  assert(hair.bindings[0].location === 'deformer[RigWarp_hair-front]:bindings[0]',
    'rigWarp deformer location identifies node id');
}

// ── findReferences: physics inputs (v50 per-node modifiers) ────────
{
  const project = {
    nodes: [
      {
        id: 'n0', type: 'group', name: 'rig_root',
        modifiers: [{
          type: 'physicsModifier', ruleId: 'r1',
          inputs: [
            { paramId: 'ParamAngleX', weight: 60 },
            { paramId: 'ParamAngleZ', weight: 60 },
          ],
        }],
      },
      {
        id: 'n1', type: 'part', name: 'front hair',
        modifiers: [{
          type: 'physicsModifier', ruleId: 'r2',
          inputs: [{ paramId: 'ParamAngleX', weight: 100 }],
        }],
      },
    ],
  };
  const r = findReferences(project, 'ParamAngleX');
  assert(r.physicsInputs.length === 2, 'ParamAngleX: 2 physics hits');
  const locs = r.physicsInputs.map((p) => p.location).sort();
  assert(locs[0] === 'nodes[0]:modifiers[0]:inputs[0]',
    'physics input location identifies node + modifier indices');
  assert(locs[1] === 'nodes[1]:modifiers[0]:inputs[0]',
    'physics input location identifies node + modifier indices');
}

// ── Edge cases ─────────────────────────────────────────────────────
{
  assert(findReferences(null, 'X').total === 0, 'null project → empty report');
  assert(findReferences({}, 'X').total === 0, 'empty project → empty report');
  assert(findReferences({}, 123).total === 0, 'non-string paramId → empty');
}

// ── findReferences: bindings on LATTICE (v43) warp objects ──────────
{
  // Post-v43 / Phase 5, warps are `{type:'object', objectKind:'lattice'}`
  // and carry `bindings` as object-side metadata. The reference + orphan
  // scans must walk them (else a deleted param leaves dangling refs in
  // lattice warp bindings).
  const project = {
    parameters: [{ id: 'ParamAngleX' }],
    nodes: [
      { id: 'FaceParallaxWarp', type: 'object', objectKind: 'lattice', dataId: 'FaceParallaxWarp__cage',
        bindings: [{ parameterId: 'ParamAngleX' }, { parameterId: 'ParamGhost' }] },
      { id: 'FaceParallaxWarp__cage', type: 'meshData', vertices: [], isLatticeCage: true },
      // A rotation deformer stays `type:'deformer'` — must still be scanned.
      { id: 'FaceRotation', type: 'deformer', deformerKind: 'rotation',
        bindings: [{ parameterId: 'ParamAngleX' }] },
    ],
  };
  const angleX = findReferences(project, 'ParamAngleX');
  assert(angleX.bindings.length === 2,
    `ParamAngleX: 2 binding hits across lattice + rotation (got ${angleX.bindings.length})`);
  const ghost = findReferences(project, 'ParamGhost');
  assert(ghost.bindings.length === 1, 'lattice-object binding for ParamGhost found');
  // Orphan scan: ParamGhost has no matching parameter → orphan via lattice binding.
  const orphans = findOrphanReferences(project);
  assert(Object.keys(orphans).includes('ParamGhost'),
    'orphan scan walks lattice-object bindings (ParamGhost flagged)');
}

// ── findOrphanReferences ───────────────────────────────────────────
{
  const project = {
    parameters: [
      { id: 'ParamMyCustom' },
    ],
    actions: [
      {
        id: 'anim1',
        fcurves: [
          buildParamFCurve('ParamMyCustom', [{ time: 0, value: 0 }]),         // OK
          buildParamFCurve('ParamSmile', [{ time: 0, value: 0 }]),            // ORPHAN
          buildParamFCurve('ParamAngleX', [{ time: 0, value: 0 }]),           // unconditional standard — NOT orphan
          buildParamFCurve('ParamHairFront', [{ time: 0, value: 0 }]),        // tag-gated standard — IS orphan
          buildParamFCurve('ParamRotation_neck', [{ time: 0, value: 0 }]),    // bone rot prefix — NOT orphan
        ],
      },
    ],
    nodes: [
      {
        id: 'g_root', type: 'group', name: 'rig_root',
        modifiers: [{
          type: 'physicsModifier', ruleId: 'r',
          inputs: [{ paramId: 'ParamPhantomDriver' }],
        }],
      },
    ],
  };
  const orphans = findOrphanReferences(project);
  const ids = Object.keys(orphans).sort();
  assert(ids.length === 3, `3 orphans (got ${ids.length}: ${ids.join(',')})`);
  assert(ids.includes('ParamSmile'), 'ParamSmile detected as orphan');
  assert(ids.includes('ParamHairFront'), 'tag-gated ParamHairFront IS orphan');
  assert(ids.includes('ParamPhantomDriver'), 'ParamPhantomDriver detected as orphan');
  assert(!ids.includes('ParamAngleX'), 'unconditional ParamAngleX NOT orphan');
  assert(!ids.includes('ParamMyCustom'), 'present ParamMyCustom NOT orphan');
  assert(!ids.includes('ParamRotation_neck'), 'ParamRotation_* NOT orphan');

  assert(orphans.ParamSmile.actionFCurves.length === 1, 'ParamSmile orphan has its action ref');
  assert(orphans.ParamPhantomDriver.physicsInputs.length === 1, 'ParamPhantomDriver has its physics ref');

  // Regression pin (2026-06-09): the seedAllRig orphan-warning branch
  // (projectStore.js ~line 1900) builds a log payload by reading
  // `actionFCurves` / `bindings` / `physicsInputs` off each report.
  // Pre-fix it read `animationTracks` which doesn't exist on the
  // report — the call threw "Cannot read properties of undefined" any
  // time orphans were present. Mirror that call shape here so a future
  // rename of any of these three field names fails the test loudly
  // instead of going latent until the next user import.
  const payload = Object.fromEntries(
    Object.keys(orphans).map(id => [id, {
      actionFCurves:  orphans[id].actionFCurves.map(r => r.location),
      bindings:       orphans[id].bindings.map(r => r.location),
      physicsInputs:  orphans[id].physicsInputs.map(r => r.location),
    }])
  );
  assert(Array.isArray(payload.ParamSmile.actionFCurves),
    'log-payload shape: actionFCurves array present');
  assert(Array.isArray(payload.ParamPhantomDriver.physicsInputs),
    'log-payload shape: physicsInputs array present');
  assert(Array.isArray(payload.ParamHairFront.bindings),
    'log-payload shape: bindings array present');
}

// ── No orphans case ────────────────────────────────────────────────
{
  const project = {
    parameters: [{ id: 'ParamX' }],
    actions: [
      { id: 'a1', fcurves: [
        buildParamFCurve('ParamX', [{ time: 0, value: 0 }]),
        buildParamFCurve('ParamAngleX', [{ time: 0, value: 0 }]),
      ] },
    ],
  };
  const orphans = findOrphanReferences(project);
  assert(Object.keys(orphans).length === 0, 'no orphans when all refs resolve or are allowlisted');
}

console.log(`paramReferences: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
