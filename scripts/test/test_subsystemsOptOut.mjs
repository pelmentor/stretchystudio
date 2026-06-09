// Per-subsystem opt-out unit tests.
//
// Verifies:
//   - autoRigConfig.subsystems schema + defaults (all true)
//   - resolveAutoRigConfig spread-merges partial subsystem configs
//   - harvestSeedFromRigSpec semantics (REVISED 2026-06-08):
//       * faceRig=false → faceParallaxSpec=null, neckWarpSpec=null
//       * bodyWarps=false → bodyWarpChain=null
//       * hairRig/clothingRig/eyeRig/mouthRig=false → matching rigWarps
//         STAY in the map but their partIds land in disabledTargetPartIds.
//         (Pre-2026-06-08 the harvest STRIPPED them — empty modifiers[]
//         caused I-1/I-21 "part renders at canvas origin" violations.)
//   - seedPhysicsModifiers respects subsystem flags (category-based)
//   - seedRigWarps writes leaf modifier with enabled:false for partIds
//     in the disabledTargetPartIds Set (Blender modifier-toggle parity)
//
// Run: node scripts/test/test_subsystemsOptOut.mjs

import {
  DEFAULT_AUTO_RIG_CONFIG,
  resolveAutoRigConfig,
} from '../../src/io/live2d/rig/autoRigConfig.js';
import {
  harvestSeedFromRigSpec,
} from '../../src/io/live2d/rig/initRig.js';
import { seedPhysicsModifiers, gatherPhysicsRules } from '../../src/io/live2d/rig/physicsConfig.js';
import { seedRigWarps } from '../../src/io/live2d/rig/rigWarpsStore.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

// Build a rigWarp spec that passes the serializer's mandatory-field
// gauntlet (parent, canvasBbox, gridSize, baseGrid, localFrame, bindings,
// keyforms, isVisible/Locked/QuadTransform). Tests only care about the
// id + targetPartId + enabled-flag round-trip; other fields are stubbed
// with plausible identity values.
function mkWarpSpec({ id, targetPartId, parent = { type: 'warp', id: 'BodyXWarp' } } = {}) {
  return {
    id,
    name: id,
    parent,
    targetPartId,
    canvasBbox: { minX: 0, minY: 0, W: 100, H: 100 },
    gridSize: { rows: 2, cols: 2 },
    baseGrid: new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]),
    localFrame: 'normalized-0to1',
    bindings: [],
    keyforms: [{
      keyTuple: [0],
      positions: new Float64Array([0, 0, 1, 0, 0, 1, 1, 1]),
      opacity: 1,
    }],
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };
}

// ── Default config: all subsystems enabled ─────────────────────────
{
  const subs = DEFAULT_AUTO_RIG_CONFIG.subsystems;
  assert(subs.faceRig === true, 'default: faceRig enabled');
  assert(subs.eyeRig === true, 'default: eyeRig enabled');
  assert(subs.mouthRig === true, 'default: mouthRig enabled');
  assert(subs.hairRig === true, 'default: hairRig enabled');
  assert(subs.clothingRig === true, 'default: clothingRig enabled');
  assert(subs.bodyWarps === true, 'default: bodyWarps enabled');
  assert(subs.armPhysics === true, 'default: armPhysics enabled');
}

// ── resolveAutoRigConfig: empty → defaults; partial → merge ────────
{
  const cfg = resolveAutoRigConfig({});
  assert(cfg.subsystems.faceRig === true, 'empty project → subsystems all defaults');

  const project = {
    autoRigConfig: {
      subsystems: { hairRig: false },
    },
  };
  const cfg2 = resolveAutoRigConfig(project);
  assert(cfg2.subsystems.hairRig === false, 'partial: hairRig user override preserved');
  assert(cfg2.subsystems.faceRig === true, 'partial: faceRig defaults to true');
  assert(cfg2.subsystems.bodyWarps === true, 'partial: bodyWarps defaults to true');
}

// ── harvestSeedFromRigSpec: faceRig opt-out ─────────────────────────
{
  const rigSpec = {
    warpDeformers: [
      { id: 'FaceParallaxWarp', baseGrid: [], keyforms: [] },
      { id: 'BodyZWarp' },
      { id: 'BreathWarp' },
    ],
    bodyWarpChain: { specs: [] },
  };
  const r1 = harvestSeedFromRigSpec(rigSpec);
  assert(r1.faceParallaxSpec !== null, 'default: faceParallaxSpec retained');
  assert(r1.disabledTargetPartIds instanceof Set, 'default: disabledTargetPartIds is a Set');
  assert(r1.disabledTargetPartIds.size === 0, 'default: disabledTargetPartIds is empty');

  const r2 = harvestSeedFromRigSpec(rigSpec, { subsystems: { faceRig: false } });
  assert(r2.faceParallaxSpec === null, 'faceRig=false → faceParallaxSpec dropped');
  assert(r2.bodyWarpChain !== null, 'faceRig=false → bodyWarpChain still present');
}

// ── harvestSeedFromRigSpec: bodyWarps opt-out ───────────────────────
{
  const rigSpec = {
    warpDeformers: [{ id: 'FaceParallaxWarp' }],
    bodyWarpChain: { specs: [{ id: 'BodyZWarp' }, { id: 'BodyYWarp' }, { id: 'BreathWarp' }] },
  };
  const r = harvestSeedFromRigSpec(rigSpec, { subsystems: { bodyWarps: false } });
  assert(r.bodyWarpChain === null, 'bodyWarps=false → bodyWarpChain dropped');
  assert(r.faceParallaxSpec !== null, 'bodyWarps=false → face still present');
}

// ── harvestSeedFromRigSpec: hairRig opt-out keeps in map, flags in Set ─
{
  const nodes = [
    { id: 'p-front-hair', name: 'front hair' },
    { id: 'p-back-hair',  name: 'back hair' },
    { id: 'p-shirt',      name: 'topwear' },
    { id: 'p-eyebrow',    name: 'eyebrow-l' },
    { id: 'p-mouth',      name: 'mouth' },
    { id: 'p-unknown',    name: 'random_layer' },
  ];
  const rigSpec = {
    warpDeformers: [
      { id: 'RigWarp_a', targetPartId: 'p-front-hair' },
      { id: 'RigWarp_b', targetPartId: 'p-back-hair' },
      { id: 'RigWarp_c', targetPartId: 'p-shirt' },
      { id: 'RigWarp_d', targetPartId: 'p-eyebrow' },
      { id: 'RigWarp_e', targetPartId: 'p-mouth' },
      { id: 'RigWarp_f', targetPartId: 'p-unknown' },
    ],
  };

  const r = harvestSeedFromRigSpec(rigSpec, {
    subsystems: { hairRig: false },
    nodes,
  });
  // All warps remain in the map — the modifier MUST be present so the
  // depgraph chain walk finds it. The disable is via the modifier's
  // enabled flag, not by stripping the modifier.
  assert(r.rigWarps.has('p-front-hair'), 'hairRig=false KEEPS front-hair rigWarp in map');
  assert(r.rigWarps.has('p-back-hair'), 'hairRig=false KEEPS back-hair rigWarp in map');
  assert(r.rigWarps.has('p-shirt'), 'hairRig=false keeps clothing rigWarp');
  assert(r.rigWarps.has('p-eyebrow'), 'hairRig=false keeps eye rigWarp');
  assert(r.rigWarps.has('p-mouth'), 'hairRig=false keeps mouth rigWarp');
  assert(r.rigWarps.has('p-unknown'), 'hairRig=false keeps unknown-tag rigWarp');

  // Hair-tagged partIds land in disabled Set; others do not.
  assert(r.disabledTargetPartIds.has('p-front-hair'),
    'hairRig=false marks front-hair as disabled');
  assert(r.disabledTargetPartIds.has('p-back-hair'),
    'hairRig=false marks back-hair as disabled');
  assert(!r.disabledTargetPartIds.has('p-shirt'),
    'hairRig=false does NOT mark clothing as disabled');
  assert(!r.disabledTargetPartIds.has('p-eyebrow'),
    'hairRig=false does NOT mark eye as disabled');
  assert(!r.disabledTargetPartIds.has('p-unknown'),
    'hairRig=false does NOT mark unknown-tag as disabled');
}

// ── harvestSeedFromRigSpec: clothingRig opt-out ────────────────────
{
  const nodes = [
    { id: 'p-shirt',  name: 'topwear' },
    { id: 'p-skirt',  name: 'bottomwear' },
    { id: 'p-pants',  name: 'legwear' },
    { id: 'p-front-hair', name: 'front hair' },
  ];
  const rigSpec = {
    warpDeformers: [
      { id: 'RigWarp_a', targetPartId: 'p-shirt' },
      { id: 'RigWarp_b', targetPartId: 'p-skirt' },
      { id: 'RigWarp_c', targetPartId: 'p-pants' },
      { id: 'RigWarp_d', targetPartId: 'p-front-hair' },
    ],
  };
  const r = harvestSeedFromRigSpec(rigSpec, {
    subsystems: { clothingRig: false },
    nodes,
  });
  // Keep all in map, flag clothing partIds in Set
  assert(r.rigWarps.has('p-shirt'), 'clothingRig=false keeps topwear in map');
  assert(r.rigWarps.has('p-skirt'), 'clothingRig=false keeps bottomwear in map');
  assert(r.rigWarps.has('p-pants'), 'clothingRig=false keeps legwear in map');
  assert(r.rigWarps.has('p-front-hair'), 'clothingRig=false keeps hair in map');
  assert(r.disabledTargetPartIds.has('p-shirt'), 'clothingRig=false marks topwear disabled');
  assert(r.disabledTargetPartIds.has('p-skirt'), 'clothingRig=false marks bottomwear disabled');
  assert(r.disabledTargetPartIds.has('p-pants'), 'clothingRig=false marks legwear disabled');
  assert(!r.disabledTargetPartIds.has('p-front-hair'),
    'clothingRig=false does NOT mark hair disabled');
}

// ── harvestSeedFromRigSpec: eyeRig opt-out ─────────────────────────
{
  const nodes = [
    { id: 'p-eyewhite-l', name: 'eyewhite-l' },
    { id: 'p-iris-r',     name: 'irides-r' },
    { id: 'p-lash-l',     name: 'eyelash-l' },
    { id: 'p-brow-l',     name: 'eyebrow-l' },
    { id: 'p-mouth',      name: 'mouth' },
  ];
  const rigSpec = {
    warpDeformers: [
      { id: 'RigWarp_a', targetPartId: 'p-eyewhite-l' },
      { id: 'RigWarp_b', targetPartId: 'p-iris-r' },
      { id: 'RigWarp_c', targetPartId: 'p-lash-l' },
      { id: 'RigWarp_d', targetPartId: 'p-brow-l' },
      { id: 'RigWarp_e', targetPartId: 'p-mouth' },
    ],
  };
  const r = harvestSeedFromRigSpec(rigSpec, {
    subsystems: { eyeRig: false },
    nodes,
  });
  assert(r.rigWarps.size === 5, 'eyeRig=false keeps all 5 rigWarps in map');
  assert(r.disabledTargetPartIds.has('p-eyewhite-l'), 'eyeRig=false marks eyewhite disabled');
  assert(r.disabledTargetPartIds.has('p-iris-r'), 'eyeRig=false marks irides disabled');
  assert(r.disabledTargetPartIds.has('p-lash-l'), 'eyeRig=false marks eyelash disabled');
  assert(r.disabledTargetPartIds.has('p-brow-l'), 'eyeRig=false marks eyebrow disabled');
  assert(!r.disabledTargetPartIds.has('p-mouth'), 'eyeRig=false does NOT mark mouth disabled');
}

// ── harvestSeedFromRigSpec: combined opt-outs ──────────────────────
{
  const nodes = [
    { id: 'p-hair', name: 'front hair' },
    { id: 'p-shirt', name: 'topwear' },
    { id: 'p-mouth', name: 'mouth' },
  ];
  const rigSpec = {
    warpDeformers: [
      { id: 'FaceParallaxWarp' },
      { id: 'RigWarp_a', targetPartId: 'p-hair' },
      { id: 'RigWarp_b', targetPartId: 'p-shirt' },
      { id: 'RigWarp_c', targetPartId: 'p-mouth' },
    ],
    bodyWarpChain: { specs: [] },
  };
  const r = harvestSeedFromRigSpec(rigSpec, {
    subsystems: {
      faceRig: false,
      bodyWarps: false,
      hairRig: false,
      clothingRig: false,
    },
    nodes,
  });
  assert(r.faceParallaxSpec === null, 'combined: faceRig off → no faceParallax');
  assert(r.bodyWarpChain === null, 'combined: bodyWarps off → no body chain');
  assert(r.rigWarps.size === 3, 'combined: all 3 per-part warps remain in map');
  assert(r.disabledTargetPartIds.has('p-hair'),
    'combined: hair flagged disabled');
  assert(r.disabledTargetPartIds.has('p-shirt'),
    'combined: clothing flagged disabled');
  assert(!r.disabledTargetPartIds.has('p-mouth'),
    'combined: mouth NOT flagged (mouthRig still on)');
}

// ── seedPhysicsModifiers respects subsystem opt-out (category-based) ─
{
  // v50: physics modifiers seed per-node. hairRig=false → no rule with
  // `category: 'hair'` seeds any modifier on any node. We assert by
  // gathering the rules back from the project: gather() merges per-node
  // modifiers into the legacy rule shape. Empty hair → zero hair rules.
  const project = {
    nodes: [
      { id: 'p-front-hair', name: 'front hair', type: 'part' },
      { id: 'p-shirt',      name: 'topwear',     type: 'part' },
    ],
    autoRigConfig: { subsystems: { hairRig: false } },
  };
  seedPhysicsModifiers(project);
  const rules = gatherPhysicsRules(project);
  const hairRules = rules.filter(r => r.category === 'hair');
  assert(hairRules.length === 0,
    'seedPhysicsModifiers with hairRig=false produces no hair-category modifiers');
  // Clothing still seeds onto the shirt part (Shirt rule).
  const clothingRules = rules.filter(r => r.category === 'clothing');
  assert(clothingRules.length > 0,
    'seedPhysicsModifiers with hairRig=false still seeds clothing modifiers');
}

// ── No-opts-set fallback: harvest behaves as before ────────────────
{
  const rigSpec = {
    warpDeformers: [{ id: 'FaceParallaxWarp' }, { id: 'RigWarp_a', targetPartId: 'p-x' }],
    bodyWarpChain: { specs: [] },
  };
  const r = harvestSeedFromRigSpec(rigSpec);
  assert(r.faceParallaxSpec !== null, 'no opts: face retained');
  assert(r.bodyWarpChain !== null, 'no opts: body retained');
  assert(r.rigWarps.has('p-x'), 'no opts: rigWarp retained');
  assert(r.disabledTargetPartIds.size === 0, 'no opts: nothing flagged disabled');
}

// ── v50 bug-fix (2026-06-08): seedRigWarps → synth → seedPhysicsModifiers
//                              order preserves physicsModifier on parts.
// Bug shape: pre-fix `seedPhysicsModifiers` ran BEFORE seedRigWarps in
// seedAllRig. seedRigWarps then wrote `modifiers[0] = lattice` which
// clobbered the just-attached physicsModifier; synthesizeModifierStacks
// then rebuilt the full chain from the lattice leaf, never re-adding
// the physicsModifier. User-visible: "selected 7/7 in Init Rig, hair
// has no physics at all, no modifier visible on hair layer".
//
// Fix: seedAllRig order is now seedRigWarps → synth → seedPhysicsModifiers.
// Defensive: synth now carry-forwards any prior physicsModifier entries
// across the deformation-chain rebuild.
import { synthesizeModifierStacks } from '../../src/store/deformerNodeSync.js';

{
  const project = {
    nodes: [
      { id: 'p-fh', name: 'front hair', type: 'part' },
    ],
  };
  // Step 1: simulate seedRigWarps writing the sway-warp leaf modifier.
  const rigWarps = new Map([
    ['p-fh', mkWarpSpec({ id: 'RigWarp_front_hair', targetPartId: 'p-fh' })],
  ]);
  seedRigWarps(project, rigWarps, 'replace');
  // After seedRigWarps the part has the lattice leaf; no physicsModifier yet.
  let fh = project.nodes.find(n => n.id === 'p-fh');
  assert(fh.modifiers?.[0]?.type === 'lattice', 'post-seedRigWarps: lattice leaf at modifiers[0]');

  // Step 2: simulate seedAllRig's seedPhysicsModifiers running AFTER
  // seedRigWarps. seedPhysicsModifiers must attach the Hair Front rule
  // onto the hair part WITHOUT trampling the existing lattice leaf.
  seedPhysicsModifiers(project);

  fh = project.nodes.find(n => n.id === 'p-fh');
  const physMods = fh.modifiers.filter(m => m.type === 'physicsModifier');
  assert(physMods.length === 1, 'post-seedPhysicsModifiers: 1 physicsModifier on hair part');
  assert(physMods[0].ruleId === 'PhysicsSetting1',
    'post-seedPhysicsModifiers: Hair Front rule attached');
  assert(physMods[0].output?.paramId === 'ParamHairFront',
    'post-seedPhysicsModifiers: output paramId preserved');
  // Lattice leaf still at index 0 — sway warp deformation intact.
  assert(fh.modifiers[0].type === 'lattice',
    'post-seedPhysicsModifiers: lattice leaf survived at modifiers[0]');

  // Step 3: re-run synthesizeModifierStacks (would happen on any later
  // update). The defensive carry-forward must preserve physicsModifier.
  synthesizeModifierStacks(project);
  fh = project.nodes.find(n => n.id === 'p-fh');
  const physModsAfterSynth = fh.modifiers.filter(m => m.type === 'physicsModifier');
  assert(physModsAfterSynth.length === 1,
    'post-synth: physicsModifier survives stack rebuild (defensive carry-forward)');
}

// ── seedRigWarps: enabled:false for partIds in disabledTargetPartIds ─
// End-to-end: simulate the seedAllRig wiring — opt-out hair, verify the
// hair part's modifiers[0] lands with enabled:false. This is the BUG-fix:
// pre-2026-06-08 the harvest stripped the warp from the map, leaving
// modifiers[] empty → I-1/I-21 "renders at canvas origin". Now the
// modifier is present with enabled:false, renderer routes to rest-grid
// pass-through, part stays visible at authored position.
{
  const project = {
    nodes: [
      { id: 'p-front-hair', name: 'front hair', type: 'part' },
      { id: 'p-shirt',       name: 'topwear',     type: 'part' },
    ],
  };
  // Two warps — one for hair (opted out), one for clothing (kept).
  const rigWarps = new Map([
    ['p-front-hair', mkWarpSpec({ id: 'RigWarp_front_hair', targetPartId: 'p-front-hair' })],
    ['p-shirt',      mkWarpSpec({ id: 'RigWarp_shirt',      targetPartId: 'p-shirt'      })],
  ]);

  seedRigWarps(project, rigWarps, 'replace', {
    disabledTargetPartIds: new Set(['p-front-hair']),
  });

  const fh = project.nodes.find(n => n.id === 'p-front-hair');
  const sh = project.nodes.find(n => n.id === 'p-shirt');

  assert(Array.isArray(fh.modifiers) && fh.modifiers.length > 0,
    'opt-out: hair part HAS modifiers[] (not stripped, no empty-modifier I-1/I-21)');
  assert(fh.modifiers[0].type === 'lattice',
    'opt-out: hair part modifiers[0] is the lattice leaf');
  assert(fh.modifiers[0].objectId === 'RigWarp_front_hair',
    'opt-out: hair leaf points at the seeded warp');
  // BUGFIX 2026-06-09 — opt-out now KEEPS enabled:true. The earlier
  // `enabled: false` triggered a chain-reproject path with 153 px drift on
  // real hair geometry; the orphan-param mechanism (paramSpec filters
  // ParamHairFront out → binding orphan → rigwarp evaluates at
  // default=0=keyform[0]=restGrid = identity) already produces the
  // desired "no sway" visual without disabling the chain leaf.
  assert(fh.modifiers[0].enabled === true,
    'opt-out: hair leaf stays enabled:true — identity-at-rest via orphan-param, not via chain-skip-reproject (which had 153px drift)');

  assert(Array.isArray(sh.modifiers) && sh.modifiers.length > 0,
    'on: clothing part HAS modifiers[]');
  assert(sh.modifiers[0].enabled === true,
    'on: clothing part modifier.enabled === true (not in disabled Set)');
}

// ── seedRigWarps: re-Init Rig with subsystem STILL opted out
// preserves the user's priorEnabled state. Subsystem opt-out no longer
// force-overrides the flag (per 2026-06-09 bugfix — see explanation
// above); the desired no-sway behaviour comes from the orphan-param
// path, leaving manual toggles undisturbed.
{
  const project = {
    nodes: [
      {
        id: 'p-front-hair', name: 'front hair', type: 'part',
        modifiers: [{
          type: 'lattice', objectId: 'RigWarp_front_hair',
          enabled: true,        // user manually re-enabled between Init Rigs
          mode: 7, showInEditor: true,
        }],
      },
    ],
  };
  const rigWarps = new Map([
    ['p-front-hair', mkWarpSpec({ id: 'RigWarp_front_hair', targetPartId: 'p-front-hair' })],
  ]);
  seedRigWarps(project, rigWarps, 'replace', {
    disabledTargetPartIds: new Set(['p-front-hair']),
  });
  const fh = project.nodes.find(n => n.id === 'p-front-hair');
  assert(fh.modifiers[0].enabled === true,
    're-Init with subsystem still off: priorEnabled preserved (no force-disable on opt-out)');
}

// ── seedRigWarps: subsystem ENABLED preserves user's prior disable
// (priorEnabled carry-forward intact for non-opted-out parts).
{
  const project = {
    nodes: [
      {
        id: 'p-shirt', name: 'topwear', type: 'part',
        modifiers: [{
          type: 'lattice', objectId: 'RigWarp_shirt',
          enabled: false,       // user manually disabled this one
          mode: 7, showInEditor: true,
        }],
      },
    ],
  };
  const rigWarps = new Map([
    ['p-shirt', mkWarpSpec({ id: 'RigWarp_shirt', targetPartId: 'p-shirt' })],
  ]);
  // clothingRig is ON; shirt is NOT in disabled set.
  seedRigWarps(project, rigWarps, 'replace', {
    disabledTargetPartIds: new Set(),
  });
  const sh = project.nodes.find(n => n.id === 'p-shirt');
  assert(sh.modifiers[0].enabled === false,
    'subsystem on + user manually disabled: priorEnabled:false survives Init Rig');
}

// ── seedRigWarps: no disabled set → all enabled (back-compat default) ─
{
  const project = {
    nodes: [{ id: 'p-x', name: 'face', type: 'part' }],
  };
  const rigWarps = new Map([
    ['p-x', mkWarpSpec({ id: 'RigWarp_x', targetPartId: 'p-x' })],
  ]);
  seedRigWarps(project, rigWarps, 'replace');
  const x = project.nodes.find(n => n.id === 'p-x');
  assert(x.modifiers[0].enabled === true,
    'no opts: defaults to enabled:true (back-compat)');
}

console.log(`subsystemsOptOut: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
