// Tests for src/io/live2d/rig/autoRigConfig.js — Stage 2 (autoRigConfig:
// bodyWarp + faceParallax + neckWarp tunables).
// Run: node scripts/test_autoRigConfig.mjs

import {
  DEFAULT_AUTO_RIG_CONFIG,
  buildAutoRigConfigFromProject,
  resolveAutoRigConfig,
  seedAutoRigConfig,
} from '../../src/io/live2d/rig/autoRigConfig.js';
import { buildBodyWarpChain } from '../../src/io/live2d/rig/bodyWarp.js';
import { buildNeckWarpSpec } from '../../src/io/live2d/rig/warpDeformers.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${e}`);
  console.error(`  actual:   ${a}`);
}

function assertClose(actual, expected, eps, name) {
  if (Math.abs(actual - expected) < eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} — expected ~${expected}, got ${actual}`);
}

// --- DEFAULT contract: every legacy literal preserved ---

{
  // bodyWarp
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.canvasPadFrac,    0.10, 'bodyWarp.canvasPadFrac');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.hipFracDefault,   0.45, 'bodyWarp.hipFracDefault');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.feetFracDefault,  0.75, 'bodyWarp.feetFracDefault');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.feetMarginRf,     0.05, 'bodyWarp.feetMarginRf');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.bxRange,          { min: 0.10, max: 0.90 }, 'bodyWarp.bxRange');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.byMargin,         0.065, 'bodyWarp.byMargin');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.breathMargin,     0.055, 'bodyWarp.breathMargin');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.upperBodyTCap,    0.5,   'bodyWarp.upperBodyTCap');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.upperBodySlope,   1.5,   'bodyWarp.upperBodySlope');

  // faceParallax
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.depthK,                  0.80, 'fp.depthK');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.edgeDepthK,              0.30, 'fp.edgeDepthK');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.maxAngleXDeg,            15,   'fp.maxAngleXDeg');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.maxAngleYDeg,            8,    'fp.maxAngleYDeg');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.depthAmp,                3.0,  'fp.depthAmp');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.eyeParallaxAmpX,         1.3,  'fp.eyeParallaxAmpX');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.farEyeSquashAmp,         0.18, 'fp.farEyeSquashAmp');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionStrength,      1.0,  'fp.protectionStrength');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionFalloffBuffer, 0.12, 'fp.protectionFalloffBuffer');
  // protectionPerTag canonical values (not exhaustive — sample):
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionPerTag['eyelash'],  1.00, 'fp.protectionPerTag.eyelash');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionPerTag['eyelash-l'],1.00, 'fp.protectionPerTag.eyelash-l');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionPerTag['ears'],     0.90, 'fp.protectionPerTag.ears');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionPerTag['eyebrow'],  0.80, 'fp.protectionPerTag.eyebrow');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionPerTag['mouth'],    0.30, 'fp.protectionPerTag.mouth');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionPerTag['nose'],     0.30, 'fp.protectionPerTag.nose');
  assertEq(
    DEFAULT_AUTO_RIG_CONFIG.faceParallax.superGroups['eye-l'],
    ['eyelash-l', 'eyewhite-l', 'irides-l'],
    'fp.superGroups.eye-l'
  );
  assertEq(
    DEFAULT_AUTO_RIG_CONFIG.faceParallax.superGroups['eye-r'],
    ['eyelash-r', 'eyewhite-r', 'irides-r'],
    'fp.superGroups.eye-r'
  );

  // neckWarp
  assertEq(DEFAULT_AUTO_RIG_CONFIG.neckWarp.tiltFrac, 0.08, 'neckWarp.tiltFrac');

  // tagWarpMagnitudes (Stage 9a) — every default matches the pre-9a literal.
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.hairFrontXSway,    0.12,  'tagWarpMagnitudes.hairFrontXSway');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.hairFrontYCurl,    0.03,  'tagWarpMagnitudes.hairFrontYCurl');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.hairBackXSway,     0.10,  'tagWarpMagnitudes.hairBackXSway');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.hairBackYCurl,     0.025, 'tagWarpMagnitudes.hairBackYCurl');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.bottomwearXSway,   0.04,  'tagWarpMagnitudes.bottomwearXSway');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.legwearXSway,      0.008, 'tagWarpMagnitudes.legwearXSway');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.topwearShirtXSway, 0.02,  'tagWarpMagnitudes.topwearShirtXSway');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.topwearBustY,      0.012, 'tagWarpMagnitudes.topwearBustY');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.eyebrowY,          0.15,  'tagWarpMagnitudes.eyebrowY');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.eyeConvergeYFrac,  0.80,  'tagWarpMagnitudes.eyeConvergeYFrac');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.iridesGazeX,       0.09,  'tagWarpMagnitudes.iridesGazeX');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.iridesGazeY,       0.075, 'tagWarpMagnitudes.iridesGazeY');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes.mouthYStretch,     0.35,  'tagWarpMagnitudes.mouthYStretch');

  // Frozen invariant — all sub-objects deep frozen.
  assert(Object.isFrozen(DEFAULT_AUTO_RIG_CONFIG), 'top-level frozen');
  assert(Object.isFrozen(DEFAULT_AUTO_RIG_CONFIG.bodyWarp), 'bodyWarp frozen');
  assert(Object.isFrozen(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.bxRange), 'bxRange frozen');
  assert(Object.isFrozen(DEFAULT_AUTO_RIG_CONFIG.faceParallax), 'faceParallax frozen');
  assert(Object.isFrozen(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionPerTag), 'protectionPerTag frozen');
  assert(Object.isFrozen(DEFAULT_AUTO_RIG_CONFIG.faceParallax.superGroups), 'superGroups frozen');
  assert(Object.isFrozen(DEFAULT_AUTO_RIG_CONFIG.faceParallax.superGroups['eye-l']), 'superGroups.eye-l frozen');
  assert(Object.isFrozen(DEFAULT_AUTO_RIG_CONFIG.neckWarp), 'neckWarp frozen');
  assert(Object.isFrozen(DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes), 'tagWarpMagnitudes frozen');
}

// --- buildAutoRigConfigFromProject: returns mutable deep copy ---

{
  const cfg = buildAutoRigConfigFromProject({});
  assertEq(cfg.bodyWarp.hipFracDefault, 0.45, 'build returns DEFAULT bodyWarp');
  assertEq(cfg.faceParallax.depthK, 0.80, 'build returns DEFAULT faceParallax');
  assertEq(cfg.neckWarp.tiltFrac, 0.08, 'build returns DEFAULT neckWarp');
  assert(!Object.isFrozen(cfg.bodyWarp), 'bodyWarp mutable');
  assert(!Object.isFrozen(cfg.bodyWarp.bxRange), 'bxRange mutable');
  assert(!Object.isFrozen(cfg.faceParallax.protectionPerTag), 'protectionPerTag mutable');
  assert(!Object.isFrozen(cfg.faceParallax.superGroups['eye-l']), 'eye-l members mutable');

  // Mutating must not leak.
  cfg.bodyWarp.hipFracDefault = 0.99;
  cfg.faceParallax.protectionPerTag['eyelash'] = 0;
  cfg.faceParallax.superGroups['eye-l'].push('extra');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.bodyWarp.hipFracDefault, 0.45, 'mutation does not leak — bodyWarp');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.protectionPerTag['eyelash'], 1.00, 'mutation does not leak — protectionPerTag');
  assertEq(DEFAULT_AUTO_RIG_CONFIG.faceParallax.superGroups['eye-l'], ['eyelash-l','eyewhite-l','irides-l'], 'mutation does not leak — superGroups');
}

// --- resolveAutoRigConfig: per-section fallback ---

{
  const def = buildAutoRigConfigFromProject({});
  assertEq(resolveAutoRigConfig({}),                          def, 'no project.autoRigConfig → DEFAULT');
  assertEq(resolveAutoRigConfig({ autoRigConfig: null }),     def, 'null → DEFAULT');
  assertEq(resolveAutoRigConfig({ autoRigConfig: {} }),       def, 'empty object → DEFAULT for each section');
}

{
  // Per-section fallback: bodyWarp populated, faceParallax + neckWarp missing.
  // bodyWarp must be returned as-is; the others fall back individually.
  const userBody = {
    canvasPadFrac: 0.20,
    hipFracDefault: 0.50,
    feetFracDefault: 0.80,
    feetMarginRf: 0.07,
    bxRange: { min: 0.05, max: 0.95 },
    byMargin: 0.07,
    breathMargin: 0.06,
    upperBodyTCap: 0.6,
    upperBodySlope: 2.0,
  };
  const project = { autoRigConfig: { bodyWarp: userBody } };
  const cfg = resolveAutoRigConfig(project);
  // I-7 fix: resolver now spread-merges over defaults, returns a fresh
  // object (caller can't accidentally mutate the stored config). Verify
  // every user field survived the merge.
  assertEq(cfg.bodyWarp.canvasPadFrac, userBody.canvasPadFrac, 'user bodyWarp.canvasPadFrac preserved');
  assertEq(cfg.bodyWarp.upperBodySlope, userBody.upperBodySlope, 'user bodyWarp.upperBodySlope preserved');
  assertEq(cfg.bodyWarp.bxRange.min, userBody.bxRange.min, 'user nested bxRange preserved');
  assertEq(cfg.faceParallax.depthK, 0.80, 'faceParallax falls back independently');
  assertEq(cfg.neckWarp.tiltFrac, 0.08, 'neckWarp falls back independently');
}

{
  // Malformed bodyWarp (NaN field) — only that section falls back; rest preserved.
  const userFp = {
    depthK: 0.99, edgeDepthK: 0.10,
    maxAngleXDeg: 25, maxAngleYDeg: 12,
    depthAmp: 4.0, eyeParallaxAmpX: 1.5, farEyeSquashAmp: 0.30,
    protectionStrength: 0.8, protectionFalloffBuffer: 0.20,
    protectionPerTag: { mouth: 0.5 },
    superGroups: {},
  };
  const project = {
    autoRigConfig: {
      bodyWarp: {
        canvasPadFrac: NaN, // malformed
        hipFracDefault: 0.45, feetFracDefault: 0.75,
        feetMarginRf: 0.05, bxRange: { min: 0.10, max: 0.90 },
        byMargin: 0.065, breathMargin: 0.055,
        upperBodyTCap: 0.5, upperBodySlope: 1.5,
      },
      faceParallax: userFp,
    },
  };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.bodyWarp.canvasPadFrac, 0.10, 'malformed bodyWarp falls back');
  // I-7: faceParallax stored shape is well-formed → spread-merge preserves
  // every user value (deep-equal verified field by field).
  assertEq(cfg.faceParallax.depthK, userFp.depthK, 'faceParallax.depthK preserved');
  assertEq(cfg.faceParallax.depthAmp, userFp.depthAmp, 'faceParallax.depthAmp preserved');
  assertEq(cfg.faceParallax.protectionPerTag.mouth, 0.5, 'faceParallax.protectionPerTag.mouth preserved');
}

{
  // Malformed faceParallax (non-finite protectionPerTag value).
  const project = {
    autoRigConfig: {
      faceParallax: {
        depthK: 0.80, edgeDepthK: 0.30,
        maxAngleXDeg: 15, maxAngleYDeg: 8,
        depthAmp: 3.0, eyeParallaxAmpX: 1.3, farEyeSquashAmp: 0.18,
        protectionStrength: 1.0, protectionFalloffBuffer: 0.12,
        protectionPerTag: { mouth: 'broken' }, // string, not number
        superGroups: {},
      },
    },
  };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.faceParallax.protectionPerTag['mouth'], 0.30, 'malformed protectionPerTag → DEFAULT');
}

{
  // Malformed superGroups (member is not an array).
  const project = {
    autoRigConfig: {
      faceParallax: {
        depthK: 0.80, edgeDepthK: 0.30,
        maxAngleXDeg: 15, maxAngleYDeg: 8,
        depthAmp: 3.0, eyeParallaxAmpX: 1.3, farEyeSquashAmp: 0.18,
        protectionStrength: 1.0, protectionFalloffBuffer: 0.12,
        protectionPerTag: {},
        superGroups: { 'eye-l': 'not an array' },
      },
    },
  };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.faceParallax.superGroups['eye-l'], ['eyelash-l','eyewhite-l','irides-l'], 'malformed superGroups → DEFAULT');
}

{
  // Custom neckWarp.tiltFrac.
  const project = { autoRigConfig: { neckWarp: { tiltFrac: 0.15 } } };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.neckWarp.tiltFrac, 0.15, 'custom tiltFrac preserved');
}

{
  // Malformed neckWarp.
  const project = { autoRigConfig: { neckWarp: { tiltFrac: 'wrong' } } };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.neckWarp.tiltFrac, 0.08, 'malformed neckWarp → DEFAULT');
}

// --- tagWarpMagnitudes (Stage 9a) per-section fallback ---

{
  // Section absent → DEFAULT for that section only.
  const project = {
    autoRigConfig: {
      bodyWarp: buildAutoRigConfigFromProject({}).bodyWarp,
      // tagWarpMagnitudes not set
    },
  };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.tagWarpMagnitudes.hairFrontXSway, 0.12, 'missing tagWarpMagnitudes → DEFAULT');
  assertEq(cfg.tagWarpMagnitudes.mouthYStretch,  0.35, 'missing tagWarpMagnitudes → DEFAULT');
}

{
  // Custom magnitudes are preserved as-is.
  const userMags = {
    ...buildAutoRigConfigFromProject({}).tagWarpMagnitudes,
    hairFrontXSway: 0.20,
    mouthYStretch: 0.50,
  };
  const project = { autoRigConfig: { tagWarpMagnitudes: userMags } };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.tagWarpMagnitudes.hairFrontXSway, 0.20, 'custom hairFrontXSway preserved');
  assertEq(cfg.tagWarpMagnitudes.mouthYStretch,  0.50, 'custom mouthYStretch preserved');
}

{
  // Malformed (one field missing) → whole section falls back. Other sections
  // stay user-tuned (per-section fallback).
  const userBody = {
    canvasPadFrac: 0.20, hipFracDefault: 0.50, feetFracDefault: 0.80,
    feetMarginRf: 0.07, bxRange: { min: 0.05, max: 0.95 },
    byMargin: 0.07, breathMargin: 0.06,
    upperBodyTCap: 0.6, upperBodySlope: 2.0,
  };
  const incompleteMags = {
    hairFrontXSway: 0.20,
    // most other fields missing
  };
  const project = {
    autoRigConfig: {
      bodyWarp: userBody,
      tagWarpMagnitudes: incompleteMags,
    },
  };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.bodyWarp.canvasPadFrac, userBody.canvasPadFrac, 'good bodyWarp.canvasPadFrac preserved');
  assertEq(cfg.bodyWarp.upperBodySlope, userBody.upperBodySlope, 'good bodyWarp.upperBodySlope preserved');
  assertEq(cfg.tagWarpMagnitudes.hairFrontXSway, 0.12, 'incomplete tagWarpMagnitudes → DEFAULT');
  assertEq(cfg.tagWarpMagnitudes.mouthYStretch,  0.35, 'incomplete tagWarpMagnitudes → DEFAULT');
}

{
  // Non-finite value in tagWarpMagnitudes → DEFAULT.
  const bad = {
    ...buildAutoRigConfigFromProject({}).tagWarpMagnitudes,
    eyebrowY: 'not a number',
  };
  const project = { autoRigConfig: { tagWarpMagnitudes: bad } };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.tagWarpMagnitudes.eyebrowY, 0.15, 'non-finite eyebrowY → DEFAULT (full section fallback)');
  assertEq(cfg.tagWarpMagnitudes.hairFrontXSway, 0.12, 'sibling magnitudes also reset by section fallback');
}

{
  // Forward-compat: extra unknown fields tolerated.
  const futureMags = {
    ...buildAutoRigConfigFromProject({}).tagWarpMagnitudes,
    unknownFutureField: 99,
  };
  const project = { autoRigConfig: { tagWarpMagnitudes: futureMags } };
  const cfg = resolveAutoRigConfig(project);
  // I-7: spread-merge walks stored keys so unknown-future fields survive.
  assertEq(cfg.tagWarpMagnitudes.unknownFutureField, 99, 'unknown future field preserved through merge (forward-compat)');
  assertEq(cfg.tagWarpMagnitudes.hairFrontXSway, 0.12, 'known fields still used');
}

// --- I-7: per-field spread defaults ---
//
// Schema-evolution scenario: a save written when faceParallax had
// only the original keys; a later schema added `someNewKnob`.
// Resolver should fill missing fields from defaults while preserving
// the user's tunings on the original fields.

{
  // bodyWarp section is shape-valid (passes isWellFormedBodyWarp), but
  // the user has tuned a subset and a hypothetical new field is absent.
  // The merge fills new fields from defaults; user tunings survive.
  const userBody = {
    canvasPadFrac: 0.20,           // user-tuned
    hipFracDefault: 0.50,           // user-tuned
    feetFracDefault: 0.75,
    feetMarginRf: 0.05,
    bxRange: { min: 0.10, max: 0.90 },
    byMargin: 0.065,
    breathMargin: 0.055,
    upperBodyTCap: 0.5,
    upperBodySlope: 1.5,
  };
  const project = { autoRigConfig: { bodyWarp: userBody } };
  const cfg = resolveAutoRigConfig(project);
  assertEq(cfg.bodyWarp.canvasPadFrac,  0.20, 'I-7: user canvasPadFrac preserved');
  assertEq(cfg.bodyWarp.hipFracDefault, 0.50, 'I-7: user hipFracDefault preserved');
  assertEq(cfg.bodyWarp.bxRange.min,    0.10, 'I-7: user nested bxRange.min preserved');
}

{
  // Resolver returns a fresh object — caller can't accidentally mutate
  // the stored config (was a footgun before I-7).
  const userBody = {
    canvasPadFrac: 0.20, hipFracDefault: 0.50, feetFracDefault: 0.75,
    feetMarginRf: 0.05, bxRange: { min: 0.10, max: 0.90 },
    byMargin: 0.065, breathMargin: 0.055,
    upperBodyTCap: 0.5, upperBodySlope: 1.5,
  };
  const project = { autoRigConfig: { bodyWarp: userBody } };
  const cfg = resolveAutoRigConfig(project);
  cfg.bodyWarp.canvasPadFrac = 999;  // mutate the resolver output
  assertEq(project.autoRigConfig.bodyWarp.canvasPadFrac, 0.20,
    'I-7: stored config not mutated by resolver-output mutation');
}

// --- seedAutoRigConfig: writes + destructive ---

{
  const project = {
    autoRigConfig: {
      bodyWarp: { canvasPadFrac: 0.99 }, // partial / malformed
      extraField: 'gone',
    },
  };
  seedAutoRigConfig(project);
  const cfg = project.autoRigConfig;
  assertEq(cfg.bodyWarp.canvasPadFrac, 0.10, 'seed overwrites bodyWarp.canvasPadFrac');
  assertEq(cfg.faceParallax.depthK,    0.80, 'seed populates faceParallax');
  assertEq(cfg.neckWarp.tiltFrac,      0.08, 'seed populates neckWarp');
  assert(!cfg.extraField, 'destructive: replaces entire config');
}

// --- EQUIVALENCE: seeded path === generator path (defaults match literals) ---

{
  const project = {};
  const generatorCfg = buildAutoRigConfigFromProject(project);
  seedAutoRigConfig(project);
  const seededCfg = resolveAutoRigConfig(project);
  assertEq(seededCfg, generatorCfg, 'EQUIVALENCE: seeded == generator');
}

// --- buildBodyWarpChain consumes autoRigBodyWarp ---

{
  // Three meshes spanning 0..400 in X and 0..600 in Y → char extent 400×600.
  const perMesh = [{ vertices: [0, 0, 400, 0, 400, 600, 0, 600] }];
  const canvasW = 800, canvasH = 800;

  const defaultResult = buildBodyWarpChain({
    perMesh, canvasW, canvasH, bodyAnalysis: null,
  });
  // padFrac=0.10 → BZ extends by 40px each side → BZ_W = 400 + 80 = 480.
  assertClose(defaultResult.layout.BZ_W, 480, 1e-6, 'bodyWarp default canvasPadFrac=0.10');

  const customResult = buildBodyWarpChain({
    perMesh, canvasW, canvasH, bodyAnalysis: null,
    autoRigBodyWarp: {
      canvasPadFrac: 0.20,
      hipFracDefault: 0.45, feetFracDefault: 0.75, feetMarginRf: 0.05,
      bxRange: { min: 0.10, max: 0.90 },
      byMargin: 0.065, breathMargin: 0.055,
      upperBodyTCap: 0.5, upperBodySlope: 1.5,
    },
  });
  // padFrac=0.20 → BZ extends by 80px each side → BZ_W = 400 + 160 = 560.
  assertClose(customResult.layout.BZ_W, 560, 1e-6, 'bodyWarp custom canvasPadFrac=0.20');
}

{
  // BX range plumbing: BX_MIN/MAX in layout reflect the config.
  const perMesh = [{ vertices: [0, 0, 100, 100] }];
  const result = buildBodyWarpChain({
    perMesh, canvasW: 200, canvasH: 200, bodyAnalysis: null,
    autoRigBodyWarp: {
      canvasPadFrac: 0.10,
      hipFracDefault: 0.45, feetFracDefault: 0.75, feetMarginRf: 0.05,
      bxRange: { min: 0.05, max: 0.95 },
      byMargin: 0.065, breathMargin: 0.055,
      upperBodyTCap: 0.5, upperBodySlope: 1.5,
    },
  });
  assertEq(result.layout.BX_MIN, 0.05, 'custom BX_MIN propagates');
  assertEq(result.layout.BX_MAX, 0.95, 'custom BX_MAX propagates');
}

{
  // HIP_FRAC_DEFAULT used when no anatomy data.
  const perMesh = [{ vertices: [0, 0, 100, 100] }];
  const result = buildBodyWarpChain({
    perMesh, canvasW: 200, canvasH: 200, bodyAnalysis: null,
    autoRigBodyWarp: {
      canvasPadFrac: 0.10,
      hipFracDefault: 0.55, feetFracDefault: 0.85, feetMarginRf: 0.05,
      bxRange: { min: 0.10, max: 0.90 },
      byMargin: 0.065, breathMargin: 0.055,
      upperBodyTCap: 0.5, upperBodySlope: 1.5,
    },
  });
  assertEq(result.debug.HIP_FRAC, 0.55, 'custom hipFracDefault used (no anatomy)');
  assertEq(result.debug.FEET_FRAC, 0.85, 'custom feetFracDefault used (no anatomy)');
  assertEq(result.debug.bodyFracSource, 'defaults', 'bodyFracSource records default path');
}

// --- buildNeckWarpSpec consumes autoRigNeckWarp ---

{
  const neckUnionBbox = { minX: 0, minY: 0, W: 100, H: 50 };
  const defaultSpec = buildNeckWarpSpec({
    neckUnionBbox,
    parentType: 'rotation',
    parentDeformerId: 'GroupRotation_neck',
    parentPivotCanvas: { x: 50, y: 25 },
    canvasToBodyXX: () => 0,
    canvasToBodyXY: () => 0,
  });
  // Top row at +30 keyform shifts by NECK_TILT_FRAC * spanX = 0.08 * 100 = 8.
  // First grid pos is (-50, -25) in pivot-relative; +8 in X = -42.
  const topRowFirstX_default = defaultSpec.spec.keyforms[2].positions[0]; // [+30] keyform, first vertex X
  const topRowFirstX_zero    = defaultSpec.spec.keyforms[1].positions[0]; // [0]   keyform, first vertex X
  assertClose(topRowFirstX_default - topRowFirstX_zero, 8, 1e-6, 'neckWarp default tiltFrac=0.08 → 8px shift');

  const customSpec = buildNeckWarpSpec({
    neckUnionBbox,
    parentType: 'rotation',
    parentDeformerId: 'GroupRotation_neck',
    parentPivotCanvas: { x: 50, y: 25 },
    canvasToBodyXX: () => 0,
    canvasToBodyXY: () => 0,
    autoRigNeckWarp: { tiltFrac: 0.16 },
  });
  const topRowFirstX_custom_p30 = customSpec.spec.keyforms[2].positions[0];
  const topRowFirstX_custom_z0  = customSpec.spec.keyforms[1].positions[0];
  assertClose(
    topRowFirstX_custom_p30 - topRowFirstX_custom_z0,
    16, 1e-6,
    'neckWarp custom tiltFrac=0.16 → 16px shift (2× default)'
  );
  assertEq(customSpec.debug.NECK_TILT_FRAC, 0.16, 'debug NECK_TILT_FRAC reflects custom config');
}

// --- Round-trip JSON ---

{
  const project = {};
  seedAutoRigConfig(project);
  const serialized = JSON.stringify(project.autoRigConfig);
  const reloaded = JSON.parse(serialized);
  const reloadedProject = { autoRigConfig: reloaded };
  const after = resolveAutoRigConfig(reloadedProject);
  const def = buildAutoRigConfigFromProject({});
  assertEq(after, def, 'round-trip preserves defaults');
}

{
  // Round-trip with custom values across all sections.
  const customProject = {
    autoRigConfig: {
      bodyWarp: {
        canvasPadFrac: 0.15, hipFracDefault: 0.50, feetFracDefault: 0.80,
        feetMarginRf: 0.06, bxRange: { min: 0.08, max: 0.92 },
        byMargin: 0.07, breathMargin: 0.06,
        upperBodyTCap: 0.55, upperBodySlope: 1.6,
      },
      faceParallax: {
        depthK: 0.85, edgeDepthK: 0.25,
        maxAngleXDeg: 18, maxAngleYDeg: 10,
        depthAmp: 3.5, eyeParallaxAmpX: 1.4, farEyeSquashAmp: 0.20,
        protectionStrength: 0.9, protectionFalloffBuffer: 0.10,
        protectionPerTag: { 'eyebrow': 0.7, 'mouth': 0.4 },
        superGroups: { 'eye-l': ['custom1'], 'eye-r': ['custom2'] },
      },
      neckWarp: { tiltFrac: 0.10 },
    },
  };
  const serialized = JSON.stringify(customProject.autoRigConfig);
  const reloaded = JSON.parse(serialized);
  const after = resolveAutoRigConfig({ autoRigConfig: reloaded });
  assertEq(after.bodyWarp.canvasPadFrac, 0.15, 'custom canvasPadFrac round-trip');
  assertEq(after.bodyWarp.bxRange, { min: 0.08, max: 0.92 }, 'custom bxRange round-trip');
  assertEq(after.faceParallax.depthK, 0.85, 'custom depthK round-trip');
  assertEq(after.faceParallax.protectionPerTag['eyebrow'], 0.7, 'custom protectionPerTag round-trip');
  assertEq(after.faceParallax.superGroups['eye-l'], ['custom1'], 'custom superGroups round-trip');
  assertEq(after.neckWarp.tiltFrac, 0.10, 'custom tiltFrac round-trip');
}

// --- Equivalence test: bodyWarp output identical when explicit config matches DEFAULT ---

{
  const perMesh = [{ vertices: [10, 10, 200, 10, 200, 300, 10, 300] }];
  const a = buildBodyWarpChain({
    perMesh, canvasW: 400, canvasH: 400, bodyAnalysis: null,
  });
  const b = buildBodyWarpChain({
    perMesh, canvasW: 400, canvasH: 400, bodyAnalysis: null,
    autoRigBodyWarp: buildAutoRigConfigFromProject({}).bodyWarp,
  });
  // Layout fields should match exactly.
  assertEq(a.layout, b.layout, 'EQUIVALENCE: default literals == seeded autoRigBodyWarp (layout)');
  assertEq(a.debug.HIP_FRAC, b.debug.HIP_FRAC, 'EQUIVALENCE: HIP_FRAC matches');
  assertEq(a.debug.FEET_FRAC, b.debug.FEET_FRAC, 'EQUIVALENCE: FEET_FRAC matches');
  // Spot-check a keyform vertex.
  assertEq(
    Array.from(a.specs[0].keyforms[2].positions),
    Array.from(b.specs[0].keyforms[2].positions),
    'EQUIVALENCE: BZ +10 keyform positions match'
  );
}

// --- Summary ---

console.log(`autoRigConfig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
