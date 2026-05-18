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
 * @typedef {Object} FModNoiseData
 * @property {number} [size] -- wavelength in ms; sparse, default = 1000
 * @property {number} [strength] -- amplitude in value-units; sparse,
 *   default = 1
 * @property {number} [phase] -- time offset in ms; sparse, default = 0
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
 * `'polynomial'` evaluates as `c0 + c1*x + c2*x^2 + ...`.
 * `'polynomial_factorised'` evaluates as
 *   `(c0 + c1*x) * (c2 + c3*x) * (c4 + c5*x) * ...`.
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
 *   field. For `'polynomial'`: `[c0, c1, c2, ...]`. For
 *   `'polynomial_factorised'`: pairs `[c0, c1, c2, c3, ...]` group as
 *   `(c0 + c1*x) * (c2 + c3*x) * ...` so length should be even
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
 * Read the modifier list off an FCurve. Returns `[]` for missing /
 * non-array `modifiers` so callers can iterate unconditionally.
 *
 * @param {{ modifiers?: FModifier[] } | null | undefined} fcurve
 * @returns {FModifier[]}
 */
export function getFCurveModifiers(fcurve) {
  if (!fcurve || !Array.isArray(fcurve.modifiers)) return EMPTY_MODIFIERS;
  return fcurve.modifiers;
}

/** @type {FModifier[]} */
const EMPTY_MODIFIERS = Object.freeze(/** @type {any} */ ([]));
