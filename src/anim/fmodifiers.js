// @ts-check

/**
 * FModifier -- F-Curve modifier stack.
 *
 * Phase 3 of the Animation Blender-Parity Plan. This module is the type
 * substrate (Slice 3.A); the evaluator lands in Slice 3.B, UI in 3.C,
 * exporter bake passes in 3.D / 3.E.
 *
 * Loose port of Blender's `FModifier` and per-type data structs:
 *   - `reference/blender/source/blender/makesdna/DNA_anim_types.h:40-191`
 *     (`FModifier`, `FMod_Generator`, `FMod_FunctionGenerator`,
 *     `FCM_EnvelopeData`, `FMod_Envelope`, `FMod_Cycles`, `FMod_Limits`,
 *     `FMod_Noise`, `FMod_Stepped`, `FMod_Smooth`)
 *   - `reference/blender/source/blender/makesdna/DNA_anim_enums.h:24-124`
 *     (`eFModifier_Types`, `eFModifier_Flags`, `eFMod_Generator_Modes`,
 *     `eFMod_Generator_Flags`, `eFMod_Cycling_Modes`, `eFMod_Limit_Flags`,
 *     `eFMod_Noise_Modifications`, `eFMod_Stepped_Flags`)
 *
 * # Six modifier types ship in Phase 3
 *
 * Per the plan's audit-driven scope:
 *
 *   'cycles'    -- periodic extrapolation (4 modes match `eFMod_Cycling_Modes`)
 *   'noise'     -- Perlin noise overlay (size/strength/phase/depth/lacunarity/roughness)
 *   'generator' -- polynomial / factorised-polynomial generator
 *   'limits'    -- per-axis min/max clamp
 *   'stepped'   -- hold-for-N-time quantizer
 *   'envelope'  -- per-time min/max envelope
 *
 * Two Blender types are DEFERRED to a follow-up plan:
 *   'function_generator' (sin/cos/sqrt/ln/sinc -- niche; Cubism use case is thin)
 *   'smooth'             (Gaussian smoothing -- overlaps with Graph Editor re-key tools)
 *
 * # Per-FCurve modifier ordering
 *
 * `FCurve.modifiers[]` is an array (not a Set / Map) -- order matters and
 * is user-controllable via the modifier-stack UI. Evaluator processes
 * modifiers top-to-bottom matching Blender's `evaluate_fmodifiers_*`
 * (see `reference/blender/source/blender/blenkernel/intern/fmodifier.cc`).
 *
 * # Time units
 *
 * Per RULE feedback_ms_canonical_animation_time: every time field
 * (`sfra`, `efra`, `blendin`, `blendout`, `noise.size`, `noise.phase`,
 * `stepped.stepSize`, `stepped.offset`, `stepped.startTime`,
 * `stepped.endTime`, `envelope.controlPoints[*].time`) is **milliseconds**
 * in SS. Blender's source uses frames; conversion is documented in the
 * exporter at the motion3.json + animation engine boundaries.
 *
 * # Sparseness convention (Rule №2)
 *
 * `FCurve.modifiers` is itself sparse: missing-or-empty-array means "no
 * modifiers". On each FModifier, every flag is sparse-boolean: missing
 * means false. Per-type `data` field is REQUIRED when the modifier is
 * present (shape depends on `type` discriminator).
 *
 * @module anim/fmodifiers
 */

/**
 * The 6 modifier types that ship in Phase 3.
 *
 * Mapping to Blender's `eFModifier_Types` (`DNA_anim_enums.h:24-39`):
 *   'generator' → FMODIFIER_TYPE_GENERATOR (=1)
 *   'envelope'  → FMODIFIER_TYPE_ENVELOPE  (=3)
 *   'cycles'    → FMODIFIER_TYPE_CYCLES    (=4)
 *   'noise'     → FMODIFIER_TYPE_NOISE     (=5)
 *   'limits'    → FMODIFIER_TYPE_LIMITS    (=8)
 *   'stepped'   → FMODIFIER_TYPE_STEPPED   (=9)
 *
 * Not mapped: FMODIFIER_TYPE_NULL (=0) is Blender's "no modifier"
 * sentinel used internally before a real type is assigned; SS represents
 * absence via missing-or-empty `FCurve.modifiers` directly, so the NULL
 * type has no SS counterpart.
 *
 * Deferred: FN_GENERATOR (=2), SMOOTH (=10). Removed in Blender:
 * FILTER (=6, removed in #123906), PYTHON (=7, removed in #123906).
 *
 * @typedef {('cycles'|'noise'|'generator'|'limits'|'stepped'|'envelope')} FModifierType
 */

/**
 * F-Curve modifier -- the per-modifier record stored on
 * `FCurve.modifiers[i]`. Field set ported from Blender's `FModifier`
 * struct (`DNA_anim_types.h:40-73`).
 *
 * # Flag bits
 *
 * Blender packs five booleans into `FModifier.flag` (`eFModifier_Flags`,
 * `DNA_anim_enums.h:42-57`). SS port unpacks each into a sparse boolean:
 *
 *   `disabled`            ← FMODIFIER_FLAG_DISABLED       (=1<<0, internal)
 *   `active`              ← FMODIFIER_FLAG_ACTIVE         (=1<<2, sparse single per fcurve)
 *   `muted`               ← FMODIFIER_FLAG_MUTED          (=1<<3)
 *   `useRestrictedRange`  ← FMODIFIER_FLAG_RANGERESTRICT  (=1<<4)
 *   `useInfluence`        ← FMODIFIER_FLAG_USEINFLUENCE   (=1<<5)
 *
 * Bit 1<<1 (FMODIFIER_FLAG_EXPANDED) is `DNA_DEPRECATED_ALLOW`-gated in
 * Blender; replaced by `ui_expand_flag: short` (`DNA_anim_types.h:58`).
 * SS preserves the modern field as `uiExpandFlag` for sub-panel depth-
 * first bitfield expansion state.
 *
 * # `useRestrictedRange` semantics
 *
 * When `useRestrictedRange === true`, the modifier only takes effect for
 * times in `[sfra, efra]` with fade `blendin` ms in at the start and
 * `blendout` ms out at the end (Blender's `evaluate_fmodifier_range`).
 *
 * # `useInfluence` semantics
 *
 * When `useInfluence === true`, `influence` (0..1) blends the modifier's
 * output with its input value. When `useInfluence === false`, the
 * modifier's output is used unconditionally (equivalent to influence=1).
 *
 * @typedef {Object} FModifier
 * @property {string} id -- stable id (uuid or path-based)
 * @property {FModifierType} type -- discriminator
 * @property {string} [name] -- user-defined description (Blender's
 *   `char name[64]` at `DNA_anim_types.h:49`); sparse, default = type
 *   label
 * @property {FModCyclesData|FModNoiseData|FModGeneratorData|FModLimitsData|FModSteppedData|FModEnvelopeData} data
 *   -- per-type payload; shape selected by `type`
 * @property {number} [influence] -- 0..1 blend amount when
 *   `useInfluence=true`; sparse, default = 1
 * @property {boolean} [muted] -- Blender FMODIFIER_FLAG_MUTED bit; sparse,
 *   default = false (modifier is active)
 * @property {boolean} [active] -- Blender FMODIFIER_FLAG_ACTIVE bit;
 *   sparse single-active per FCurve invariant (mirrors the per-FCurve
 *   active-keyframe pattern from Slice 5.H)
 * @property {boolean} [disabled] -- Blender FMODIFIER_FLAG_DISABLED bit;
 *   internal -- set by the evaluator when a modifier fails to evaluate
 *   (e.g. generator with empty coefficients); UI greys it out
 * @property {boolean} [useRestrictedRange] -- Blender
 *   FMODIFIER_FLAG_RANGERESTRICT bit; sparse, default = false (effect
 *   spans full curve)
 * @property {boolean} [useInfluence] -- Blender FMODIFIER_FLAG_USEINFLUENCE
 *   bit; sparse, default = false (modifier output replaces input directly)
 * @property {number} [sfra] -- start of restricted range in ms; ignored
 *   unless `useRestrictedRange=true`
 * @property {number} [efra] -- end of restricted range in ms; ignored
 *   unless `useRestrictedRange=true`
 * @property {number} [blendin] -- fade-in duration in ms within
 *   `[sfra, sfra+blendin]`; sparse, default = 0 (instant on)
 * @property {number} [blendout] -- fade-out duration in ms within
 *   `[efra-blendout, efra]`; sparse, default = 0 (instant off)
 * @property {number} [uiExpandFlag] -- depth-first bitfield of panel
 *   expansion state (Blender's `ui_expand_flag: short`); UI-only
 */

/**
 * Cycles modifier data. Ports Blender's `FMod_Cycles`
 * (`DNA_anim_types.h:142-151`) and `eFMod_Cycling_Modes`
 * (`DNA_anim_enums.h:87-96`).
 *
 * # 4 modes match Blender exactly
 *
 *   'none'          → FCM_EXTRAPOLATE_NONE          (=0) -- do nothing
 *   'repeat'        → FCM_EXTRAPOLATE_CYCLIC        (=1) -- repeat range as-is
 *   'repeat_offset' → FCM_EXTRAPOLATE_CYCLIC_OFFSET (=2) -- repeat with gradient offset
 *   'mirror'        → FCM_EXTRAPOLATE_MIRROR        (=3) -- alternate fwd/rev
 *
 * The plan v1 invented a 5th 'extrapolate' mode; per the audit-driven
 * scope correction it's dropped -- FCurve-level extrapolation lives on
 * `FCurve.extrapolation` instead.
 *
 * # Cycle counts
 *
 * `beforeCycles` / `afterCycles` are non-negative numbers; **0 = infinite**
 * (Blender semantics -- `short` in DNA but treated as count-with-zero-
 * sentinel by the evaluator). Non-zero positive counts cap the number of
 * repeats in that direction.
 *
 * @typedef {Object} FModCyclesData
 * @property {('none'|'repeat'|'repeat_offset'|'mirror')} [before] -- extrapolation
 *   before first keyframe; sparse, default = 'none'
 * @property {('none'|'repeat'|'repeat_offset'|'mirror')} [after] -- extrapolation
 *   after last keyframe; sparse, default = 'none'
 * @property {number} [beforeCycles] -- repetition cap before first
 *   keyframe; sparse, default = 0 (infinite)
 * @property {number} [afterCycles] -- repetition cap after last
 *   keyframe; sparse, default = 0 (infinite)
 */

/**
 * Noise modifier data. Ports Blender's `FMod_Noise`
 * (`DNA_anim_types.h:163-175`) and `eFMod_Noise_Modifications`
 * (`DNA_anim_enums.h:107-116`).
 *
 * # Blend type mapping
 *
 *   'replace'  → FCM_NOISE_MODIF_REPLACE  (=0) -- output noise verbatim
 *   'add'      → FCM_NOISE_MODIF_ADD      (=1) -- output = input + noise
 *   'subtract' → FCM_NOISE_MODIF_SUBTRACT (=2) -- output = input - noise
 *   'multiply' → FCM_NOISE_MODIF_MULTIPLY (=3) -- output = input * noise
 *
 * # Lacunarity + roughness
 *
 * Per the plan's audit-driven scope: modern Blender Noise ships these
 * two octave-scaling fields. Defaults (Blender's CTX_DATA_NEW defaults
 * in `fmodifier.cc`): `lacunarity = 2.0`, `roughness = 0.5`.
 *
 * # Depth cap
 *
 * Blender's `depth` is `short` with no hard cap. SS soft-caps at 1..8
 * at the UI level (the editor slider); the data model accepts any
 * non-negative integer.
 *
 * # Determinism
 *
 * Per the plan §3.E: the Perlin seed is derived from
 * `(fcurveId, modifierId, time)` so noise is stable across saves and
 * byte-fidelity-testable. Slice 3.E owns the implementation.
 *
 * # Defaults (verified against Blender's `fcm_noise_new_data`)
 *
 * Blender's creator at `fmodifier.cc:798-812` sets:
 *   `size = 1.0` (frames; FPS-dependent in ms — at 24fps ~41.67ms)
 *   `strength = 1.0`
 *   `phase = 1.0` (not 0 — keeps t=0 off the Perlin origin)
 *   `offset = 0.0`
 *   `depth = 0` (single octave)
 *   `modification = FCM_NOISE_MODIF_REPLACE`
 *   `lacunarity = 2.0`
 *   `roughness = 0.5`
 *
 * SS deviates from Blender's `size = 1.0 frames` only — SS uses
 * `1000ms` as a user-friendly wavelength default. Audit-fix
 * 2026-05-18: substrate's first-draft `phase = 0` was a SS deviation
 * unrelated to the ms-unit port; corrected to `1.0` to match Blender.
 *
 * @typedef {Object} FModNoiseData
 * @property {number} [size] -- wavelength in ms; sparse, default = 1000
 *   (SS user-friendly default; Blender's creator uses `1.0` frames —
 *   FPS-dependent in ms; see "Defaults" section above)
 * @property {number} [strength] -- amplitude in value-units; sparse,
 *   default = 1 (matches Blender)
 * @property {number} [phase] -- time offset in ms; sparse, default = 1.0
 *   (matches Blender `data->phase = 1.0f` at `fmodifier.cc:805` — the
 *   non-zero default keeps the noise reproducible without all curves
 *   sampling the same Perlin point at t=0)
 * @property {number} [offset] -- value bias; sparse, default = 0
 * @property {('replace'|'add'|'subtract'|'multiply')} [blendType] --
 *   sparse, default = 'replace'
 * @property {number} [depth] -- number of octaves; sparse, default = 0
 *   (single octave; matches Blender's CTX_DATA_NEW default)
 * @property {number} [lacunarity] -- frequency multiplier per octave;
 *   sparse, default = 2.0
 * @property {number} [roughness] -- amplitude multiplier per octave;
 *   sparse, default = 0.5
 */

/**
 * Generator modifier data. Ports Blender's `FMod_Generator`
 * (`DNA_anim_types.h:78-92`) and `eFMod_Generator_Modes`
 * (`DNA_anim_enums.h:63-66`) + `eFMod_Generator_Flags`
 * (`DNA_anim_enums.h:71-74`).
 *
 * # Mode mapping
 *
 *   'polynomial'             → FCM_GENERATOR_POLYNOMIAL             (=0)
 *   'polynomial_factorised'  → FCM_GENERATOR_POLYNOMIAL_FACTORISED  (=1)
 *
 * `'polynomial'` evaluates as `c0 + c1*x + c2*x^2 + ...`
 * (matches Blender `value += coefficients[i] * powers[i]` at
 * `fmodifier.cc:190` where `powers[i] = x^i` and `powers[0] = 1`).
 *
 * `'polynomial_factorised'` evaluates as
 *   `(c0*x + c1) * (c2*x + c3) * (c4*x + c5) * ...`
 * (matches Blender `value *= (cp[0] * evaltime + cp[1])` at
 * `fmodifier.cc:217`). **Within each pair `[a, b]`, the scale `a` comes
 * first and the offset `b` comes second** -- i.e. the pair evaluates as
 * `a*x + b`, NOT `a + b*x`. Audit-fix 2026-05-18: the substrate's first
 * draft had this within-pair order inverted; corrected so the 3.B
 * evaluator implements the byte-faithful form.
 *
 * The plan v1 invented an `'expanded'` mode; per the audit-driven scope
 * correction it's renamed to `'polynomial_factorised'` to match Blender.
 *
 * # Additive vs replace (fidelity correction)
 *
 * The plan v1 listed `blendType: 'replace'|'add'|'subtract'|'multiply'`
 * for Generator -- that is the Noise modifier's shape, not Generator's.
 * Blender's `FMod_Generator.flag` is `eFMod_Generator_Flags` with one
 * meaningful bit: `FCM_GENERATOR_ADDITIVE = (1 << 0)`. SS port encodes
 * this as a single boolean: `additive` (true → output += generator,
 * false → output = generator). Other "blend modes" are not supported by
 * Blender's Generator modifier and should not be added.
 *
 * @typedef {Object} FModGeneratorData
 * @property {('polynomial'|'polynomial_factorised')} [mode] -- sparse,
 *   default = 'polynomial'
 * @property {number[]} coefficients -- polynomial coefficients; required
 *   field. For `'polynomial'`: `[c0, c1, c2, ...]` evaluates as
 *   `c0 + c1*x + c2*x^2 + ...`. For `'polynomial_factorised'`: pairs
 *   `[c0, c1, c2, c3, ...]` evaluate as `(c0*x + c1) * (c2*x + c3) *
 *   ...` so length should be even. **Pair order is scale-first then
 *   offset** (`[a, b] -> a*x + b`), matching Blender's
 *   `cp[0]*evaltime + cp[1]` at `fmodifier.cc:217`
 * @property {boolean} [additive] -- Blender FCM_GENERATOR_ADDITIVE bit;
 *   sparse, default = false (generator replaces input value)
 */

/**
 * Limits modifier data. Ports Blender's `FMod_Limits`
 * (`DNA_anim_types.h:154-160`) and `eFMod_Limit_Flags`
 * (`DNA_anim_enums.h:99-104`).
 *
 * # Bit unpack
 *
 * Blender stores a single `rctf rect` (`{xmin, xmax, ymin, ymax}`) + a
 * `flag` bitfield. SS port unpacks each axis-gate into a sparse boolean
 * and stores axis limits in named fields for readability:
 *
 *   `useMinX` ← FCM_LIMIT_XMIN (=1<<0)
 *   `useMaxX` ← FCM_LIMIT_XMAX (=1<<1)
 *   `useMinY` ← FCM_LIMIT_YMIN (=1<<2)
 *   `useMaxY` ← FCM_LIMIT_YMAX (=1<<3)
 *
 * X = time axis (in ms); Y = value axis. Each `min*`/`max*` field is
 * only consulted when the matching `use*` flag is true.
 *
 * @typedef {Object} FModLimitsData
 * @property {boolean} [useMinX] -- sparse, default = false
 * @property {boolean} [useMaxX] -- sparse, default = false
 * @property {boolean} [useMinY] -- sparse, default = false
 * @property {boolean} [useMaxY] -- sparse, default = false
 * @property {number} [minX] -- lower time bound in ms; sparse, ignored
 *   unless `useMinX=true`
 * @property {number} [maxX] -- upper time bound in ms; sparse, ignored
 *   unless `useMaxX=true`
 * @property {number} [minY] -- lower value bound; sparse, ignored
 *   unless `useMinY=true`
 * @property {number} [maxY] -- upper value bound; sparse, ignored
 *   unless `useMaxY=true`
 */

/**
 * Stepped modifier data. Ports Blender's `FMod_Stepped`
 * (`DNA_anim_types.h:178-191`) and `eFMod_Stepped_Flags`
 * (`DNA_anim_enums.h:119-124`).
 *
 * # Flag semantic flip
 *
 * Blender uses NEGATIVE semantics in `eFMod_Stepped_Flags`:
 *   FCM_STEPPED_NO_BEFORE = (1<<0) -- bit SET means DON'T affect frames
 *                                    before `start_frame`
 *   FCM_STEPPED_NO_AFTER  = (1<<1) -- bit SET means DON'T affect frames
 *                                    after `end_frame`
 *
 * SS port flips to POSITIVE semantics for editor readability:
 *   `useStartTime = true`  ↔ Blender `FCM_STEPPED_NO_BEFORE` bit IS set
 *   `useEndTime   = true`  ↔ Blender `FCM_STEPPED_NO_AFTER`  bit IS set
 *
 * (Round-tripping with a Blender file requires the inversion at the I/O
 * boundary; SS doesn't import .blend files today so no boundary exists
 * yet -- the inversion is documented for future NLA / .blend importer.)
 *
 * @typedef {Object} FModSteppedData
 * @property {number} [stepSize] -- hold duration per step in ms; sparse,
 *   default = 2 (Blender default `step_size = 2.0`)
 * @property {number} [offset] -- phase offset in ms -- the time value at
 *   which step boundaries align (Blender `offset`); sparse, default = 0
 * @property {boolean} [useStartTime] -- restrict stepping to start at
 *   `startTime`; sparse, default = false
 * @property {boolean} [useEndTime] -- restrict stepping to end at
 *   `endTime`; sparse, default = false
 * @property {number} [startTime] -- earliest time the stepping engages,
 *   in ms; ignored unless `useStartTime=true`
 * @property {number} [endTime] -- latest time the stepping engages, in
 *   ms; ignored unless `useEndTime=true`
 */

/**
 * Envelope modifier control point. Ports Blender's `FCM_EnvelopeData`
 * (`DNA_anim_types.h:115-125`).
 *
 * Each point defines a `(time, min, max)` triple; the envelope linearly
 * interpolates `(min, max)` between adjacent points. Blender stores `f1`
 * / `f2` short flags per point for UI selection state -- deferred to
 * Slice 3.C (UI) since they have no eval-time meaning.
 *
 * @typedef {Object} FModEnvelopeControlPoint
 * @property {number} time -- in ms
 * @property {number} min
 * @property {number} max
 */

/**
 * Envelope modifier data. Ports Blender's `FMod_Envelope`
 * (`DNA_anim_types.h:128-138`).
 *
 * # Reference value semantics
 *
 * Blender's `midval` is the "reference value" that the envelope
 * influence is centred around; `min` / `max` are the default offsets
 * from `midval` for "unit influence". Envelope effect at time `t` is:
 *   `output = lerp(input, clamp(input, point.min, point.max),
 *                  influence_at_t)`
 * where the per-time `(min, max)` is interpolated between control
 * points and falls back to `(referenceValue + defaultMin,
 * referenceValue + defaultMax)` outside the control-point range.
 *
 * @typedef {Object} FModEnvelopeData
 * @property {FModEnvelopeControlPoint[]} [controlPoints] -- sorted by
 *   `time`; sparse, default = []
 * @property {number} [referenceValue] -- Blender `midval`; sparse,
 *   default = 0
 * @property {number} [defaultMin] -- Blender `min`; default offset below
 *   `referenceValue`; sparse, default = 0
 * @property {number} [defaultMax] -- Blender `max`; default offset above
 *   `referenceValue`; sparse, default = 0
 */

/**
 * The six modifier types that ship in Phase 3, as a typed string-tuple.
 * Useful for `includes()` checks and UI dropdown population.
 *
 * Mirrors `FModifierType` typedef above; exported as a runtime constant.
 *
 * Order matches the Blender enum order for the supported types
 * (`DNA_anim_enums.h:24-39`):
 *   GENERATOR (=1), ENVELOPE (=3), CYCLES (=4), NOISE (=5),
 *   LIMITS (=8), STEPPED (=9).
 */
export const FMODIFIER_TYPES = Object.freeze([
  'generator',
  'envelope',
  'cycles',
  'noise',
  'limits',
  'stepped',
]);

/**
 * Type guard -- returns true iff `value` is one of the six supported
 * FModifier type discriminators.
 *
 * @param {unknown} value
 * @returns {value is FModifierType}
 */
export function isFModifierType(value) {
  return typeof value === 'string' && FMODIFIER_TYPES.includes(/** @type {any} */ (value));
}

/**
 * Frozen empty-array singleton returned by `getFCurveModifiers` when
 * the modifier list is absent. Module-scope so every reader shares one
 * allocation. Hoisted above its consumer per the Phase 0.D.0
 * const-before-cache-hit-branch lesson (commit `1671449`).
 *
 * @type {FModifier[]}
 */
const EMPTY_MODIFIERS = Object.freeze(/** @type {any} */ ([]));

/**
 * Read the modifier list off an FCurve. Returns the frozen empty-array
 * singleton for missing / non-array `modifiers` so callers can iterate
 * unconditionally.
 *
 * @param {{ modifiers?: FModifier[] } | null | undefined} fcurve
 * @returns {FModifier[]}
 */
export function getFCurveModifiers(fcurve) {
  if (!fcurve || !Array.isArray(fcurve.modifiers)) return EMPTY_MODIFIERS;
  return fcurve.modifiers;
}

// ===========================================================================
// Slice 3.B -- F-Curve modifier evaluator
//
// Port of Blender's two-pass evaluator at
// `reference/blender/source/blender/blenkernel/intern/fmodifier.cc:1490-1595`
// (`evaluate_time_fmodifiers` + `evaluate_value_fmodifiers`).
//
// # Architecture
//
// Modifiers split into two roles:
//
//   - **time-modifying**: warp `evaltime` BEFORE the keyframe sample.
//     Walked in REVERSE order (last index --> first index) per
//     `fmodifier.cc:1515-1517`. Reverse-walk creates a "macro to micro
//     waterfall" so multiple time warps compose without re-evaluation
//     cascades.
//
//   - **value-modifying**: warp the sampled `cvalue` AFTER the keyframe
//     sample. Walked in FORWARD order (first --> last) per
//     `fmodifier.cc:1568-1569`. Standard stack semantics.
//
// Per-type dispatch (matches the FModifierTypeInfo `evaluate_modifier_time`
// + `evaluate_modifier` pointers at `fmodifier.cc:780-794` (Cycles),
// `:869-883` (Noise), `:234-248` (Generator), `:924-938` (Limits),
// `:984-1003` (Stepped), `:483-497` (Envelope)):
//
//   |   type    | time pass | value pass | storage handoff |
//   |-----------|-----------|------------|-----------------|
//   | cycles    |    YES    |    YES     | cycyofs (set in time, added in value) |
//   | noise     |    --     |    YES     | none |
//   | generator |    --     |    YES     | none |
//   | limits    |    YES    |    YES     | none (X clamp in time, Y clamp in value) |
//   | stepped   |    YES    |    --      | none |
//   | envelope  |    --     |    YES     | none |
//
// # Influence + range gate
//
// Port of `eval_fmodifier_influence` at `fmodifier.cc:1443-1488`:
//   - if `useInfluence` flag set: use `modifier.influence`, else 1.0
//   - if `useRestrictedRange` flag set AND evaltime outside `[sfra, efra]`:
//     influence = 0 (modifier has no effect)
//   - inside `[sfra, sfra+blendin]`: influence *= linear ramp (fade in)
//   - inside `[efra-blendout, efra]`: influence *= linear ramp (fade out)
//
// The final blend matches Blender's
// `interpf(nval, original, influence) = nval*influence + original*(1-influence)`
// so influence=1 yields the new value, influence=0 yields the unchanged
// original (`fmodifier.cc:1540` + `:1590`).
//
// # Disabled / Muted gate
//
// Per `fmodifier.cc:1533` and `:1582`: a modifier is skipped entirely when
// either `disabled` (internal eval-failure flag) or `muted` (user toggle)
// is true.
//
// # Cycles placement constraint
//
// Blender asserts Cycles modifiers MUST be at the head of the array
// (`fmodifier.cc:635` `BLI_assert(fcm->prev == nullptr)`) so the reverse
// time-walk processes them LAST -- after all other time warps have
// applied. SS doesn't enforce this at the evaluator; 3.C UI is
// responsible for keeping Cycles at index 0 of the stack.
//
// # Noise: not per-FCurve-seeded (deviation from plan §3.E)
//
// The plan §3.E claims Noise's seed is `(fcurveId, modifierId, time)`.
// Blender doesn't seed per-fcurve: the noise is determined ENTIRELY by
// `(size, phase, offset, depth, lacunarity, roughness, evaltime)` per
// `fmodifier.cc:843-848`. Two Noise modifiers on different FCurves with
// the same params produce the same noise pattern -- this matches expected
// user behavior ("change phase to get a different pattern"). SS port
// matches Blender; the plan claim is documented as wrong.
//
// ===========================================================================

// ---------------------------------------------------------------------------
// Perlin 2D noise primitive
//
// Ken Perlin's "Improved Noise" reference algorithm (SIGGRAPH 2002).
// Used by `evaluateNoiseValue` as the per-sample noise source; wrapped
// into a fractal-Brownian-motion summation that mirrors Blender's
// `noise::perlin_fbm<float2>` at
// `reference/blender/source/blender/blenlib/intern/noise.cc`.
//
// SS deviation from Blender:
//   - Blender's `perlin_fbm` uses an internal hash-based gradient
//     scheme (`BLI_noise.hh`).
//   - SS uses Ken Perlin's permutation-table approach.
// Both produce deterministic, smooth noise with the same FBM math
// (octave summation with frequency *= lacunarity and amplitude *=
// roughness). Sample values won't match Blender bit-for-bit, but the
// statistical character (mean ~0.5, range ~[0,1], smooth continuity)
// matches, so 3.E's bake-at-export pipeline can use SS noise without
// any Blender round-trip dependency.
// ---------------------------------------------------------------------------

/** Ken Perlin's reference 256-entry permutation table, doubled for wrap-free indexing. */
const PERLIN_PERM = (() => {
  const base = [
    151, 160, 137,  91,  90,  15, 131,  13, 201,  95,  96,  53, 194, 233,   7, 225,
    140,  36, 103,  30,  69, 142,   8,  99,  37, 240,  21,  10,  23, 190,   6, 148,
    247, 120, 234,  75,   0,  26, 197,  62,  94, 252, 219, 203, 117,  35,  11,  32,
     57, 177,  33,  88, 237, 149,  56,  87, 174,  20, 125, 136, 171, 168,  68, 175,
     74, 165,  71, 134, 139,  48,  27, 166,  77, 146, 158, 231,  83, 111, 229, 122,
     60, 211, 133, 230, 220, 105,  92,  41,  55,  46, 245,  40, 244, 102, 143,  54,
     65,  25,  63, 161,   1, 216,  80,  73, 209,  76, 132, 187, 208,  89,  18, 169,
    200, 196, 135, 130, 116, 188, 159,  86, 164, 100, 109, 198, 173, 186,   3,  64,
     52, 217, 226, 250, 124, 123,   5, 202,  38, 147, 118, 126, 255,  82,  85, 212,
    207, 206,  59, 227,  47,  16,  58,  17, 182, 189,  28,  42, 223, 183, 170, 213,
    119, 248, 152,   2,  44, 154, 163,  70, 221, 153, 101, 155, 167,  43, 172,   9,
    129,  22,  39, 253,  19,  98, 108, 110,  79, 113, 224, 232, 178, 185, 112, 104,
    218, 246,  97, 228, 251,  34, 242, 193, 238, 210, 144,  12, 191, 179, 162, 241,
     81,  51, 145, 235, 249,  14, 239, 107,  49, 192, 214,  31, 181, 199, 106, 157,
    184,  84, 204, 176, 115, 121,  50,  45, 127,   4, 150, 254, 138, 236, 205,  93,
    222, 114,  67,  29,  24,  72, 243, 141, 128, 195,  78,  66, 215,  61, 156, 180,
  ];
  const doubled = new Uint8Array(512);
  for (let i = 0; i < 256; i++) doubled[i] = base[i];
  for (let i = 0; i < 256; i++) doubled[256 + i] = base[i];
  return doubled;
})();

/** Quintic smoothstep `6t^5 - 15t^4 + 10t^3` (Perlin 2002). */
function perlinFade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Linear interpolation. */
function perlinLerp(t, a, b) {
  return a + t * (b - a);
}

/**
 * Perlin gradient function for 2D. Selects one of 12 cube-edge gradients
 * via the low 4 bits of the hash and dot-products with (x, y).
 *
 * Reference: Ken Perlin's reference 3D `grad` adapted to 2D by treating
 * the third axis as zero. Standard JS Perlin port.
 */
function perlinGrad(hash, x, y) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : 0);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * Ken Perlin's 2D improved noise. Returns a smooth pseudo-random value
 * in approximately `[-1, +1]` for any (x, y) input. Deterministic across
 * runs -- same input always produces same output.
 *
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function perlinNoise2D(x, y) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = perlinFade(xf);
  const v = perlinFade(yf);
  const P = PERLIN_PERM;
  const A = P[X] + Y;
  const B = P[X + 1] + Y;
  return perlinLerp(v,
    perlinLerp(u, perlinGrad(P[A],     xf,     yf),
                  perlinGrad(P[B],     xf - 1, yf)),
    perlinLerp(u, perlinGrad(P[A + 1], xf,     yf - 1),
                  perlinGrad(P[B + 1], xf - 1, yf - 1)));
}

/**
 * Fractal Brownian Motion summation of `perlinNoise2D`. Matches Blender's
 * `noise::perlin_fbm` at `noise.cc` -- octaves are summed with frequency
 * scaled by `lacunarity` per octave and amplitude scaled by `roughness`
 * per octave. The result is renormalised to roughly `[0, 1]` (Blender's
 * `perlin_fbm` with `normalize=true` flag — `fmodifier.cc:848`).
 *
 * `depth` is the number of additional octaves on top of the base octave;
 * `depth = 0` is single-octave Perlin (Blender's default new-modifier
 * value at `fmodifier.cc:807`).
 *
 * # Deviation: no partial-octave fractional blend
 *
 * Blender's `noise.cc:713-718` does an extra partial-octave summation
 * when `depth` has a fractional remainder:
 *   `rmd = detail - floor(detail)`
 *   if `rmd != 0`: blend `sum` and `sum2` (with extra octave) by `rmd`
 * SS truncates to integer octaves. This is SAFE for the FModifier use
 * case because `FMod_Noise.depth` is `short` (`DNA_anim_types.h:171`)
 * and the SS typedef constrains depth to integer values -- the
 * fractional-octave path can never trigger from FModifier eval.
 * Documented as a known SS deviation (3.B fidelity audit HIGH-1; sub-
 * threshold once depth-is-integer constraint is established).
 *
 * @param {number} x
 * @param {number} y
 * @param {number} depth -- number of additional octaves (0..N)
 * @param {number} roughness -- amplitude multiplier per octave
 * @param {number} lacunarity -- frequency multiplier per octave
 * @returns {number} approximately in [0, 1]
 */
export function perlinFbm2D(x, y, depth, roughness, lacunarity) {
  let value = 0;
  let amplitude = 1;
  let maxAmplitude = 0;
  let freq = 1;
  const octaves = Math.max(0, Math.floor(depth)) + 1;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * perlinNoise2D(x * freq, y * freq);
    maxAmplitude += amplitude;
    amplitude *= roughness;
    freq *= lacunarity;
  }
  if (maxAmplitude === 0) return 0.5;
  // Renormalise from Perlin's ~[-1,+1] to [0,1] (matches Blender's
  // `normalize=true` flag which divides by total amplitude then
  // remaps via `(n + 1) * 0.5`).
  return (value / maxAmplitude + 1) * 0.5;
}

// ---------------------------------------------------------------------------
// Per-modifier influence (range + blendin/blendout)
// ---------------------------------------------------------------------------

/**
 * Compute the effective influence of a modifier at `evaltime`. Ports
 * `eval_fmodifier_influence` at `fmodifier.cc:1443-1488`.
 *
 * Returns 0 when the modifier is outside its restricted range (and the
 * range restriction is active) -- meaning the modifier has no effect.
 * Returns the modifier's `influence` (or 1.0 when `useInfluence=false`)
 * scaled by the linear blendin/blendout ramps when inside them.
 *
 * @param {FModifier} mod
 * @param {number} evaltime
 * @returns {number} 0..1
 */
export function computeFModifierInfluence(mod, evaltime) {
  if (!mod) return 0;
  const influence = mod.useInfluence === true ? (Number.isFinite(mod.influence) ? mod.influence : 0) : 1;
  if (mod.useRestrictedRange !== true) return influence;
  const sfra = Number.isFinite(mod.sfra) ? mod.sfra : 0;
  const efra = Number.isFinite(mod.efra) ? mod.efra : 0;
  if (evaltime < sfra || evaltime > efra) return 0;
  const blendin = Number.isFinite(mod.blendin) ? mod.blendin : 0;
  const blendout = Number.isFinite(mod.blendout) ? mod.blendout : 0;
  if (blendin !== 0 && evaltime >= sfra && evaltime <= sfra + blendin) {
    // Linear fade-in: at evaltime=sfra -> 0; at evaltime=sfra+blendin -> influence.
    // Matches `fmodifier.cc:1472-1474`: `influence * (evaltime - a) / (b - a)`
    // with a=sfra, b=sfra+blendin.
    return influence * (evaltime - sfra) / blendin;
  }
  if (blendout !== 0 && evaltime <= efra && evaltime >= efra - blendout) {
    // Linear fade-out: at evaltime=efra-blendout -> influence; at evaltime=efra -> 0.
    // Matches `fmodifier.cc:1480-1482`: `influence * (evaltime - a) / (b - a)`
    // with a=efra, b=efra-blendout. The fraction is NEGATIVE; b-a is also
    // negative; the ratio is positive and goes from 1 at b to 0 at a.
    return influence * (evaltime - efra) / (-blendout);
  }
  return influence;
}

/**
 * Blender's `interpf(a, b, t)` helper: `a*t + b*(1-t)`. Used for the
 * influence blend at `fmodifier.cc:1540` (time) and `:1590` (value).
 *
 * @param {number} a -- new value (modifier output)
 * @param {number} b -- original value (modifier input)
 * @param {number} t -- influence 0..1
 * @returns {number}
 */
function interpf(a, b, t) {
  return a * t + b * (1 - t);
}

// ---------------------------------------------------------------------------
// Disabled / muted gate
// ---------------------------------------------------------------------------

/**
 * Returns true when the modifier should be skipped at eval time. Mirrors
 * the gate at `fmodifier.cc:1533` and `:1582`:
 * `(fcm->flag & (FMODIFIER_FLAG_DISABLED | FMODIFIER_FLAG_MUTED)) == 0`.
 *
 * @param {FModifier} mod
 * @returns {boolean}
 */
function isModifierSkipped(mod) {
  if (!mod) return true;
  if (mod.disabled === true) return true;
  if (mod.muted === true) return true;
  return false;
}

/**
 * Returns true when the modifier's restricted range excludes evaltime
 * entirely (early-out before influence calc). Mirrors `fmodifier.cc:1528`
 * + `:1578`: `if RANGERESTRICT then sfra <= evaltime <= efra`.
 *
 * @param {FModifier} mod
 * @param {number} evaltime
 * @returns {boolean}
 */
function isOutsideRestrictedRange(mod, evaltime) {
  if (mod.useRestrictedRange !== true) return false;
  const sfra = Number.isFinite(mod.sfra) ? mod.sfra : 0;
  const efra = Number.isFinite(mod.efra) ? mod.efra : 0;
  return evaltime < sfra || evaltime > efra;
}

// ---------------------------------------------------------------------------
// Per-type time evaluators
// ---------------------------------------------------------------------------

/**
 * Cycles -- time pass. Ports `fcm_cycles_time` at `fmodifier.cc:620-768`.
 *
 * Computes the cyclic remapping of `evaltime` based on the FCurve's first
 * and last keyframe times, and (for the 'repeat_offset' / CYCLIC_OFFSET
 * mode) writes the per-cycle Y-offset to `scratch.cycyofs` so the value
 * pass can apply it.
 *
 * Returns the new evaltime; if the modifier doesn't apply (in-range,
 * cycles exhausted, or no keyframes), returns `evaltime` unchanged.
 *
 * @param {FModifier} mod
 * @param {{ keyforms?: { time: number, value: number }[] } | null | undefined} fcurve
 * @param {number} evaltime
 * @param {{ cycyofs?: number }} scratch -- mutated in place
 * @returns {number}
 */
export function evaluateCyclesTime(mod, fcurve, evaltime, scratch) {
  scratch.cycyofs = 0;
  if (!fcurve || !Array.isArray(fcurve.keyforms) || fcurve.keyforms.length === 0) {
    return evaltime;
  }
  const data = /** @type {FModCyclesData} */ (mod.data || {});
  const keyforms = fcurve.keyforms;
  const firstKey = keyforms[0];
  const lastKey = keyforms[keyforms.length - 1];
  const firstX = firstKey.time;
  const firstY = firstKey.value;
  const lastX = lastKey.time;
  const lastY = lastKey.value;

  let side = 0;
  let mode = 'none';
  let cycles = 0;
  let ofs = 0;
  if (evaltime < firstX) {
    if (data.before && data.before !== 'none') {
      side = -1;
      mode = data.before;
      cycles = Number.isFinite(data.beforeCycles) ? data.beforeCycles : 0;
      ofs = firstX;
    }
  } else if (evaltime > lastX) {
    if (data.after && data.after !== 'none') {
      side = 1;
      mode = data.after;
      cycles = Number.isFinite(data.afterCycles) ? data.afterCycles : 0;
      ofs = lastX;
    }
  }
  if (side === 0 || mode === 'none') return evaltime;

  const cycdx = lastX - firstX;
  const cycdy = lastY - firstY;
  if (cycdx === 0) return evaltime;

  // Cycle count + remainder. Per `fmodifier.cc:702-704`, `cycle` uses
  // double precision to avoid the precision drift bug #119360 where
  // single-precision `cycle` could jump to the next integer while `cyct`
  // is still behind.
  const cycle = side * (evaltime - ofs) / cycdx;
  const cyct = ((evaltime - ofs) % cycdx + cycdx) % cycdx; // JS-safe positive modulo

  if (cycles !== 0 && cycle > cycles) return evaltime;

  let cycyofs = 0;
  if (mode === 'repeat_offset') {
    // `fmodifier.cc:719-727`: floor for side<0, ceil for side>0; times cycdy.
    cycyofs = side < 0 ? Math.floor((evaltime - ofs) / cycdx) : Math.ceil((evaltime - ofs) / cycdx);
    cycyofs *= cycdy;
  }

  let newEvaltime;
  if (cyct === 0) {
    // At a cycle boundary -- use the appropriate endpoint
    // (`fmodifier.cc:730-737`).
    newEvaltime = side === 1 ? lastX : firstX;
    if (mode === 'mirror' && (Math.floor(cycle) % 2) !== 0) {
      newEvaltime = side === 1 ? firstX : lastX;
    }
  } else if (mode === 'mirror' && (Math.floor(cycle + 1) % 2) !== 0) {
    // Odd cycle in mirror mode -- play this cycle in reverse
    // (`fmodifier.cc:739-751`).
    newEvaltime = side < 0 ? firstX - cyct : lastX - cyct;
  } else {
    newEvaltime = firstX + cyct;
  }
  if (newEvaltime < firstX) newEvaltime += cycdx;

  scratch.cycyofs = cycyofs;
  return newEvaltime;
}

/**
 * Limits -- time pass. Ports `fcm_limits_time` at `fmodifier.cc:887-905`.
 *
 * Clamps `evaltime` to `[minX, maxX]` when the X-axis use flags are set.
 *
 * @param {FModifier} mod
 * @param {number} evaltime
 * @returns {number}
 */
export function evaluateLimitsTime(mod, evaltime) {
  const data = /** @type {FModLimitsData} */ (mod.data || {});
  if (data.useMinX === true && Number.isFinite(data.minX) && evaltime < data.minX) {
    return data.minX;
  }
  if (data.useMaxX === true && Number.isFinite(data.maxX) && evaltime > data.maxX) {
    return data.maxX;
  }
  return evaltime;
}

/**
 * Stepped -- time pass. Ports `fcm_stepped_time` at `fmodifier.cc:951-982`.
 *
 * Snaps `evaltime` down to the nearest step boundary (`stepSize` ms apart,
 * offset by `offset` ms). When the optional `useStartTime`/`useEndTime`
 * gates exclude the eval position, returns the original evaltime
 * unchanged.
 *
 * Note: SS positive-sense `useStartTime`/`useEndTime` semantically equals
 * Blender's negative-sense `FCM_STEPPED_NO_BEFORE`/`_NO_AFTER` -- see the
 * typedef block above for the bit-flip rationale.
 *
 * @param {FModifier} mod
 * @param {number} evaltime
 * @returns {number}
 */
export function evaluateSteppedTime(mod, evaltime) {
  const data = /** @type {FModSteppedData} */ (mod.data || {});
  if (data.useStartTime === true && Number.isFinite(data.startTime) && evaltime < data.startTime) {
    return evaltime;
  }
  if (data.useEndTime === true && Number.isFinite(data.endTime) && evaltime > data.endTime) {
    return evaltime;
  }
  const stepSize = Number.isFinite(data.stepSize) && data.stepSize > 0 ? data.stepSize : 2;
  const offset = Number.isFinite(data.offset) ? data.offset : 0;
  // Truncation toward zero (matches Blender's C `int()` cast at
  // `fmodifier.cc:976`). For `(evaltime - offset) / stepSize` negative
  // (i.e. evaluating before the offset), `Math.floor` rounds toward
  // -infinity and produces a snap one step below Blender; `Math.trunc`
  // rounds toward zero and matches Blender's behavior exactly.
  // Audit-fix 2026-05-18 (3.B HIGH-1).
  const snapblock = Math.trunc((evaltime - offset) / stepSize);
  return snapblock * stepSize + offset;
}

// ---------------------------------------------------------------------------
// Per-type value evaluators
// ---------------------------------------------------------------------------

/**
 * Cycles -- value pass. Ports `fcm_cycles_evaluate` at
 * `fmodifier.cc:770-778`. Adds the per-cycle Y-offset computed in the
 * time pass.
 *
 * @param {number} cvalue
 * @param {{ cycyofs?: number }} scratch
 * @returns {number}
 */
export function evaluateCyclesValue(cvalue, scratch) {
  return cvalue + (Number.isFinite(scratch.cycyofs) ? scratch.cycyofs : 0);
}

/**
 * Noise -- value pass. Ports `fcm_noise_evaluate` at `fmodifier.cc:814-867`
 * (modern Perlin path; legacy BLI_noise turbulence path not ported).
 *
 * @param {FModifier} mod
 * @param {number} cvalue
 * @param {number} evaltime
 * @returns {number}
 */
export function evaluateNoiseValue(mod, cvalue, evaltime) {
  const data = /** @type {FModNoiseData} */ (mod.data || {});
  const size = Number.isFinite(data.size) ? data.size : 1000;
  const strength = Number.isFinite(data.strength) ? data.strength : 1;
  const phase = Number.isFinite(data.phase) ? data.phase : 1;
  const offset = Number.isFinite(data.offset) ? data.offset : 0;
  const depth = Number.isFinite(data.depth) ? data.depth : 0;
  const lacunarity = Number.isFinite(data.lacunarity) ? data.lacunarity : 2;
  const roughness = Number.isFinite(data.roughness) ? data.roughness : 0.5;
  const scale = size === 0 ? 0 : 1 / size;
  // 0.61803398874 is Blender's golden-ratio time offset
  // (`fmodifier.cc:840`) used to keep t=0 off Perlin's origin.
  const GOLDEN = 0.61803398874;
  const x = (evaltime - offset) * scale + GOLDEN;
  const noise = perlinFbm2D(x, phase, depth, roughness, lacunarity);
  const blend = data.blendType || 'replace';
  switch (blend) {
    case 'add':
      return cvalue + noise * strength;
    case 'subtract':
      return cvalue - noise * strength;
    case 'multiply':
      return cvalue * noise * strength;
    case 'replace':
    default:
      // Matches `fmodifier.cc:864`: `*cvalue = *cvalue + (noise - 0.5f) * strength`.
      // Despite the name "REPLACE", the actual implementation ADDS a
      // centred noise (subtracting 0.5 brings the mean from ~0.5 to ~0).
      return cvalue + (noise - 0.5) * strength;
  }
}

/**
 * Generator -- value pass. Ports `fcm_generator_evaluate` at
 * `fmodifier.cc:157-232`.
 *
 * Two modes:
 *   - `'polynomial'` -- `c0 + c1*x + c2*x^2 + ...`
 *   - `'polynomial_factorised'` -- `(c0*x + c1) * (c2*x + c3) * ...`
 *     (each pair `[a, b]` is `a*x + b`; matches `cp[0]*evaltime + cp[1]`
 *     at `fmodifier.cc:217`)
 *
 * The `additive` flag selects between replace (`cvalue = generated`) and
 * additive (`cvalue += generated`) blend; mirrors
 * `fmodifier.cc:194-201` + `:221-228`.
 *
 * # SS simplification: poly_order is derived
 *
 * Blender's `FMod_Generator` carries an explicit `poly_order: int`
 * (`DNA_anim_types.h:86`) that gates writes at `fmodifier.cc:194` -- if
 * `poly_order == 0`, the write is skipped and the modifier is a no-op
 * regardless of coefficients. SS derives polynomial degree from
 * `coefficients.length` directly (poly mode: degree = length-1;
 * factorised mode: degree = floor(length/2)). The Blender edge case of
 * `poly_order = 0 with non-empty coefficients` cannot be expressed in
 * the SS data model -- documented as an intentional SS simplification
 * (3.B fidelity audit MED-3). Empty coefficients DO short-circuit to
 * `cvalue` unchanged, matching Blender's "no write" behavior.
 *
 * @param {FModifier} mod
 * @param {number} cvalue
 * @param {number} evaltime
 * @returns {number}
 */
export function evaluateGeneratorValue(mod, cvalue, evaltime) {
  const data = /** @type {FModGeneratorData} */ (mod.data || {});
  const coefficients = Array.isArray(data.coefficients) ? data.coefficients : [];
  if (coefficients.length === 0) return cvalue;
  const mode = data.mode || 'polynomial';
  let value;
  if (mode === 'polynomial_factorised') {
    value = 1;
    // Iterate pairs; ignore any trailing unpaired coefficient
    // (matches Blender's `poly_order` cap).
    for (let i = 0; i + 1 < coefficients.length; i += 2) {
      value *= coefficients[i] * evaltime + coefficients[i + 1];
    }
  } else {
    // polynomial: sum c[i] * x^i, with powers[0]=1 per `fmodifier.cc:184`.
    value = 0;
    let pow = 1;
    for (let i = 0; i < coefficients.length; i++) {
      value += coefficients[i] * pow;
      pow *= evaltime;
    }
  }
  return data.additive === true ? cvalue + value : value;
}

/**
 * Limits -- value pass. Ports `fcm_limits_evaluate` at
 * `fmodifier.cc:907-922`. Clamps `cvalue` to `[minY, maxY]` when the
 * Y-axis use flags are set.
 *
 * @param {FModifier} mod
 * @param {number} cvalue
 * @returns {number}
 */
export function evaluateLimitsValue(mod, cvalue) {
  const data = /** @type {FModLimitsData} */ (mod.data || {});
  let v = cvalue;
  if (data.useMinY === true && Number.isFinite(data.minY) && v < data.minY) v = data.minY;
  if (data.useMaxY === true && Number.isFinite(data.maxY) && v > data.maxY) v = data.maxY;
  return v;
}

/**
 * Envelope -- value pass. Ports `fcm_envelope_evaluate` at
 * `fmodifier.cc:425-481`.
 *
 * Linearly interpolates per-time `(min, max)` from the sorted control
 * points (clamped to first/last outside the range). Then remaps `cvalue`
 * from the reference range `[referenceValue + defaultMin, referenceValue
 * + defaultMax]` into the per-time `[min, max]` range:
 *
 *   `fac = (cvalue - (referenceValue + defaultMin)) / (defaultMax - defaultMin)`
 *   `output = min + fac * (max - min)`
 *
 * Matches `fmodifier.cc:479-480`.
 *
 * @param {FModifier} mod
 * @param {number} cvalue
 * @param {number} evaltime
 * @returns {number}
 */
export function evaluateEnvelopeValue(mod, cvalue, evaltime) {
  const data = /** @type {FModEnvelopeData} */ (mod.data || {});
  const points = Array.isArray(data.controlPoints) ? data.controlPoints : [];
  if (points.length === 0) return cvalue;
  const referenceValue = Number.isFinite(data.referenceValue) ? data.referenceValue : 0;
  const defaultMin = Number.isFinite(data.defaultMin) ? data.defaultMin : 0;
  const defaultMax = Number.isFinite(data.defaultMax) ? data.defaultMax : 0;
  const span = defaultMax - defaultMin;
  if (span === 0) return cvalue;

  let min;
  let max;
  if (points[0].time >= evaltime) {
    min = points[0].min;
    max = points[0].max;
  } else if (points[points.length - 1].time <= evaltime) {
    min = points[points.length - 1].min;
    max = points[points.length - 1].max;
  } else {
    min = points[0].min;
    max = points[0].max;
    for (let a = 0; a < points.length - 1; a++) {
      const prev = points[a];
      const next = points[a + 1];
      if (prev.time <= evaltime && next.time >= evaltime) {
        const diff = next.time - prev.time;
        if (diff === 0) {
          min = prev.min;
          max = prev.max;
        } else {
          const afac = (evaltime - prev.time) / diff;
          const bfac = (next.time - evaltime) / diff;
          min = bfac * prev.min + afac * next.min;
          max = bfac * prev.max + afac * next.max;
        }
        break;
      }
    }
  }
  const fac = (cvalue - (referenceValue + defaultMin)) / span;
  return min + fac * (max - min);
}

// ---------------------------------------------------------------------------
// Two-pass dispatcher
// ---------------------------------------------------------------------------

/**
 * Time-modifying pass. Walks the modifier stack in REVERSE (last index
 * --> first index) per `fmodifier.cc:1515-1517` and composes each
 * time-affecting modifier's `effective_time` transformation.
 *
 * Cycles + Limits + Stepped contribute; Noise + Generator + Envelope are
 * value-only and skipped here.
 *
 * Returns `{ effectiveTime, scratch }`. The scratch array is indexed by
 * modifier array position (positional storage, mirroring Blender's
 * `POINTER_OFFSET(storage->buffer, fcm_index * size_per_modifier)` at
 * `fmodifier.cc:1534-1536`) and carries per-modifier state that the
 * value pass needs to consume (today only Cycles' `cycyofs`).
 *
 * # Audit-fix 2026-05-18 (3.B HIGH-2)
 *
 * Both gates (loop-level `isOutsideRestrictedRange` and influence
 * `computeFModifierInfluence`) read the ORIGINAL `evaltime`, not the
 * running warped `t`. Blender's `evaluate_time_fmodifiers` at
 * `fmodifier.cc:1528-1530` checks against the function-parameter
 * `evaltime` (not the mutated accumulator); the influence call at
 * `:1539` also receives the original. SS port now matches.
 *
 * # Audit-fix 2026-05-18 (3.B MED-1)
 *
 * Scratch is now an array indexed by modifier position (was a Map keyed
 * by `mod.id` which silently dropped state when id was missing -- a
 * Rule №1 crutch). The array shape also better matches Blender's
 * positional `storage->buffer` indexed by `fcm_index`.
 *
 * @param {FModifier[]} modifiers
 * @param {{ keyforms?: { time: number, value: number }[] } | null | undefined} fcurve
 * @param {number} evaltime
 * @returns {{ effectiveTime: number, scratch: ({ cycyofs?: number } | null)[] }}
 */
export function evaluateTimeModifiers(modifiers, fcurve, evaltime) {
  if (!Array.isArray(modifiers) || modifiers.length === 0) {
    return { effectiveTime: evaltime, scratch: [] };
  }
  const scratch = new Array(modifiers.length).fill(null);
  let t = evaltime;
  // REVERSE walk (`fmodifier.cc:1515-1517`): start at last, step via prev.
  for (let i = modifiers.length - 1; i >= 0; i--) {
    const mod = modifiers[i];
    if (!mod || isModifierSkipped(mod)) continue;
    // Range gate against ORIGINAL evaltime per `fmodifier.cc:1528-1530`,
    // not against the running warped `t`. Audit-fix 3.B HIGH-2.
    if (isOutsideRestrictedRange(mod, evaltime)) continue;
    let nval = t;
    let touched = false;
    switch (mod.type) {
      case 'cycles': {
        const s = { cycyofs: 0 };
        nval = evaluateCyclesTime(mod, fcurve, t, s);
        scratch[i] = s;
        touched = true;
        break;
      }
      case 'limits':
        nval = evaluateLimitsTime(mod, t);
        touched = true;
        break;
      case 'stepped':
        nval = evaluateSteppedTime(mod, t);
        touched = true;
        break;
      default:
        // value-only modifier: no contribution to time pass
        continue;
    }
    if (!touched) continue;
    // Influence also reads ORIGINAL evaltime per `fmodifier.cc:1539`.
    // Audit-fix 3.B HIGH-2.
    const influence = computeFModifierInfluence(mod, evaltime);
    // `fmodifier.cc:1540`: evaltime = interpf(nval, evaltime, influence)
    t = interpf(nval, t, influence);
  }
  return { effectiveTime: t, scratch };
}

/**
 * Value-modifying pass. Walks the modifier stack in FORWARD order
 * (first --> last) per `fmodifier.cc:1568-1569` and composes each
 * value-affecting modifier's `effective_value` transformation.
 *
 * Cycles + Noise + Generator + Limits + Envelope contribute; Stepped is
 * time-only and skipped here.
 *
 * @param {FModifier[]} modifiers
 * @param {{ keyforms?: { time: number, value: number }[] } | null | undefined} fcurve
 * @param {number} cvalue -- sampled keyframe value
 * @param {number} evaltime
 * @param {({ cycyofs?: number } | null)[] | null | undefined} scratch -- output
 *   from `evaluateTimeModifiers`; indexed by modifier array position
 * @returns {number}
 */
export function evaluateValueModifiers(modifiers, fcurve, cvalue, evaltime, scratch) {
  if (!Array.isArray(modifiers) || modifiers.length === 0) return cvalue;
  let v = cvalue;
  // FORWARD walk (`fmodifier.cc:1568-1569`).
  for (let i = 0; i < modifiers.length; i++) {
    const mod = modifiers[i];
    if (!mod || isModifierSkipped(mod)) continue;
    if (isOutsideRestrictedRange(mod, evaltime)) continue;
    let nval = v;
    let touched = false;
    switch (mod.type) {
      case 'cycles': {
        const s = (Array.isArray(scratch) && scratch[i]) || { cycyofs: 0 };
        nval = evaluateCyclesValue(v, s);
        touched = true;
        break;
      }
      case 'noise':
        nval = evaluateNoiseValue(mod, v, evaltime);
        touched = true;
        break;
      case 'generator':
        nval = evaluateGeneratorValue(mod, v, evaltime);
        touched = true;
        break;
      case 'limits':
        nval = evaluateLimitsValue(mod, v);
        touched = true;
        break;
      case 'envelope':
        nval = evaluateEnvelopeValue(mod, v, evaltime);
        touched = true;
        break;
      default:
        // time-only modifier (stepped): no contribution to value pass
        continue;
    }
    if (!touched) continue;
    const influence = computeFModifierInfluence(mod, evaltime);
    // `fmodifier.cc:1590`: *cvalue = interpf(nval, *cvalue, influence)
    v = interpf(nval, v, influence);
  }
  return v;
}

/**
 * Combined two-pass entry point. Computes `effectiveTime` via the
 * reverse-walk time pass, lets the caller sample keyframes at that time,
 * then computes `effectiveValue` via the forward-walk value pass.
 *
 * Callers that already have the keyframe sampler inline (like
 * `evaluateFCurve`) should call `evaluateTimeModifiers` +
 * `evaluateValueModifiers` directly. This helper is for self-contained
 * eval where the sampler is a plain function `(fcurve, time) => value`.
 *
 * @param {FModifier[]} modifiers
 * @param {{ keyforms?: { time: number, value: number }[] } | null | undefined} fcurve
 * @param {(fcurve: any, time: number) => number} sampleAt
 * @param {number} evaltime
 * @returns {number}
 */
export function evaluateFModifierStack(modifiers, fcurve, sampleAt, evaltime) {
  const { effectiveTime, scratch } = evaluateTimeModifiers(modifiers, fcurve, evaltime);
  const cvalue = sampleAt(fcurve, effectiveTime);
  return evaluateValueModifiers(modifiers, fcurve, cvalue, effectiveTime, scratch);
}
