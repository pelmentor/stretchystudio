/**
 * Pure builder for procedural Live2D motion3.json content. No file I/O — feed
 * it the param list and a physics-output skip set, get back a JSON-serializable
 * motion3 object plus per-param keyframes ready to inject into a `.can3` via
 * the existing animation pipeline. Use from both the browser (export pipeline)
 * and Node CLIs.
 *
 * @module io/live2d/idle/builder
 */

import {
  genConstant, genSine, genWander, genBlink, genBurst, genSyllables,
  clampKeyframes, applyPersonality,
} from './motionLib.js';
import {
  getPresetTable, isImplicitlySkipped, PRESETS, PRESET_NAMES,
  PERSONALITY_PRESETS,
} from './paramDefaults.js';
import {
  encodeKeyframesToSegments, countSegmentsAndPoints,
} from '../motion3json.js';

export { PERSONALITY_PRESETS, PRESET_NAMES, PRESETS, isImplicitlySkipped };

/**
 * @typedef {Object} BuildMotionOpts
 * @property {string}         [preset='idle']    - One of PRESET_NAMES
 * @property {string[]}       paramIds            - Available parameter IDs in the target model (from cdi3)
 * @property {Set<string>}    [physicsOutputIds]  - Param IDs driven by physics — never animate these
 * @property {number}         [durationSec=8]     - Total motion duration (4..15 sane)
 * @property {number}         [fps=30]            - Recorded Meta.Fps
 * @property {string}         [personality='calm']
 * @property {number}         [seed=1]
 */

/**
 * @typedef {Object} BuildMotionResult
 * @property {string}  preset
 * @property {object}  motion3                  - JSON-serializable .motion3.json (runtime)
 * @property {string[]} animatedIds             - Param IDs that received a curve
 * @property {Map<string, Array<{time:number, value:number, easing:string}>>} paramKeyframes
 * @property {Map<string, {min:number, max:number, rest:number}>} paramRanges
 * @property {{id:string, reason:string}[]} skipped
 * @property {string[]} validationErrors         - Empty array on success
 */

const VALID_PERSONALITIES = new Set(PERSONALITY_PRESETS);

/* ── Per-param keyframe synthesis ─────────────────────────────────────── */

function synthesiseKeyframes(paramId, def, durationMs, personality, seed) {
  const cfg = applyPersonality({ ...def.cfg }, personality);

  let kfs;
  let shiftToRest = false;

  switch (def.kind) {
    case 'constant':
      kfs = genConstant({ durationMs, value: cfg.value });
      break;
    case 'sine':
      kfs = genSine({
        durationMs,
        amplitude: cfg.amplitude,
        period: cfg.period,
        phase: cfg.phase ?? 0,
        mid: cfg.mid ?? 0,
      });
      // Shift not needed: PARAM_DEFAULTS author chooses phase to control t=0.
      break;
    case 'wander':
      kfs = genWander({
        durationMs,
        amplitude: cfg.amplitude,
        harmonics: cfg.harmonics ?? 3,
        mid: cfg.mid ?? 0,
        samples: cfg.samples ?? 24,
        seed: seed * 31 + hashCode(paramId),
      });
      shiftToRest = true;
      break;
    case 'blink':
      kfs = genBlink({
        durationMs,
        intervalAvgMs: cfg.intervalAvgMs,
        intervalJitterMs: cfg.intervalJitterMs,
        closedDurationMs: cfg.closedDurationMs,
        openValue: cfg.openValue,
        closedValue: cfg.closedValue,
        seed: def.syncWith ? seed : seed * 17 + hashCode(paramId),
      });
      break;
    case 'burst':
      kfs = genBurst({
        durationMs,
        intervalAvgMs: cfg.intervalAvgMs,
        intervalJitterMs: cfg.intervalJitterMs,
        pulseDurationMs: cfg.pulseDurationMs,
        peakValue: cfg.peakValue,
        restValue: cfg.restValue ?? 0,
        seed: seed * 23 + hashCode(paramId),
      });
      break;
    case 'syllables':
      kfs = genSyllables({
        durationMs,
        intervalAvgMs: cfg.intervalAvgMs,
        intervalJitterMs: cfg.intervalJitterMs,
        syllableDurationMs: cfg.syllableDurationMs,
        peakMin: cfg.peakMin,
        peakMax: cfg.peakMax,
        restValue: cfg.restValue ?? 0,
        pauseProbability: cfg.pauseProbability,
        pauseLengthMs: cfg.pauseLengthMs,
        seed: seed * 41 + hashCode(paramId),
      });
      break;
    default:
      return null;
  }

  if (shiftToRest && kfs.length >= 2) {
    const offset = def.defaultRest - kfs[0].value;
    if (Math.abs(offset) > 1e-6) {
      kfs = kfs.map(kf => ({ ...kf, value: kf.value + offset }));
    }
  }

  return clampKeyframes(kfs, def.defaultMin, def.defaultMax);
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}


/* ── Validation ──────────────────────────────────────────────────────── */

export function validateMotion3(motion3) {
  const errs = [];
  if (motion3.Version !== 3) errs.push('Version must be 3');
  const m = motion3.Meta;
  if (!m) { errs.push('Missing Meta block'); return errs; }
  if (motion3.Curves.length !== m.CurveCount) {
    errs.push(`CurveCount mismatch: ${motion3.Curves.length} vs ${m.CurveCount}`);
  }

  let segSum = 0, ptSum = 0;
  for (const c of motion3.Curves) {
    if (c.Target !== 'Parameter' && c.Target !== 'PartOpacity' && c.Target !== 'Model') {
      errs.push(`Curve ${c.Id}: invalid Target ${c.Target}`);
    }
    if (!c.Segments || c.Segments.length < 2) {
      errs.push(`Curve ${c.Id}: empty Segments`);
      continue;
    }
    const info = countSegmentsAndPoints(c.Segments);
    segSum += info.segments;
    ptSum += info.points;

    if (m.Loop) {
      const firstVal = c.Segments[1];
      let i = 2, lastVal = firstVal;
      while (i < c.Segments.length) {
        const type = c.Segments[i];
        if (type === 1) { lastVal = c.Segments[i + 6]; i += 7; }
        else { lastVal = c.Segments[i + 2]; i += 3; }
      }
      if (Math.abs(lastVal - firstVal) > 1e-3) {
        errs.push(`Curve ${c.Id}: loop mismatch (first=${firstVal} last=${lastVal})`);
      }
    }
  }

  if (segSum !== m.TotalSegmentCount) {
    errs.push(`TotalSegmentCount mismatch: actual ${segSum} vs Meta ${m.TotalSegmentCount}`);
  }
  if (ptSum !== m.TotalPointCount) {
    errs.push(`TotalPointCount mismatch: actual ${ptSum} vs Meta ${m.TotalPointCount}`);
  }

  return errs;
}


/* ── Main entry: build a single motion from a preset ─────────────────── */

/**
 * Build a complete motion3.json + per-param keyframes from a parameter list,
 * a skip set, and a chosen preset.
 *
 * Decision flow per candidate param:
 *   1. In `physicsOutputIds`?         → skip ('physics-output')
 *   2. Implicit-skip (`ParamRotation_*`)? → skip ('implicit-skip')
 *   3. No entry in the preset table?  → skip ('no-default-config')
 *   4. Otherwise                      → synthesise keyframes + clamp + add curve
 *
 * @param {BuildMotionOpts} opts
 * @returns {BuildMotionResult}
 */
export function buildMotion3({
  preset = 'idle',
  paramIds,
  physicsOutputIds = new Set(),
  durationSec = 8,
  fps = 30,
  personality = 'calm',
  seed = 1,
}) {
  const presetEntry = getPresetTable(preset);
  if (!presetEntry) {
    throw new Error(`buildMotion3: unknown preset '${preset}'. Valid: ${PRESET_NAMES.join(', ')}`);
  }
  if (!Array.isArray(paramIds)) {
    throw new Error('buildMotion3: paramIds must be an array');
  }
  if (!VALID_PERSONALITIES.has(personality)) {
    throw new Error(`buildMotion3: unknown personality '${personality}'. Valid: ${PERSONALITY_PRESETS.join(', ')}`);
  }
  if (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > 60) {
    throw new Error(`buildMotion3: invalid durationSec ${durationSec} (must be 1..60)`);
  }

  const presetTable = presetEntry.params;
  // Fall back to all preset-table keys when caller's paramIds is empty.
  const candidatePool = paramIds.length > 0 ? paramIds : Object.keys(presetTable);

  const skipped = [];
  const targetParams = [];
  for (const id of candidatePool) {
    if (physicsOutputIds.has(id)) { skipped.push({ id, reason: 'physics-output' }); continue; }
    if (isImplicitlySkipped(id))   { skipped.push({ id, reason: 'implicit-skip' });  continue; }
    if (!presetTable[id])          { skipped.push({ id, reason: 'no-default-config' }); continue; }
    targetParams.push(id);
  }

  const durationMs = durationSec * 1000;
  const curves = [];
  let totalSegmentCount = 0;
  let totalPointCount = 0;
  const animatedIds = [];
  const paramKeyframes = new Map();
  const paramRanges = new Map();

  for (const id of targetParams) {
    const def = presetTable[id];
    const kfs = synthesiseKeyframes(id, def, durationMs, personality, seed);
    if (!kfs || kfs.length < 2) continue;

    const segments = encodeKeyframesToSegments(kfs, durationSec);
    if (segments.length === 0) continue;

    const segInfo = countSegmentsAndPoints(segments);
    totalSegmentCount += segInfo.segments;
    totalPointCount += segInfo.points;

    curves.push({ Target: 'Parameter', Id: id, Segments: segments });
    animatedIds.push(id);
    paramKeyframes.set(id, kfs);
    paramRanges.set(id, {
      min: def.defaultMin,
      max: def.defaultMax,
      rest: def.defaultRest,
    });
  }

  const motion3 = {
    Version: 3,
    Meta: {
      Duration: durationSec,
      Fps: fps,
      Loop: true,
      AreBeziersRestricted: false,
      CurveCount: curves.length,
      TotalSegmentCount: totalSegmentCount,
      TotalPointCount: totalPointCount,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: curves,
  };

  const validationErrors = validateMotion3(motion3);

  return {
    preset,
    motion3,
    animatedIds,
    paramKeyframes,
    paramRanges,
    skipped,
    validationErrors,
  };
}

/** Backwards-compatible alias — old callers used `buildIdleMotion3`. */
export function buildIdleMotion3(opts) {
  return buildMotion3({ ...opts, preset: 'idle' });
}


/* ── SS animation conversion ─────────────────────────────────────────── */

/**
 * Convert a `buildMotion3` result into a Stretchy Studio animation shape that
 * drops straight into `project.animations` (or an analogous array passed to
 * `generateCan3` / `generateMotion3Json`).
 *
 * Tracks use the first-class `parameter` track shape:
 *   `{ paramId, min, max, rest, keyframes }`
 *
 * @param {BuildMotionResult} result
 * @param {object} [opts]
 * @param {string} [opts.name]         - Scene/animation name; defaults to the preset's `label`
 * @param {number} [opts.durationMs]   - Override duration; defaults to result motion3 duration × 1000
 * @param {number} [opts.fps]          - Override fps; defaults to result motion3 fps
 * @returns {{animation: object}}
 */
export function resultToSsAnimation(result, opts = {}) {
  const presetEntry = PRESETS[result.preset];
  const defaultName = presetEntry?.label ?? result.preset ?? 'Motion';
  const {
    name = defaultName,
    durationMs = (result.motion3.Meta.Duration ?? 8) * 1000,
    fps = result.motion3.Meta.Fps ?? 30,
  } = opts;

  const tracks = [];
  for (const [paramId, kfs] of result.paramKeyframes) {
    const range = result.paramRanges.get(paramId);
    if (!range) continue;
    tracks.push({
      paramId,
      min: range.min,
      max: range.max,
      rest: range.rest,
      keyframes: kfs,
    });
  }

  const animation = {
    id: `__motion_${result.preset}_${Date.now()}`,
    name,
    duration: durationMs,
    fps,
    tracks,
  };

  return { animation };
}

/** Backwards-compatible alias. */
export function idleResultToSsAnimation(result, opts = {}) {
  return resultToSsAnimation(result, opts);
}
