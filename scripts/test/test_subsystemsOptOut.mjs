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
//   - filterPhysicsRulesBySubsystems drops rules by name-prefix
//   - seedPhysicsRules respects subsystem flags
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
  filterPhysicsRulesBySubsystems,
} from '../../src/io/live2d/rig/initRig.js';
import { seedPhysicsRules } from '../../src/io/live2d/rig/physicsConfig.js';
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

// ── filterPhysicsRulesBySubsystems ─────────────────────────────────
{
  const rules = [
    { name: 'hair-front-1' },
    { name: 'hair-back-1' },
    { name: 'clothing-skirt' },
    { name: 'arm-leftElbow' },
    { name: 'breath' },
    { name: 'unknown-rule' },
  ];

  const f1 = filterPhysicsRulesBySubsystems(rules, { hairRig: false });
  assert(f1.length === 4, 'hairRig=false drops 2 hair rules');
  assert(!f1.some(r => r.name.startsWith('hair-')), 'hairRig=false drops all hair-* rules');

  const f2 = filterPhysicsRulesBySubsystems(rules, { clothingRig: false });
  assert(!f2.some(r => r.name === 'clothing-skirt'), 'clothingRig=false drops clothing rule');

  const f3 = filterPhysicsRulesBySubsystems(rules, { armPhysics: false });
  assert(!f3.some(r => r.name.includes('elbow')), 'armPhysics=false drops elbow rule');

  const f4 = filterPhysicsRulesBySubsystems(rules, { bodyWarps: false });
  assert(!f4.some(r => r.name === 'breath'), 'bodyWarps=false drops breath');

  const f5 = filterPhysicsRulesBySubsystems(rules, {
    hairRig: false, clothingRig: false, armPhysics: false, bodyWarps: false,
  });
  assert(f5.length === 1 && f5[0].name === 'unknown-rule', 'unknown-rule survives all opt-outs');
}

// ── seedPhysicsRules respects subsystems ───────────────────────────
{
  const project = {
    nodes: [{ id: 'g-hair-front', name: 'front hair', type: 'group' }],
    autoRigConfig: { subsystems: { hairRig: false } },
  };
  seedPhysicsRules(project);
  const hairRules = (project.physicsRules ?? []).filter(r => r?.name?.startsWith('hair-'));
  assert(hairRules.length === 0, 'seedPhysicsRules with hairRig=false produces no hair rules');
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
  assert(fh.modifiers[0].enabled === false,
    'opt-out: hair part modifier.enabled === false (sway disabled)');

  assert(Array.isArray(sh.modifiers) && sh.modifiers.length > 0,
    'on: clothing part HAS modifiers[]');
  assert(sh.modifiers[0].enabled === true,
    'on: clothing part modifier.enabled === true (not in disabled Set)');
}

// ── seedRigWarps: re-Init Rig with subsystem STILL opted out
// resets enabled to false even if user had manually toggled it on
// between Init Rigs. Subsystem opt-out at Init Rig time WINS over
// priorEnabled carry-forward.
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
  assert(fh.modifiers[0].enabled === false,
    're-Init with subsystem still off: enabled reset to false (overrides priorEnabled:true)');
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
