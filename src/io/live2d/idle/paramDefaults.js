/**
 * Per-parameter motion-generation tables for well-known Live2D Cubism standard
 * parameters, organised by preset.
 *
 * `kind` selects which generator from motionLib runs:
 *   - 'wander'    : sum-of-harmonics drift (head/eyes look-around)
 *   - 'sine'      : single-frequency oscillation (breath, body sway)
 *   - 'blink'     : eye open/close events (eye open params)
 *   - 'burst'     : periodic accent events (nods, glances)
 *   - 'syllables' : speech-like mouth pulses (talking)
 *   - 'constant'  : pin at default rest value (mouth/expression at rest)
 *
 * Bounds (`defaultMin/Max/Rest`) follow Cubism's Standard Parameters convention.
 *
 * Reference: https://docs.live2d.com/en/cubism-editor-manual/standard-parametor-list/
 *
 * @module io/live2d/idle/paramDefaults
 */

// ─── Shared parameter ranges (DRY: bounds rarely vary across presets) ───────
// Single source of truth for min/max/rest. Per-preset tables only override
// `kind` and `cfg` (the actual motion shape), not the bounds.
const RANGES = {
  ParamAngleX:      { defaultMin: -30, defaultMax: 30, defaultRest: 0 },
  ParamAngleY:      { defaultMin: -30, defaultMax: 30, defaultRest: 0 },
  ParamAngleZ:      { defaultMin: -30, defaultMax: 30, defaultRest: 0 },
  ParamBodyAngleX:  { defaultMin: -10, defaultMax: 10, defaultRest: 0 },
  ParamBodyAngleY:  { defaultMin: -10, defaultMax: 10, defaultRest: 0 },
  ParamBodyAngleZ:  { defaultMin: -10, defaultMax: 10, defaultRest: 0 },
  ParamBreath:      { defaultMin: 0,   defaultMax: 1,  defaultRest: 0 },
  ParamEyeLOpen:    { defaultMin: 0,   defaultMax: 1,  defaultRest: 1 },
  ParamEyeROpen:    { defaultMin: 0,   defaultMax: 1,  defaultRest: 1 },
  ParamEyeBallX:    { defaultMin: -1,  defaultMax: 1,  defaultRest: 0 },
  ParamEyeBallY:    { defaultMin: -1,  defaultMax: 1,  defaultRest: 0 },
  ParamBrowLY:      { defaultMin: -1,  defaultMax: 1,  defaultRest: 0 },
  ParamBrowRY:      { defaultMin: -1,  defaultMax: 1,  defaultRest: 0 },
  ParamMouthOpenY:  { defaultMin: 0,   defaultMax: 1,  defaultRest: 0 },
  ParamMouthForm:   { defaultMin: -1,  defaultMax: 1,  defaultRest: 0 },
  ParamCheek:       { defaultMin: 0,   defaultMax: 1,  defaultRest: 0 },
};

const r = (id) => RANGES[id];

// ─── Preset: idle ───────────────────────────────────────────────────────────
// The default rest motion. Wandering head, gentle body sway, breath, blinks.
export const IDLE_PARAMS = {
  ParamAngleX:     { ...r('ParamAngleX'),     kind: 'wander',   cfg: { amplitude: 12, harmonics: 3, mid: 0, samples: 24 } },
  ParamAngleY:     { ...r('ParamAngleY'),     kind: 'wander',   cfg: { amplitude: 7,  harmonics: 3, mid: 0, samples: 24 } },
  ParamAngleZ:     { ...r('ParamAngleZ'),     kind: 'wander',   cfg: { amplitude: 6,  harmonics: 2, mid: 0, samples: 20 } },
  ParamBodyAngleX: { ...r('ParamBodyAngleX'), kind: 'sine',     cfg: { amplitude: 2.5, period: 6500, phase: 0 } },
  ParamBodyAngleY: { ...r('ParamBodyAngleY'), kind: 'sine',     cfg: { amplitude: 1.8, period: 5500, phase: 0 } },
  ParamBodyAngleZ: { ...r('ParamBodyAngleZ'), kind: 'sine',     cfg: { amplitude: 2.5, period: 4500, phase: 0 } },
  ParamBreath:     { ...r('ParamBreath'),     kind: 'sine',     cfg: { amplitude: 0.5, period: 3500, phase: -Math.PI / 2, mid: 0.5 } },
  ParamEyeLOpen:   { ...r('ParamEyeLOpen'),   kind: 'blink',    cfg: { intervalAvgMs: 4000, intervalJitterMs: 1500, closedDurationMs: 60, openValue: 1, closedValue: 0 }, syncWith: 'ParamEyeROpen' },
  ParamEyeROpen:   { ...r('ParamEyeROpen'),   kind: 'blink',    cfg: { intervalAvgMs: 4000, intervalJitterMs: 1500, closedDurationMs: 60, openValue: 1, closedValue: 0 }, syncWith: 'ParamEyeLOpen' },
  ParamEyeBallX:   { ...r('ParamEyeBallX'),   kind: 'wander',   cfg: { amplitude: 0.4, harmonics: 2, mid: 0, samples: 16 } },
  ParamEyeBallY:   { ...r('ParamEyeBallY'),   kind: 'wander',   cfg: { amplitude: 0.25, harmonics: 2, mid: 0, samples: 16 } },
  ParamBrowLY:     { ...r('ParamBrowLY'),     kind: 'sine',     cfg: { amplitude: 0.08, period: 4000, phase: 0 } },
  ParamBrowRY:     { ...r('ParamBrowRY'),     kind: 'sine',     cfg: { amplitude: 0.08, period: 4000, phase: 0 } },
  ParamMouthOpenY: { ...r('ParamMouthOpenY'), kind: 'constant', cfg: { value: 0 } },
  ParamMouthForm:  { ...r('ParamMouthForm'),  kind: 'constant', cfg: { value: 0 } },
  ParamCheek:      { ...r('ParamCheek'),      kind: 'constant', cfg: { value: 0 } },
};

// ─── Preset: listening ──────────────────────────────────────────────────────
// Attentive engagement. Smaller head wander (focus held). Periodic acknowledgement
// nods on ParamAngleY ("uh-huh"). Slight body lean forward. Eyes track speaker.
export const LISTENING_PARAMS = {
  // Reduced wander — eyes mostly stay on speaker
  ParamAngleX:     { ...r('ParamAngleX'),     kind: 'wander',   cfg: { amplitude: 5,  harmonics: 2, mid: 0, samples: 20 } },
  // ParamAngleY: nod bursts INSTEAD of wander. Small downward acknowledgements.
  ParamAngleY:     { ...r('ParamAngleY'),     kind: 'burst',    cfg: { intervalAvgMs: 4500, intervalJitterMs: 2000, pulseDurationMs: 700, peakValue: -5, restValue: 0 } },
  // Subtle interested head tilt
  ParamAngleZ:     { ...r('ParamAngleZ'),     kind: 'wander',   cfg: { amplitude: 3,  harmonics: 2, mid: 0, samples: 16 } },
  // Body stays mostly still — engaged listener
  ParamBodyAngleX: { ...r('ParamBodyAngleX'), kind: 'sine',     cfg: { amplitude: 1.2, period: 7500, phase: 0 } },
  ParamBodyAngleY: { ...r('ParamBodyAngleY'), kind: 'sine',     cfg: { amplitude: 0.8, period: 6500, phase: 0 } },
  ParamBodyAngleZ: { ...r('ParamBodyAngleZ'), kind: 'sine',     cfg: { amplitude: 1.0, period: 5500, phase: 0 } },
  ParamBreath:     { ...r('ParamBreath'),     kind: 'sine',     cfg: { amplitude: 0.5, period: 3500, phase: -Math.PI / 2, mid: 0.5 } },
  // Slightly less frequent blinks — sustained attention
  ParamEyeLOpen:   { ...r('ParamEyeLOpen'),   kind: 'blink',    cfg: { intervalAvgMs: 5000, intervalJitterMs: 1500, closedDurationMs: 60, openValue: 1, closedValue: 0 }, syncWith: 'ParamEyeROpen' },
  ParamEyeROpen:   { ...r('ParamEyeROpen'),   kind: 'blink',    cfg: { intervalAvgMs: 5000, intervalJitterMs: 1500, closedDurationMs: 60, openValue: 1, closedValue: 0 }, syncWith: 'ParamEyeLOpen' },
  // Eyes more focused — smaller drift
  ParamEyeBallX:   { ...r('ParamEyeBallX'),   kind: 'wander',   cfg: { amplitude: 0.2, harmonics: 2, mid: 0, samples: 14 } },
  ParamEyeBallY:   { ...r('ParamEyeBallY'),   kind: 'wander',   cfg: { amplitude: 0.15, harmonics: 2, mid: 0, samples: 14 } },
  // Brows: slight engagement raise
  ParamBrowLY:     { ...r('ParamBrowLY'),     kind: 'sine',     cfg: { amplitude: 0.06, period: 5000, phase: 0, mid: 0.1 } },
  ParamBrowRY:     { ...r('ParamBrowRY'),     kind: 'sine',     cfg: { amplitude: 0.06, period: 5000, phase: 0, mid: 0.1 } },
  ParamMouthOpenY: { ...r('ParamMouthOpenY'), kind: 'constant', cfg: { value: 0 } },
  ParamMouthForm:  { ...r('ParamMouthForm'),  kind: 'constant', cfg: { value: 0 } },
  ParamCheek:      { ...r('ParamCheek'),      kind: 'constant', cfg: { value: 0 } },
};

// ─── Preset: talkingIdle ────────────────────────────────────────────────────
// Generic talking-while-no-lipsync. Mouth animates at speech tempo with random
// peaks; head adds emphasis bursts; brows occasionally raise. Useful as baseline
// during dialogue when no per-line lipsync data is available.
export const TALKING_IDLE_PARAMS = {
  ParamAngleX:     { ...r('ParamAngleX'),     kind: 'wander',   cfg: { amplitude: 8,  harmonics: 3, mid: 0, samples: 22 } },
  // Emphasis tilts (small bursts on Y) instead of wander
  ParamAngleY:     { ...r('ParamAngleY'),     kind: 'burst',    cfg: { intervalAvgMs: 3500, intervalJitterMs: 1500, pulseDurationMs: 500, peakValue: -3, restValue: 0 } },
  ParamAngleZ:     { ...r('ParamAngleZ'),     kind: 'wander',   cfg: { amplitude: 4,  harmonics: 2, mid: 0, samples: 18 } },
  ParamBodyAngleX: { ...r('ParamBodyAngleX'), kind: 'sine',     cfg: { amplitude: 1.8, period: 5500, phase: 0 } },
  ParamBodyAngleY: { ...r('ParamBodyAngleY'), kind: 'sine',     cfg: { amplitude: 1.2, period: 4500, phase: 0 } },
  ParamBodyAngleZ: { ...r('ParamBodyAngleZ'), kind: 'sine',     cfg: { amplitude: 1.8, period: 4000, phase: 0 } },
  ParamBreath:     { ...r('ParamBreath'),     kind: 'sine',     cfg: { amplitude: 0.5, period: 3000, phase: -Math.PI / 2, mid: 0.5 } },
  ParamEyeLOpen:   { ...r('ParamEyeLOpen'),   kind: 'blink',    cfg: { intervalAvgMs: 3500, intervalJitterMs: 1200, closedDurationMs: 60, openValue: 1, closedValue: 0 }, syncWith: 'ParamEyeROpen' },
  ParamEyeROpen:   { ...r('ParamEyeROpen'),   kind: 'blink',    cfg: { intervalAvgMs: 3500, intervalJitterMs: 1200, closedDurationMs: 60, openValue: 1, closedValue: 0 }, syncWith: 'ParamEyeLOpen' },
  ParamEyeBallX:   { ...r('ParamEyeBallX'),   kind: 'wander',   cfg: { amplitude: 0.35, harmonics: 2, mid: 0, samples: 16 } },
  ParamEyeBallY:   { ...r('ParamEyeBallY'),   kind: 'wander',   cfg: { amplitude: 0.2,  harmonics: 2, mid: 0, samples: 16 } },
  // Occasional emphasis brow raises
  ParamBrowLY:     { ...r('ParamBrowLY'),     kind: 'burst',    cfg: { intervalAvgMs: 4000, intervalJitterMs: 2000, pulseDurationMs: 600, peakValue: 0.35, restValue: 0 } },
  ParamBrowRY:     { ...r('ParamBrowRY'),     kind: 'burst',    cfg: { intervalAvgMs: 4000, intervalJitterMs: 2000, pulseDurationMs: 600, peakValue: 0.35, restValue: 0 } },
  // The headline: speech-rhythm mouth
  ParamMouthOpenY: { ...r('ParamMouthOpenY'), kind: 'syllables', cfg: { intervalAvgMs: 280, intervalJitterMs: 100, syllableDurationMs: 200, peakMin: 0.25, peakMax: 0.85, restValue: 0, pauseProbability: 0.12, pauseLengthMs: 700 } },
  ParamMouthForm:  { ...r('ParamMouthForm'),  kind: 'sine',     cfg: { amplitude: 0.15, period: 6000, phase: 0 } },
  ParamCheek:      { ...r('ParamCheek'),      kind: 'constant', cfg: { value: 0 } },
};

// ─── Preset: embarrassedHold ────────────────────────────────────────────────
// Sustained shy/embarrassed expression. Head tucked down, eyes glance away,
// cheeks blushing, brows raised in worry, slightly faster nervous breath.
// Mostly constants with subtle micro-motion to keep the character alive.
//
// Note: ParamCheek = 1 only takes effect if the model has a blush deformer
// bound to it. Auto-rig doesn't currently add one, so blush will only show
// on models that include it manually.
export const EMBARRASSED_HOLD_PARAMS = {
  // Head turned slightly away, downward gaze
  ParamAngleX:     { ...r('ParamAngleX'),     kind: 'sine',     cfg: { amplitude: 1.5, period: 6000, phase: 0, mid: -8 } },
  ParamAngleY:     { ...r('ParamAngleY'),     kind: 'sine',     cfg: { amplitude: 1,   period: 5500, phase: 0, mid: -10 } },
  ParamAngleZ:     { ...r('ParamAngleZ'),     kind: 'sine',     cfg: { amplitude: 1,   period: 5000, phase: 0, mid: -3 } },
  // Slight body lean away
  ParamBodyAngleX: { ...r('ParamBodyAngleX'), kind: 'sine',     cfg: { amplitude: 0.8, period: 7000, phase: 0, mid: -2 } },
  ParamBodyAngleY: { ...r('ParamBodyAngleY'), kind: 'sine',     cfg: { amplitude: 0.5, period: 5500, phase: 0 } },
  ParamBodyAngleZ: { ...r('ParamBodyAngleZ'), kind: 'sine',     cfg: { amplitude: 0.8, period: 6000, phase: 0, mid: 1.5 } },
  // Faster, slightly shallower breath (nervous)
  ParamBreath:     { ...r('ParamBreath'),     kind: 'sine',     cfg: { amplitude: 0.4, period: 2500, phase: -Math.PI / 2, mid: 0.5 } },
  // More frequent blinks (nervous)
  ParamEyeLOpen:   { ...r('ParamEyeLOpen'),   kind: 'blink',    cfg: { intervalAvgMs: 2800, intervalJitterMs: 1000, closedDurationMs: 70, openValue: 1, closedValue: 0 }, syncWith: 'ParamEyeROpen' },
  ParamEyeROpen:   { ...r('ParamEyeROpen'),   kind: 'blink',    cfg: { intervalAvgMs: 2800, intervalJitterMs: 1000, closedDurationMs: 70, openValue: 1, closedValue: 0 }, syncWith: 'ParamEyeLOpen' },
  // Eyes look down-and-away; small wander biased
  ParamEyeBallX:   { ...r('ParamEyeBallX'),   kind: 'sine',     cfg: { amplitude: 0.15, period: 4500, phase: 0, mid: 0.45 } },
  ParamEyeBallY:   { ...r('ParamEyeBallY'),   kind: 'sine',     cfg: { amplitude: 0.1,  period: 4000, phase: 0, mid: -0.3 } },
  // Brows raised (worried)
  ParamBrowLY:     { ...r('ParamBrowLY'),     kind: 'sine',     cfg: { amplitude: 0.05, period: 5000, phase: 0, mid: 0.4 } },
  ParamBrowRY:     { ...r('ParamBrowRY'),     kind: 'sine',     cfg: { amplitude: 0.05, period: 5000, phase: 0, mid: 0.4 } },
  ParamMouthOpenY: { ...r('ParamMouthOpenY'), kind: 'constant', cfg: { value: 0 } },
  // Mouth corners slightly down (uncomfortable)
  ParamMouthForm:  { ...r('ParamMouthForm'),  kind: 'sine',     cfg: { amplitude: 0.05, period: 4500, phase: 0, mid: -0.2 } },
  // Blush — held high
  ParamCheek:      { ...r('ParamCheek'),      kind: 'constant', cfg: { value: 1 } },
};


// ─── Preset registry ────────────────────────────────────────────────────────
// Use `getPresetTable(name)` to dispatch by preset name. Adding a new preset
// is one entry here + one PARAMS table above.
export const PRESETS = Object.freeze({
  idle:           { params: IDLE_PARAMS,            label: 'Idle',           description: 'Default rest — head wander, breath, blinks',                  cycleType: 'loop' },
  listening:      { params: LISTENING_PARAMS,       label: 'Listening',      description: 'Attentive pose with periodic acknowledgement nods',           cycleType: 'loop' },
  talkingIdle:    { params: TALKING_IDLE_PARAMS,    label: 'Talking idle',   description: 'Speech-tempo mouth + emphasis tilts and brow raises',         cycleType: 'loop' },
  embarrassedHold:{ params: EMBARRASSED_HOLD_PARAMS, label: 'Embarrassed',    description: 'Sustained shy expression — head down, eyes away, blush hold', cycleType: 'hold' },
});

export const PRESET_NAMES = Object.freeze(Object.keys(PRESETS));

export function getPresetTable(name) {
  return PRESETS[name] ?? null;
}

/**
 * Param IDs that should NEVER be touched by any motion regardless of preset.
 * Catches physics-driven bone rotation params (auto-rig: `ParamRotation_<name>`).
 *
 * Variant params (`Param<Suffix>` for emotion/outfit overlays) aren't listed —
 * they fall through naturally because they have no entry in any PRESETS table.
 *
 * Caller-supplied physics output set takes priority; this is a static defence
 * for callers that don't have access to physics3.json.
 */
export function isImplicitlySkipped(paramId) {
  if (paramId.startsWith('ParamRotation_')) return true;
  return false;
}

/** Personality dial — multiplies amplitudes/periods inside motionLib's applyPersonality. */
export const PERSONALITY_PRESETS = ['calm', 'energetic', 'tired', 'nervous', 'confident'];


// ─── Backwards compatibility ────────────────────────────────────────────────
// External callers (and a possible CLI build cache) may import the old name.
// Default to the idle preset so existing behaviour is preserved verbatim.
export const PARAM_DEFAULTS = IDLE_PARAMS;
export function getParamConfig(paramId) {
  return IDLE_PARAMS[paramId] ?? null;
}
