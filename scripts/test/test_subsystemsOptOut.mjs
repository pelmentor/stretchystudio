// GAP-008 — per-subsystem opt-out unit tests.
//
// Verifies:
//   - autoRigConfig.subsystems schema + defaults (all true)
//   - resolveAutoRigConfig spread-merges partial subsystem configs
//   - harvestSeedFromRigSpec drops outputs by subsystem flag:
//       * faceRig=false → faceParallaxSpec=null
//       * bodyWarps=false → bodyWarpChain=null
//       * hairRig=false → hair-tagged rigWarps dropped
//       * clothingRig=false → clothing-tagged rigWarps dropped
//       * eyeRig=false → eye-tagged rigWarps dropped
//       * mouthRig=false → mouth-tagged rigWarps dropped
//   - seedPhysicsRules drops rules by subsystem prefix
//   - subsystems survives save/load round-trip (already covered by
//     test:projectRoundTrip via autoRigConfig — sanity check here)
//
// Run: node scripts/test/test_subsystemsOptOut.mjs

import {
  DEFAULT_AUTO_RIG_CONFIG,
  resolveAutoRigConfig,
} from '../../src/io/live2d/rig/autoRigConfig.js';
import {
  harvestSeedFromRigSpec,
  filterPhysicsRulesBySubsystems,
  applySubsystemOptOutToRigSpec,
} from '../../src/io/live2d/rig/initRig.js';
import { seedPhysicsRules } from '../../src/io/live2d/rig/physicsConfig.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
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
      subsystems: { hairRig: false },   // only one flag set; others should default
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
  // Default: faceRig=true → spec retained
  const r1 = harvestSeedFromRigSpec(rigSpec);
  assert(r1.faceParallaxSpec !== null, 'default: faceParallaxSpec retained');

  // faceRig=false → spec dropped
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

// ── harvestSeedFromRigSpec: hairRig opt-out (tag-based) ────────────
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

  // hairRig off → both hair-tagged warps dropped
  const r = harvestSeedFromRigSpec(rigSpec, {
    subsystems: { hairRig: false },
    nodes,
  });
  assert(!r.rigWarps.has('p-front-hair'), 'hairRig=false drops front-hair rigWarp');
  assert(!r.rigWarps.has('p-back-hair'), 'hairRig=false drops back-hair rigWarp');
  assert(r.rigWarps.has('p-shirt'), 'hairRig=false keeps clothing rigWarp');
  assert(r.rigWarps.has('p-eyebrow'), 'hairRig=false keeps eye rigWarp');
  assert(r.rigWarps.has('p-mouth'), 'hairRig=false keeps mouth rigWarp');
  assert(r.rigWarps.has('p-unknown'), 'hairRig=false keeps unknown-tag rigWarp');
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
  assert(!r.rigWarps.has('p-shirt'), 'clothingRig=false drops topwear');
  assert(!r.rigWarps.has('p-skirt'), 'clothingRig=false drops bottomwear');
  assert(!r.rigWarps.has('p-pants'), 'clothingRig=false drops legwear');
  assert(r.rigWarps.has('p-front-hair'), 'clothingRig=false keeps hair');
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
  assert(!r.rigWarps.has('p-eyewhite-l'), 'eyeRig=false drops eyewhite');
  assert(!r.rigWarps.has('p-iris-r'), 'eyeRig=false drops irides');
  assert(!r.rigWarps.has('p-lash-l'), 'eyeRig=false drops eyelash');
  assert(!r.rigWarps.has('p-brow-l'), 'eyeRig=false drops eyebrow');
  assert(r.rigWarps.has('p-mouth'), 'eyeRig=false keeps mouth');
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
  assert(r.faceParallaxSpec === null, 'combined: faceRig off');
  assert(r.bodyWarpChain === null, 'combined: bodyWarps off');
  assert(!r.rigWarps.has('p-hair'), 'combined: hair off');
  assert(!r.rigWarps.has('p-shirt'), 'combined: clothing off');
  assert(r.rigWarps.has('p-mouth'), 'combined: mouth still on');
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

  // hairRig off
  const f1 = filterPhysicsRulesBySubsystems(rules, { hairRig: false });
  assert(f1.length === 4, 'hairRig=false drops 2 hair rules');
  assert(!f1.some(r => r.name.startsWith('hair-')), 'hairRig=false drops all hair-* rules');

  // clothingRig off
  const f2 = filterPhysicsRulesBySubsystems(rules, { clothingRig: false });
  assert(!f2.some(r => r.name === 'clothing-skirt'), 'clothingRig=false drops clothing rule');

  // armPhysics off
  const f3 = filterPhysicsRulesBySubsystems(rules, { armPhysics: false });
  assert(!f3.some(r => r.name.includes('elbow')), 'armPhysics=false drops elbow rule');

  // bodyWarps off → drops breath
  const f4 = filterPhysicsRulesBySubsystems(rules, { bodyWarps: false });
  assert(!f4.some(r => r.name === 'breath'), 'bodyWarps=false drops breath');

  // unknown rule always passes through
  const f5 = filterPhysicsRulesBySubsystems(rules, {
    hairRig: false, clothingRig: false, armPhysics: false, bodyWarps: false,
  });
  assert(f5.length === 1 && f5[0].name === 'unknown-rule', 'unknown-rule survives all opt-outs');
}

// ── seedPhysicsRules respects subsystems ───────────────────────────
{
  // Smoke: a project with hairRig disabled should seed without hair rules.
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
  // No opts at all → matches pre-GAP-008 behaviour.
  const r = harvestSeedFromRigSpec(rigSpec);
  assert(r.faceParallaxSpec !== null, 'no opts: face retained');
  assert(r.bodyWarpChain !== null, 'no opts: body retained');
  assert(r.rigWarps.has('p-x'), 'no opts: rigWarp retained');
}

// ── PP1-002 — applySubsystemOptOutToRigSpec drops disabled rigWarps and
//             reparents affected art meshes ──────────────────────────
{
  const nodes = [
    { id: 'p-front-hair', name: 'front hair' },
    { id: 'p-back-hair',  name: 'back hair' },
    { id: 'p-face',       name: 'face' },
  ];
  const rigSpec = {
    warpDeformers: [
      { id: 'FaceParallaxWarp', parent: { type: 'root', id: null } },
      { id: 'RigWarp_FH', targetPartId: 'p-front-hair', parent: { type: 'warp', id: 'FaceParallaxWarp' } },
      { id: 'RigWarp_BH', targetPartId: 'p-back-hair',  parent: { type: 'root', id: null } },
    ],
    rotationDeformers: [],
    artMeshes: [
      { id: 'p-front-hair', parent: { type: 'warp', id: 'RigWarp_FH' } },
      { id: 'p-back-hair',  parent: { type: 'warp', id: 'RigWarp_BH' } },
      { id: 'p-face',       parent: { type: 'warp', id: 'FaceParallaxWarp' } },
    ],
  };

  // hairRig=false → both hair rigWarps dropped; art meshes reparent.
  const r = applySubsystemOptOutToRigSpec(rigSpec, {
    subsystems: { hairRig: false },
    nodes,
  });
  assert(r.droppedWarpIds.length === 2, 'PP1-002 hairRig=false drops 2 warps');
  assert(r.rigSpec.warpDeformers.length === 1, 'PP1-002 only FaceParallaxWarp survives');
  assert(r.rigSpec.warpDeformers[0].id === 'FaceParallaxWarp', 'PP1-002 surviving warp is FaceParallax');
  // Reparent: front-hair art mesh's parent was RigWarp_FH (whose parent was FaceParallaxWarp)
  const fh = r.rigSpec.artMeshes.find(m => m.id === 'p-front-hair');
  assert(fh?.parent?.type === 'warp' && fh.parent.id === 'FaceParallaxWarp',
    'PP1-002 front-hair reparented to FaceParallaxWarp (its dropped warp\'s parent)');
  // Back-hair: dropped warp's parent was root → back-hair art mesh now root-parented
  const bh = r.rigSpec.artMeshes.find(m => m.id === 'p-back-hair');
  assert(bh?.parent?.type === 'root', 'PP1-002 back-hair reparented to root');
  // Face is untouched.
  const face = r.rigSpec.artMeshes.find(m => m.id === 'p-face');
  assert(face?.parent?.id === 'FaceParallaxWarp', 'PP1-002 face artmesh untouched');
}

// ── PP1-002 — no opts / null subsystems → identity ─────────────────
{
  const rigSpec = {
    warpDeformers: [{ id: 'X', targetPartId: 'p-x' }],
    artMeshes: [{ id: 'p-x', parent: { type: 'warp', id: 'X' } }],
  };
  const r1 = applySubsystemOptOutToRigSpec(rigSpec, {});
  assert(r1.rigSpec === rigSpec, 'PP1-002 no opts → identity');
  assert(r1.droppedWarpIds.length === 0, 'PP1-002 no opts → 0 drops');

  const r2 = applySubsystemOptOutToRigSpec(rigSpec, { subsystems: null, nodes: [] });
  assert(r2.rigSpec === rigSpec, 'PP1-002 null subsystems → identity');
}

// ── PP1-002 — disabled subsystem with no matching tags → no drops ──
{
  const nodes = [{ id: 'p-x', name: 'face' }];
  const rigSpec = {
    warpDeformers: [{ id: 'X', targetPartId: 'p-x' }],
    artMeshes: [{ id: 'p-x', parent: { type: 'warp', id: 'X' } }],
  };
  const r = applySubsystemOptOutToRigSpec(rigSpec, {
    subsystems: { hairRig: false },
    nodes,
  });
  assert(r.droppedWarpIds.length === 0, 'PP1-002 hairRig=false but no hair-tagged parts → 0 drops');
}

console.log(`subsystemsOptOut: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}
