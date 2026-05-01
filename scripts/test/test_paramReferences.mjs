// GAP-013 / Hole I-3 — paramReferences module unit tests.
//
// Verifies:
//   - findReferences enumerates the three categories (animationTracks,
//     bindings, physicsInputs) correctly
//   - empty/malformed inputs return empty report without throwing
//   - findOrphanReferences detects references with no matching parameter
//   - tag-gated standard params are NOT allowlisted (they DO become
//     orphan when the tag goes away — that's the whole point)
//   - unconditional standard params + ParamRotation_* prefix ARE
//     allowlisted
//
// Run: node scripts/test/test_paramReferences.mjs

import {
  findReferences,
  findOrphanReferences,
} from '../../src/io/live2d/rig/paramReferences.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── findReferences: animation tracks ───────────────────────────────
{
  const project = {
    animations: [
      {
        id: 'anim1',
        tracks: [
          { nodeId: 'g1', property: 'x' },                    // not a param ref
          { paramId: 'ParamAngleX' },                         // hit
          { paramId: 'ParamSmile' },                          // not the target
          { paramId: 'ParamAngleX' },                         // second hit
        ],
      },
    ],
  };
  const r = findReferences(project, 'ParamAngleX');
  assert(r.animationTracks.length === 2, 'animationTracks: 2 hits for ParamAngleX');
  assert(r.animationTracks[0].location === 'animation:anim1:track[1]', 'first hit at track[1]');
  assert(r.animationTracks[1].location === 'animation:anim1:track[3]', 'second hit at track[3]');
  assert(r.bindings.length === 0, 'no binding hits');
  assert(r.physicsInputs.length === 0, 'no physics hits');
  assert(r.total === 2, 'total = 2');
}

// ── findReferences: bindings (face / body / rig warps) ─────────────
{
  const project = {
    faceParallax: {
      bindings: [
        { parameterId: 'ParamAngleX' },
        { parameterId: 'ParamAngleY' },
      ],
    },
    bodyWarp: {
      specs: [
        { bindings: [{ parameterId: 'ParamBodyAngleZ' }] },
        { bindings: [{ parameterId: 'ParamAngleX' }] },
      ],
    },
    rigWarps: {
      'hair-front': { bindings: [{ parameterId: 'ParamHairFront' }] },
      'top-front':  { bindings: [{ parameterId: 'ParamShirt' }] },
    },
  };

  const angleX = findReferences(project, 'ParamAngleX');
  assert(angleX.bindings.length === 2, 'ParamAngleX: 2 binding hits');
  const locs = angleX.bindings.map(b => b.location).sort();
  assert(locs.includes('faceParallax:bindings[0]'), 'face parallax binding location');
  assert(locs.includes('bodyWarp:specs[1]:bindings[0]'), 'body warp binding location');

  const hair = findReferences(project, 'ParamHairFront');
  assert(hair.bindings.length === 1, 'ParamHairFront: 1 rigWarp binding hit');
  assert(hair.bindings[0].location === 'rigWarps[hair-front]:bindings[0]',
    'rigWarps location includes partId');
}

// ── findReferences: physics inputs ─────────────────────────────────
{
  const project = {
    physicsRules: [
      {
        inputs: [
          { paramId: 'ParamAngleX', weight: 60 },
          { paramId: 'ParamAngleZ', weight: 60 },
        ],
        outputs: ['hair-front-1'],  // outputs are bone names, not params
      },
      {
        inputs: [{ paramId: 'ParamAngleX', weight: 100 }],
      },
    ],
  };
  const r = findReferences(project, 'ParamAngleX');
  assert(r.physicsInputs.length === 2, 'ParamAngleX: 2 physics hits');
  assert(r.physicsInputs[0].location === 'physicsRules[0]:inputs[0]', 'physics rule[0] inputs[0]');
  assert(r.physicsInputs[1].location === 'physicsRules[1]:inputs[0]', 'physics rule[1] inputs[0]');
}

// ── Edge cases ─────────────────────────────────────────────────────
{
  assert(findReferences(null, 'X').total === 0, 'null project → empty report');
  assert(findReferences({}, 'X').total === 0, 'empty project → empty report');
  assert(findReferences({}, 123).total === 0, 'non-string paramId → empty');
}

// ── findOrphanReferences ───────────────────────────────────────────
{
  const project = {
    parameters: [
      { id: 'ParamMyCustom' },                                // exists
      // ParamSmile NOT in list → orphan if referenced
      // ParamHairFront NOT in list (tag gating dropped it) → orphan
      // ParamAngleX NOT in list → but allowlisted as unconditional standard
    ],
    animations: [
      {
        id: 'anim1',
        tracks: [
          { paramId: 'ParamMyCustom' },                       // OK
          { paramId: 'ParamSmile' },                          // ORPHAN
          { paramId: 'ParamAngleX' },                         // unconditional standard — NOT orphan
          { paramId: 'ParamHairFront' },                      // tag-gated standard — IS orphan
          { paramId: 'ParamRotation_neck' },                  // bone rot prefix — NOT orphan
        ],
      },
    ],
    physicsRules: [
      { inputs: [{ paramId: 'ParamPhantomDriver' }] },        // ORPHAN
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

  assert(orphans.ParamSmile.animationTracks.length === 1, 'ParamSmile orphan has its animation ref');
  assert(orphans.ParamPhantomDriver.physicsInputs.length === 1, 'ParamPhantomDriver has its physics ref');
}

// ── No orphans case ────────────────────────────────────────────────
{
  const project = {
    parameters: [{ id: 'ParamX' }],
    animations: [
      { id: 'a1', tracks: [{ paramId: 'ParamX' }, { paramId: 'ParamAngleX' }] },
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
