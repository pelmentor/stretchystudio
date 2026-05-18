// @ts-check

/**
 * NLA -- Non-Linear Animation stack.
 *
 * Phase 4 of the Animation Blender-Parity Plan. This module is the type
 * substrate (Slice 4.A); the evaluator lands in Slice 4.B, tweak-mode
 * helpers in 4.C, NLAEditor UI in 4.D, BakeNLA operator in 4.E.
 *
 * Loose port of Blender's `NlaTrack` and `NlaStrip` structs:
 *   - `reference/blender/source/blender/makesdna/DNA_anim_types.h:440-506`
 *     (NlaStrip)
 *   - `reference/blender/source/blender/makesdna/DNA_anim_types.h:514-538`
 *     (NlaTrack)
 *   - `reference/blender/source/blender/makesdna/DNA_anim_enums.h:373-485`
 *     (`eNlaStrip_Blend_Mode`, `eNlaStrip_Extrapolate_Mode`,
 *     `eNlaStrip_Flag`, `eNlaTrack_Flag`)
 *
 * # Four blend modes ship in Phase 4
 *
 * Per the plan's audit-driven scope (`combine` deferred -- Rule №1 forbids
 * silently degrading non-rotation combine to replace):
 *
 *   'replace'   -- `out = lerp(out, in, inf)`         (NLASTRIP_MODE_REPLACE  = 0)
 *   'add'       -- `out = out + in * inf`             (NLASTRIP_MODE_ADD      = 1)
 *   'subtract'  -- `out = out - in * inf`             (NLASTRIP_MODE_SUBTRACT = 2)
 *   'multiply'  -- `out = lerp(out, out * in, inf)`   (NLASTRIP_MODE_MULTIPLY = 3)
 *
 * Deferred: 'combine' (NLASTRIP_MODE_COMBINE = 4) -- needs proper
 * Euler↔quat composition for rotation channels and additive path for
 * non-rotation.
 *
 * # Three extend modes ship (full Blender parity)
 *
 *   'hold'         -- extend before first frame + hold+extend last
 *                     (NLASTRIP_EXTEND_HOLD         = 0)  // Blender default
 *   'hold_forward' -- only hold+extend last frame
 *                     (NLASTRIP_EXTEND_HOLD_FORWARD = 1)
 *   'nothing'      -- don't contribute outside [actstart, actend]
 *                     (NLASTRIP_EXTEND_NOTHING      = 2)
 *
 * # Time units
 *
 * Per `feedback_ms_canonical_animation_time`: every time field on a
 * strip (`start`, `end`, `actstart`, `actend`, `blendin`, `blendout`)
 * is **milliseconds**. `scale` and `repeat` are unitless multipliers.
 *
 * # Sparseness convention (Rule №2)
 *
 * `AnimData.nlaTracks[]` is itself sparse: missing-or-empty-array means
 * "no NLA, evaluate only AnimData.actionId". Each track + strip carries
 * all fields explicitly -- there is no missing-field-implies-default
 * shortcut at construction time. The constructors below are the SINGLE
 * source of truth for default values.
 *
 * @module anim/nla
 */

/**
 * NLA strip blend modes that ship in Phase 4.
 *
 * @typedef {('replace'|'add'|'subtract'|'multiply')} NlaBlendMode
 */

/**
 * NLA strip extend modes (Blender's `eNlaStrip_Extrapolate_Mode`).
 *
 * @typedef {('hold'|'hold_forward'|'nothing')} NlaExtendMode
 */

/**
 * The 4 ship-in-Phase-4 blend modes as a frozen list. UI dropdowns +
 * validation enumerate this. Order matches Blender's enum so the
 * default UI listing reads `replace / add / subtract / multiply`.
 * 'combine' (Blender mode 4) is intentionally absent.
 *
 * @type {Readonly<NlaBlendMode[]>}
 */
export const NLA_BLEND_MODES = Object.freeze(['replace', 'add', 'subtract', 'multiply']);

/**
 * The 3 extend modes. Blender enum order: hold (0) / hold_forward (1) /
 * nothing (2).
 *
 * @type {Readonly<NlaExtendMode[]>}
 */
export const NLA_EXTEND_MODES = Object.freeze(['hold', 'hold_forward', 'nothing']);

/**
 * Blender `eNlaStrip_Flag` bits (DNA_anim_enums.h:394-441).
 *
 * Only the bits SS exposes are listed; transform-temporaries
 * (INVALID_LOCATION, NO_TIME_MAP, TEMP_META, EDIT_TOUCHED) are
 * Blender-runtime-internal and don't ship as part of the schema.
 * SELECT_L / SELECT_R / MIRROR are commented-out in Blender too.
 */
export const NLASTRIP_FLAG = Object.freeze({
  ACTIVE:          1 << 0,    // strip is active in its track (also tweak indicator)
  SELECT:          1 << 1,    // selected for editing
  TWEAKUSER:       1 << 4,    // shares the action being tweaked
  USR_INFLUENCE:   1 << 5,    // influence driven by local F-Curve
  USR_TIME:        1 << 6,    // strip_time driven by local F-Curve
  USR_TIME_CYCLIC: 1 << 7,    // local-FCurve time is cyclic
  SYNC_LENGTH:     1 << 9,    // length synced to referenced action
  AUTO_BLENDS:     1 << 10,   // blendin/out set automatically from overlaps
  REVERSE:         1 << 11,   // playback reversed
  MUTED:           1 << 12,   // doesn't contribute
});

/**
 * Blender `eNlaTrack_Flag` bits (DNA_anim_enums.h:460-484).
 *
 * NLATRACK_TEMPORARILY_ADDED + NLATRACK_OVERRIDELIBRARY_LOCAL omitted
 * (transform/library-override runtime state, not schema-level).
 */
export const NLATRACK_FLAG = Object.freeze({
  ACTIVE:    1 << 0,    // track being tweaked
  SELECTED:  1 << 1,    // selected in UI
  MUTED:     1 << 2,    // not evaluated
  SOLO:      1 << 3,    // only this track evaluated (must AND with adt->flag)
  PROTECTED: 1 << 4,    // settings + strips cannot be edited
  DISABLED:  1 << 10,   // tweak-mode-triggered disable (internal)
});

/**
 * Blender `eAnimData_Flag` bits relevant to NLA (DNA_anim_enums.h:553-587).
 *
 * Full enum has UI-only bits (UI_SELECTED / UI_ACTIVE / CURVES_*) that
 * don't ship as part of the NLA substrate. Listed here are the bits
 * Phase 4 wires for evaluation + tweak mode.
 */
export const ADT_FLAG = Object.freeze({
  NLA_SOLO_TRACK:        1 << 0,   // any track has NLATRACK_SOLO set
  NLA_EVAL_OFF:          1 << 1,   // skip NLA evaluation entirely
  NLA_EDIT_ON:           1 << 2,   // tweak mode active
  NLA_EDIT_NOMAP:        1 << 3,   // tweak action lacks NLA mapping
  NLA_EVAL_UPPER_TRACKS: 1 << 5,   // evaluate tracks above tweaked strip
});

/**
 * @typedef {object} NlaStrip
 * @property {string} id                           -- unique within track
 * @property {string} name                         -- user-visible label
 * @property {string|null} actionId                -- ref into project.actions[]
 * @property {number} slotHandle                   -- ActionSlot::handle; 0 in Phase 4
 * @property {number} start                        -- ms; placement on track
 * @property {number} end                          -- ms
 * @property {number} actstart                     -- ms; action-local range start
 * @property {number} actend                       -- ms; action-local range end
 * @property {number} repeat                       -- 1.0 = no repeat
 * @property {number} scale                        -- 1.0 = no time scale
 * @property {NlaBlendMode} blendmode
 * @property {NlaExtendMode} extendmode
 * @property {number} influence                    -- 0..1 baseline
 * @property {number} blendin                      -- ms ramp-in
 * @property {number} blendout                     -- ms ramp-out
 * @property {Array<object>} fcurves               -- per-strip overrides (FCurve shape)
 * @property {number} flag                         -- NLASTRIP_FLAG bits
 */

/**
 * @typedef {object} NlaTrack
 * @property {string} id                           -- unique within animData
 * @property {string} name                         -- user-visible label
 * @property {NlaStrip[]} strips                   -- ordered left-to-right by time
 * @property {number} flag                         -- NLATRACK_FLAG bits
 * @property {number} index                        -- bottom-to-top order (0 = bottom)
 */

/**
 * Build a fresh NlaStrip.
 *
 * Defaults mirror Blender's `BKE_nlastrip_new` semantics
 * (`reference/blender/source/blender/blenkernel/intern/nla.cc`):
 *   - `blendmode = 'replace'` (NLASTRIP_MODE_REPLACE = 0; Blender default)
 *   - `extendmode = 'hold'`   (NLASTRIP_EXTEND_HOLD  = 0; Blender default)
 *   - `influence = 1`         (matches strip-creation default; user-controllable)
 *   - `repeat = 1`, `scale = 1` (identity time mapping)
 *   - `blendin = blendout = 0` (no auto-blend until AUTO_BLENDS flag set)
 *   - `flag = 0`              (clean strip; no MUTED/SELECTED/ACTIVE yet)
 *
 * Required overrides: `id` (caller-supplied uid) and `actionId`
 * (ref into project.actions[]). The strip is meaningless without an
 * action to reference, so we fail loud on null.
 *
 * Time fields (`start` / `end` / `actstart` / `actend`) default to 0;
 * callers MUST set them to the action's frame range before evaluation.
 * A 0-length strip has no effect (evaluator skips it).
 *
 * @param {string} id
 * @param {string} actionId
 * @param {Partial<NlaStrip>} [overrides]
 * @returns {NlaStrip}
 */
export function makeNlaStrip(id, actionId, overrides = {}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('makeNlaStrip: id must be a non-empty string');
  }
  if (typeof actionId !== 'string' || actionId.length === 0) {
    throw new Error('makeNlaStrip: actionId must be a non-empty string (strip refs an Action)');
  }
  /** @type {NlaStrip} */
  const strip = {
    id,
    name: overrides.name ?? id,
    actionId,
    slotHandle: 0,
    start: 0,
    end: 0,
    actstart: 0,
    actend: 0,
    repeat: 1,
    scale: 1,
    blendmode: 'replace',
    extendmode: 'hold',
    influence: 1,
    blendin: 0,
    blendout: 0,
    fcurves: [],
    flag: 0,
    ...overrides,
  };
  if (!NLA_BLEND_MODES.includes(strip.blendmode)) {
    throw new Error(
      `makeNlaStrip: blendmode '${strip.blendmode}' not in ${NLA_BLEND_MODES.join('|')} ` +
      `(NLASTRIP_MODE_COMBINE deferred -- see Phase 4 plan §4.B)`
    );
  }
  if (!NLA_EXTEND_MODES.includes(strip.extendmode)) {
    throw new Error(
      `makeNlaStrip: extendmode '${strip.extendmode}' not in ${NLA_EXTEND_MODES.join('|')}`
    );
  }
  return strip;
}

/**
 * Build a fresh NlaTrack.
 *
 * Defaults:
 *   - `strips = []` (empty until user adds; an empty track is valid but
 *     a no-op at eval time -- skipped by the evaluator's strip loop)
 *   - `flag = 0`  (no MUTED/SOLO/PROTECTED; ACTIVE bit set per-AnimData
 *     elsewhere)
 *   - `index = 0` (caller must set to its position in animData.nlaTracks
 *     before persisting -- evaluator iterates bottom-to-top by index)
 *
 * @param {string} id
 * @param {string} name
 * @param {Partial<NlaTrack>} [overrides]
 * @returns {NlaTrack}
 */
export function makeNlaTrack(id, name, overrides = {}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('makeNlaTrack: id must be a non-empty string');
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('makeNlaTrack: name must be a non-empty string');
  }
  /** @type {NlaTrack} */
  const track = {
    id,
    name,
    strips: [],
    flag: 0,
    index: 0,
    ...overrides,
  };
  return track;
}

/**
 * Predicate: does this object look like a well-formed NlaTrack?
 *
 * Single source of truth for validation -- consumers (evaluator,
 * exporter, UI) call this rather than open-coding `obj?.strips
 * && typeof obj.id === 'string'` checks. Returns false on undefined /
 * null / non-objects so call sites can `if (!isNlaTrack(t)) continue`.
 *
 * @param {unknown} obj
 * @returns {boolean}
 */
export function isNlaTrack(obj) {
  return Boolean(
    obj
    && typeof obj === 'object'
    && typeof /** @type {object} */ (obj).id === 'string'
    && typeof /** @type {object} */ (obj).name === 'string'
    && Array.isArray(/** @type {object} */ (obj).strips)
    && typeof /** @type {object} */ (obj).flag === 'number'
    && typeof /** @type {object} */ (obj).index === 'number'
  );
}

/**
 * Predicate: does this object look like a well-formed NlaStrip?
 *
 * Mirror of `isNlaTrack`. Validates the discriminator fields
 * (actionId / blendmode / extendmode) so the evaluator can trust
 * the strip's shape after one `if (!isNlaStrip(s)) continue` gate.
 *
 * @param {unknown} obj
 * @returns {boolean}
 */
export function isNlaStrip(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const s = /** @type {Record<string, unknown>} */ (obj);
  return (
    typeof s.id === 'string'
    && typeof s.actionId === 'string'
    && typeof s.start === 'number'
    && typeof s.end === 'number'
    && typeof s.actstart === 'number'
    && typeof s.actend === 'number'
    && typeof s.repeat === 'number'
    && typeof s.scale === 'number'
    && typeof s.influence === 'number'
    && typeof s.blendin === 'number'
    && typeof s.blendout === 'number'
    && typeof s.flag === 'number'
    && typeof s.blendmode === 'string'
    && NLA_BLEND_MODES.includes(/** @type {NlaBlendMode} */ (s.blendmode))
    && typeof s.extendmode === 'string'
    && NLA_EXTEND_MODES.includes(/** @type {NlaExtendMode} */ (s.extendmode))
  );
}

/**
 * Read the NLA track list from an animData slot defensively.
 *
 * Returns the empty array on missing-or-non-array (sparseness rule —
 * never throws on absent data). Returned array is the underlying
 * reference; callers MUST NOT mutate it directly without going through
 * a store action.
 *
 * @param {object|null|undefined} animData
 * @returns {NlaTrack[]}
 */
export function getNlaTracks(animData) {
  if (!animData || typeof animData !== 'object') return EMPTY_NLA_TRACKS;
  /** @type {unknown} */
  const tracks = /** @type {Record<string, unknown>} */ (animData).nlaTracks;
  if (!Array.isArray(tracks)) return EMPTY_NLA_TRACKS;
  return /** @type {NlaTrack[]} */ (tracks);
}

/**
 * Stable empty-array reference for selector-friendly fallback (avoids
 * the fresh-array-per-call trap documented in
 * `feedback_filter_in_selector`).
 *
 * Typed via cast because `Object.freeze` returns `readonly NlaTrack[]`
 * (tsc 5.x) which can't be returned from a function declaring `NlaTrack[]`.
 * Callers MUST NOT mutate this array directly (the `EMPTY_` prefix is
 * the contract; `Object.freeze` is the enforcement at runtime).
 */
const EMPTY_NLA_TRACKS = /** @type {NlaTrack[]} */
  (/** @type {unknown} */ (Object.freeze([])));

/**
 * Is this AnimData currently in NLA tweak mode?
 *
 * Reads `ADT_FLAG.NLA_EDIT_ON` (Blender `ADT_NLA_EDIT_ON` --
 * `DNA_anim_enums.h:559`). Centralised so callers don't open-code the
 * `(animData.flag & 4) !== 0` bitop -- if the flag value ever shifts
 * (it won't, it's frozen by Blender's enum), only this site changes.
 *
 * @param {object|null|undefined} animData
 * @returns {boolean}
 */
export function isTweakModeOn(animData) {
  if (!animData || typeof animData !== 'object') return false;
  const flag = /** @type {Record<string, unknown>} */ (animData).flag;
  if (typeof flag !== 'number') return false;
  return (flag & ADT_FLAG.NLA_EDIT_ON) !== 0;
}
