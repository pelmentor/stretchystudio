// v3 Phase 0F.37 - tests for src/io/live2d/model3json.js
//
// generateModel3Json builds the manifest that points Live2D runtimes
// at the moc3 + textures + motions + physics + display info. Cubism
// SDK rejects model3.json with missing required fields (Version,
// FileReferences.Moc, FileReferences.Textures), and silently ignores
// unknown ones - so a typo here means the model loads but motions
// don't fire.
//
// Run: node scripts/test/test_model3json.mjs

import { generateModel3Json } from '../../src/io/live2d/model3json.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Required fields ──────────────────────────────────────────────

{
  const r = generateModel3Json({
    modelName: 'character',
    textureFiles: ['character.2048/texture_00.png'],
  });
  assert(r.Version === 3, 'required: Version = 3');
  assert(r.FileReferences.Moc === 'character.moc3',
    'required: FileReferences.Moc = "<modelName>.moc3"');
  assert(Array.isArray(r.FileReferences.Textures),
    'required: Textures is array');
  assert(r.FileReferences.Textures[0] === 'character.2048/texture_00.png',
    'required: Textures pass-through');

  // No optional fields when not provided
  assert(!('Physics' in r.FileReferences), 'optional: no Physics by default');
  assert(!('Pose' in r.FileReferences), 'optional: no Pose by default');
  assert(!('DisplayInfo' in r.FileReferences), 'optional: no DisplayInfo by default');
  assert(!('Motions' in r.FileReferences), 'optional: no Motions by default');
  assert(!('Groups' in r), 'optional: no Groups by default');
  assert(!('HitAreas' in r), 'optional: no HitAreas by default');
}

// ── Optional file references ─────────────────────────────────────

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    physicsFile: 'm.physics3.json',
    poseFile: 'm.pose3.json',
    displayInfoFile: 'm.cdi3.json',
  });
  assert(r.FileReferences.Physics === 'm.physics3.json', 'optional: Physics');
  assert(r.FileReferences.Pose === 'm.pose3.json', 'optional: Pose');
  assert(r.FileReferences.DisplayInfo === 'm.cdi3.json', 'optional: DisplayInfo');
}

// ── Motions: legacy `motionFiles` lumped under "Idle" group ──────

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    motionFiles: ['motion/idle1.motion3.json', 'motion/idle2.motion3.json'],
  });
  assert(r.FileReferences.Motions, 'motions legacy: Motions block emitted');
  assert(r.FileReferences.Motions.Idle.length === 2, 'motions legacy: 2 entries');
  assert(r.FileReferences.Motions.Idle[0].File === 'motion/idle1.motion3.json',
    'motions legacy: each entry is { File }');
}

// ── Motions: motionsByGroup explicit takes precedence ────────────

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    motionFiles: ['legacy.motion3.json'],
    motionsByGroup: {
      Idle: ['motion/idle.motion3.json'],
      Tap: ['motion/tap1.motion3.json', 'motion/tap2.motion3.json'],
    },
  });
  assert('Idle' in r.FileReferences.Motions, 'motionsByGroup: Idle preserved');
  assert('Tap' in r.FileReferences.Motions, 'motionsByGroup: Tap added');
  // motionFiles ignored when motionsByGroup is supplied
  assert(r.FileReferences.Motions.Idle.length === 1,
    'motionsByGroup: takes precedence over motionFiles');
  assert(r.FileReferences.Motions.Idle[0].File === 'motion/idle.motion3.json',
    'motionsByGroup: bare strings auto-wrapped');
  assert(r.FileReferences.Motions.Tap.length === 2,
    'motionsByGroup: multiple entries per group');
}

// ── Motions: object entries (already wrapped) preserved ──────────

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    motionsByGroup: {
      Idle: [{ File: 'motion.motion3.json', FadeInTime: 0.5 }],
    },
  });
  // Pre-wrapped entries should be passed through as-is, including extra fields
  const entry = r.FileReferences.Motions.Idle[0];
  assert(entry.File === 'motion.motion3.json', 'motions object: File preserved');
  assert(entry.FadeInTime === 0.5, 'motions object: extra fields preserved');
}

// ── Motions: empty groups skipped ────────────────────────────────

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    motionsByGroup: { Idle: [], Tap: ['t.motion3.json'] },
  });
  assert(!('Idle' in (r.FileReferences.Motions ?? {})),
    'motions: empty group dropped');
  assert(r.FileReferences.Motions.Tap.length === 1,
    'motions: non-empty group kept');
}

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    motionsByGroup: { Idle: [], Tap: [] },  // all empty
  });
  assert(!('Motions' in r.FileReferences),
    'motions: all-empty groups → no Motions block at all');
}

// ── Groups (LipSync / EyeBlink param bindings) ──────────────────

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    groups: {
      LipSync:  ['ParamMouthOpenY'],
      EyeBlink: ['ParamEyeLOpen', 'ParamEyeROpen'],
    },
  });
  assert(Array.isArray(r.Groups), 'groups: emitted as array');
  assert(r.Groups.length === 2, 'groups: 2 entries');
  const lipSync = r.Groups.find(g => g.Name === 'LipSync');
  assert(lipSync.Target === 'Parameter', 'groups: Target = Parameter');
  assert(lipSync.Ids[0] === 'ParamMouthOpenY', 'groups: ids preserved');
  const eyeBlink = r.Groups.find(g => g.Name === 'EyeBlink');
  assert(eyeBlink.Ids.length === 2, 'groups: multi-id');
}

// ── Groups with empty ids array dropped ─────────────────────────

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    groups: { LipSync: [], EyeBlink: ['ParamEyeLOpen'] },
  });
  assert(r.Groups.length === 1, 'groups: empty ids dropped');
  assert(r.Groups[0].Name === 'EyeBlink', 'groups: kept entry has ids');
}

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    groups: { LipSync: [], EyeBlink: [] },
  });
  assert(!('Groups' in r), 'groups: all empty → no Groups block');
}

// ── HitAreas ─────────────────────────────────────────────────────

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    hitAreas: [
      { Id: 'HitArea_Head', Name: 'Head' },
      { Id: 'HitArea_Body', Name: 'Body' },
    ],
  });
  assert(Array.isArray(r.HitAreas), 'hitAreas: emitted');
  assert(r.HitAreas.length === 2, 'hitAreas: 2 entries');
  assert(r.HitAreas[0].Id === 'HitArea_Head', 'hitAreas: Id pass-through');
}

// ── JSON-safe round-trip ─────────────────────────────────────────

{
  const r = generateModel3Json({
    modelName: 'm',
    textureFiles: ['t.png'],
    physicsFile: 'p.physics3.json',
    motionsByGroup: { Idle: ['motion.motion3.json'] },
    groups: { LipSync: ['ParamMouthOpenY'] },
    hitAreas: [{ Id: 'H', Name: 'H' }],
  });
  const round = JSON.parse(JSON.stringify(r));
  assert(round.Version === 3, 'json: Version round-trip');
  assert(round.FileReferences.Moc === 'm.moc3', 'json: Moc round-trip');
  assert(round.HitAreas[0].Id === 'H', 'json: HitAreas round-trip');
}

console.log(`model3json: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
