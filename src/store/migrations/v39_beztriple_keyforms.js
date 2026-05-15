// @ts-check

/**
 * v39 — Animation Phase 2.A: BezTriple keyform shape.
 *
 * The legacy keyform shape `{ time, value, type?, easing? }` is replaced
 * with Blender's `BezTriple`-shape record. After v39 every keyform
 * carries:
 *
 *   {
 *     time, value,
 *     handleLeft:  { time, value },
 *     handleRight: { time, value },
 *     handleType:  { left, right },              // 'free' | 'aligned' | 'vector' | 'auto' | 'auto_clamped'
 *     interpolation: 'constant' | 'linear' | 'bezier' |
 *                    'sine' | 'quad' | 'cubic' | 'quart' | 'quint' | 'expo' |
 *                    'circ' | 'back' | 'bounce' | 'elastic',
 *     easeMode?: 'auto' | 'in' | 'out' | 'inout',
 *     autoHandleType?: 'normal' | 'locked_final',
 *     flag: number
 *   }
 *
 * Reference: `reference/blender/source/blender/makesdna/DNA_curve_types.h:83-117`
 * (`BezTriple`) + `DNA_curve_enums.h:180-225` (interpolation + handle enums).
 *
 * # Why a migration (Rule №2)
 *
 * Previous keyform shape carried an enum-string `easing` plus a separate
 * `type` discriminator (`'linear'|'constant'|'bezier'`). Two evaluators
 * existed (`evaluateFCurve` reading `type`, `interpolateTrack` reading
 * `easing`) and they were quietly inconsistent. Phase 2.A converges both
 * evaluators on the single `interpolation` field, drops `type` and
 * `easing` entirely, and adds the BezTriple handle slots so Phase 2.C +
 * 2.D can layer real cubic-bezier eval + auto-handle calc on top.
 *
 * # Mapping (per ANIMATION_BLENDER_PARITY_PLAN.md §Phase 2.B)
 *
 *   legacy.type === 'constant'       → interpolation = 'constant', handles vector/vector
 *   legacy.easing ∈ {constant,hold,
 *                    stepped,
 *                    inverse-stepped} → interpolation = 'constant', handles vector/vector
 *   legacy.type === 'bezier'         → interpolation = 'bezier',  handles auto/auto
 *   legacy.easing ∈ {ease,ease-both,
 *                    ease-in-out}     → interpolation = 'bezier',  handles auto/auto
 *   legacy.easing === 'ease-in'      → interpolation = 'bezier',  handles free/auto
 *                                        (handle vectors derived in Slice 2.D auto-handle calc)
 *   legacy.easing === 'ease-out'     → interpolation = 'bezier',  handles auto/free
 *   legacy.easing === [c1,c2,c3,c4]  → interpolation = 'bezier',  handles free/free
 *                                        with handles derived from cubic-bezier control points
 *   anything else                     → interpolation = 'linear',  handles vector/vector
 *
 * Default handles are placed at the keyform position itself (zero-length
 * vector). Slice 2.D's auto-handle calculator fills proper positions on
 * first eval.
 *
 * # Idempotency
 *
 * A keyform that ALREADY has `interpolation` set (i.e. v39+ shape) is
 * left untouched — useful for projects whose v39 migration already ran
 * once and partially saved (e.g. user closed mid-save).
 *
 * @module store/migrations/v39_beztriple_keyforms
 */

const HOLD_EASINGS = new Set(['constant', 'hold', 'stepped', 'inverse-stepped']);
const BEZIER_EASING_NAMES = new Set(['ease', 'ease-both', 'ease-in-out', 'ease-in', 'ease-out', 'bezier']);

/**
 * Map a legacy `easing` value (string OR `[c1,c2,c3,c4]` cubic-bezier
 * coefficient array) plus an optional legacy `type` string to a
 * Phase 2.A `{interpolation, handleType}` pair.
 *
 * @param {string|number[]|undefined} legacyEasing
 * @param {string|undefined} legacyType
 * @returns {{
 *   interpolation: 'constant'|'linear'|'bezier',
 *   handleType: { left: string, right: string }
 * }}
 */
function legacyToBezTripleShape(legacyEasing, legacyType) {
  if (legacyType === 'constant' || (typeof legacyEasing === 'string' && HOLD_EASINGS.has(legacyEasing))) {
    return { interpolation: 'constant', handleType: { left: 'vector', right: 'vector' } };
  }
  if (Array.isArray(legacyEasing) && legacyEasing.length === 4) {
    return { interpolation: 'bezier', handleType: { left: 'free', right: 'free' } };
  }
  if (legacyType === 'bezier' || (typeof legacyEasing === 'string' && BEZIER_EASING_NAMES.has(legacyEasing))) {
    if (legacyEasing === 'ease-in') {
      return { interpolation: 'bezier', handleType: { left: 'free', right: 'auto' } };
    }
    if (legacyEasing === 'ease-out') {
      return { interpolation: 'bezier', handleType: { left: 'auto', right: 'free' } };
    }
    return { interpolation: 'bezier', handleType: { left: 'auto', right: 'auto' } };
  }
  return { interpolation: 'linear', handleType: { left: 'vector', right: 'vector' } };
}

/**
 * Convert a single legacy keyform record to BezTriple shape. Returns the
 * input unchanged if it already has `interpolation` (idempotency).
 *
 * @param {*} kf
 * @returns {*}
 */
function migrateKeyform(kf) {
  if (!kf || typeof kf !== 'object') return kf;
  if (typeof kf.time !== 'number' || typeof kf.value !== 'number') return kf;
  if (typeof kf.interpolation === 'string') return kf;

  const { interpolation, handleType } = legacyToBezTripleShape(kf.easing, kf.type);

  // Default handle vectors at the keyform position (zero-length).
  // For 'auto'/'auto_clamped' handles this is a placeholder — Slice 2.D's
  // auto-handle calculator computes proper neighbour-aware vectors on
  // first eval. For 'vector' handles the position is irrelevant (vector
  // handles produce straight-line segments regardless).
  // For [c1,c2,c3,c4]-derived `free/free` handles we encode the cubic-
  // bezier control points so Slice 2.G's exporter can recover the
  // original Cubism-style segment.
  let handleLeft  = { time: kf.time, value: kf.value };
  let handleRight = { time: kf.time, value: kf.value };
  if (Array.isArray(kf.easing) && kf.easing.length === 4) {
    // Cubic-bezier coefficients are unit-square parameters [0..1, 0..1]
    // by convention; without segment context (prev/next keyform) here we
    // can't yet project them onto the actual time/value range. Stash them
    // raw on the right-handle so Slice 2.D / 2.G can resolve.
    handleRight = { time: kf.easing[0], value: kf.easing[1] };
    handleLeft  = { time: kf.easing[2], value: kf.easing[3] };
  }

  /** @type {Record<string, unknown>} */
  const out = {
    time: kf.time,
    value: kf.value,
    handleLeft,
    handleRight,
    handleType,
    interpolation,
    flag: 0,
  };
  return out;
}

/**
 * Walk every action's fcurves and migrate every keyform in-place.
 *
 * @param {*} project
 * @returns {*} the same project (mutated)
 */
export function migrateBezTripleKeyforms(project) {
  if (!project || typeof project !== 'object') return project;
  const actions = Array.isArray(project.actions) ? project.actions : [];
  for (const action of actions) {
    if (!action || !Array.isArray(action.fcurves)) continue;
    for (const fc of action.fcurves) {
      if (!fc || !Array.isArray(fc.keyforms)) continue;
      for (let i = 0; i < fc.keyforms.length; i++) {
        fc.keyforms[i] = migrateKeyform(fc.keyforms[i]);
      }
    }
  }
  return project;
}
