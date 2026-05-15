// @ts-check

/**
 * BezTriple FCurve segment evaluator — Slice 2.C of Animation Phase 2.
 *
 * Byte-faithful port of Blender's `fcurve_eval_keyframes_interpolate`
 * (`reference/blender/source/blender/blenkernel/intern/fcurve.cc:2026`)
 * + the 30 easing functions (10 types × {in/out/inout}) from
 * `reference/blender/source/blender/blenlib/intern/easing.cc`.
 *
 * Evaluator dispatch (per `prevbezt->ipo` = the START keyform's
 * `interpolation` field):
 *
 *   constant   → hold prev.value
 *   linear     → linear lerp
 *   bezier     → cubic-bezier from prev.handleRight + next.handleLeft;
 *                inversion via Cardano's cubic root finder + de Casteljau
 *   <named>    → Robert Penner's easing curves; default easeMode varies
 *                per type (see DEFAULT_EASE_MODE below)
 *
 * The shared module exists so BOTH `evaluateFCurve` (depgraph path,
 * scalar-valued) and `interpolateTrack` (animationEngine path; also
 * called by mesh_verts via `interpolateMeshVerts`) hit the same
 * evaluator. Pre-Slice-2.C they diverged: `evaluateFCurve` honored
 * `type` for constant/lerp only, `interpolateTrack` honored `easing`
 * for ease-presets only. Slice 2.A converged the field name; Slice
 * 2.C converges the implementation.
 *
 * @module anim/fcurveEval
 */

// ─────────────────────────────────────────────────────────────────────────
//  Constants — match Blender's fcurve.cc / easing.cc exactly.
// ─────────────────────────────────────────────────────────────────────────

const SMALL = -1.0e-10;
const M_PI = Math.PI;
const M_PI_2 = Math.PI / 2;

/**
 * Default `easeMode` per interpolation type. Matches Blender's switch
 * statements in `fcurve_eval_keyframes_interpolate` — each named easing
 * has a Blender-chosen "auto" default (some prefer ease_in, some
 * ease_out; the choice is curated for visually-pleasing fall-through).
 *
 * Reference: fcurve.cc:2151 (BACK), :2165 (BOUNCE), :2179 (CIRC),
 * :2193 (CUBIC), :2207 (ELASTIC), :2221 (EXPO), :2235 (QUAD), :2249
 * (QUART), :2263 (QUINT), :2277 (SINE).
 */
const DEFAULT_EASE_MODE = {
  back:    'out',
  bounce:  'out',
  circ:    'in',
  cubic:   'in',
  elastic: 'out',
  expo:    'in',
  quad:    'in',
  quart:   'in',
  quint:   'in',
  sine:    'in',
};

/** Blender BezTriple BACK overshoot default (`bezt->back` field). */
const DEFAULT_BACK_OVERSHOOT = 1.70158;
/** Blender BezTriple ELASTIC amplitude default (`bezt->amplitude`). */
const DEFAULT_ELASTIC_AMPLITUDE = 0;
/** Blender BezTriple ELASTIC period default (`bezt->period`). */
const DEFAULT_ELASTIC_PERIOD = 0;

/** EXPO easing magic constants (easing.cc:254-255). */
const EXPO_POW_MIN = 0.0009765625;            // 2^(-10)
const EXPO_POW_SCALE = 1.0 / (1.0 - EXPO_POW_MIN);

// ─────────────────────────────────────────────────────────────────────────
//  Easing functions — 30 of them. Robert Penner / Blender easing.cc port.
//  Signature matches Blender: (time, begin, change, duration[, extras])
//  → returns the evaluated value.
// ─────────────────────────────────────────────────────────────────────────

function back_in(time, begin, change, duration, overshoot) {
  const t = time / duration;
  return change * t * t * ((overshoot + 1) * t - overshoot) + begin;
}
function back_out(time, begin, change, duration, overshoot) {
  const t = time / duration - 1;
  return change * (t * t * ((overshoot + 1) * t + overshoot) + 1) + begin;
}
function back_inout(time, begin, change, duration, overshoot) {
  overshoot *= 1.525;
  let t = time / (duration / 2);
  if (t < 1.0) {
    return change / 2 * (t * t * ((overshoot + 1) * t - overshoot)) + begin;
  }
  t -= 2.0;
  return change / 2 * (t * t * ((overshoot + 1) * t + overshoot) + 2) + begin;
}

function bounce_out(time, begin, change, duration) {
  let t = time / duration;
  if (t < (1 / 2.75)) {
    return change * (7.5625 * t * t) + begin;
  }
  if (t < (2 / 2.75)) {
    t -= (1.5 / 2.75);
    return change * ((7.5625 * t) * t + 0.75) + begin;
  }
  if (t < (2.5 / 2.75)) {
    t -= (2.25 / 2.75);
    return change * ((7.5625 * t) * t + 0.9375) + begin;
  }
  t -= (2.625 / 2.75);
  return change * ((7.5625 * t) * t + 0.984375) + begin;
}
function bounce_in(time, begin, change, duration) {
  return change - bounce_out(duration - time, 0, change, duration) + begin;
}
function bounce_inout(time, begin, change, duration) {
  if (time < duration / 2) {
    return bounce_in(time * 2, 0, change, duration) * 0.5 + begin;
  }
  return bounce_out(time * 2 - duration, 0, change, duration) * 0.5 + change * 0.5 + begin;
}

function circ_in(time, begin, change, duration) {
  const t = time / duration;
  return -change * (Math.sqrt(1 - t * t) - 1) + begin;
}
function circ_out(time, begin, change, duration) {
  const t = time / duration - 1;
  return change * Math.sqrt(1 - t * t) + begin;
}
function circ_inout(time, begin, change, duration) {
  let t = time / (duration / 2);
  if (t < 1.0) {
    return -change / 2 * (Math.sqrt(1 - t * t) - 1) + begin;
  }
  t -= 2.0;
  return change / 2 * (Math.sqrt(1 - t * t) + 1) + begin;
}

function cubic_in(time, begin, change, duration) {
  const t = time / duration;
  return change * t * t * t + begin;
}
function cubic_out(time, begin, change, duration) {
  const t = time / duration - 1;
  return change * (t * t * t + 1) + begin;
}
function cubic_inout(time, begin, change, duration) {
  let t = time / (duration / 2);
  if (t < 1.0) return change / 2 * t * t * t + begin;
  t -= 2.0;
  return change / 2 * (t * t * t + 2) + begin;
}

// ELASTIC has the optional blend (`USE_ELASTIC_BLEND`) — Blender ships
// this enabled by default, so we port it. See easing.cc:118-145.
function elastic_blend(time, change, duration, amplitude, s, f) {
  if (change) {
    const t = Math.abs(s);
    if (amplitude) f *= amplitude / Math.abs(change);
    else f = 0;
    if (Math.abs(time * duration) < t) {
      const l = Math.abs(time * duration) / t;
      f = (f * l) + (1.0 - l);
    }
  }
  return f;
}
function elastic_in(time, begin, change, duration, amplitude, period) {
  let s, f = 1.0;
  if (time === 0.0) return begin;
  let t = time / duration;
  if (t === 1.0) return begin + change;
  t -= 1.0;
  if (!period) period = duration * 0.3;
  if (!amplitude || amplitude < Math.abs(change)) {
    s = period / 4;
    f = elastic_blend(t, change, duration, amplitude, s, f);
    amplitude = change;
  } else {
    s = period / (2 * M_PI) * Math.asin(change / amplitude);
  }
  return -f * (amplitude * Math.pow(2, 10 * t) *
               Math.sin((t * duration - s) * (2 * M_PI) / period)) + begin;
}
function elastic_out(time, begin, change, duration, amplitude, period) {
  let s, f = 1.0;
  if (time === 0.0) return begin;
  let t = time / duration;
  if (t === 1.0) return begin + change;
  t = -t;
  if (!period) period = duration * 0.3;
  if (!amplitude || amplitude < Math.abs(change)) {
    s = period / 4;
    f = elastic_blend(t, change, duration, amplitude, s, f);
    amplitude = change;
  } else {
    s = period / (2 * M_PI) * Math.asin(change / amplitude);
  }
  return f * (amplitude * Math.pow(2, 10 * t) *
              Math.sin((t * duration - s) * (2 * M_PI) / period)) + change + begin;
}
function elastic_inout(time, begin, change, duration, amplitude, period) {
  let s, f = 1.0;
  if (time === 0.0) return begin;
  let t = time / (duration / 2);
  if (t === 2.0) return begin + change;
  t -= 1.0;
  if (!period) period = duration * (0.3 * 1.5);
  if (!amplitude || amplitude < Math.abs(change)) {
    s = period / 4;
    f = elastic_blend(t, change, duration, amplitude, s, f);
    amplitude = change;
  } else {
    s = period / (2 * M_PI) * Math.asin(change / amplitude);
  }
  if (t < 0.0) {
    f *= -0.5;
    return f * (amplitude * Math.pow(2, 10 * t) *
                Math.sin((t * duration - s) * (2 * M_PI) / period)) + begin;
  }
  t = -t;
  f *= 0.5;
  return f * (amplitude * Math.pow(2, 10 * t) *
              Math.sin((t * duration - s) * (2 * M_PI) / period)) + change + begin;
}

function expo_in(time, begin, change, duration) {
  if (time === 0.0) return begin;
  return change * (Math.pow(2, 10 * (time / duration - 1)) - EXPO_POW_MIN) * EXPO_POW_SCALE + begin;
}
function expo_out(time, begin, change, duration) {
  if (time === 0.0) return begin;
  return change * (1 - (Math.pow(2, -10 * time / duration) - EXPO_POW_MIN) * EXPO_POW_SCALE) + begin;
}
function expo_inout(time, begin, change, duration) {
  const duration_half = duration / 2.0;
  const change_half = change / 2.0;
  if (time <= duration_half) return expo_in(time, begin, change_half, duration_half);
  return expo_out(time - duration_half, begin + change_half, change_half, duration_half);
}

function quad_in(time, begin, change, duration) {
  const t = time / duration;
  return change * t * t + begin;
}
function quad_out(time, begin, change, duration) {
  const t = time / duration;
  return -change * t * (t - 2) + begin;
}
function quad_inout(time, begin, change, duration) {
  let t = time / (duration / 2);
  if (t < 1.0) return change / 2 * t * t + begin;
  t -= 1.0;
  return -change / 2 * (t * (t - 2) - 1) + begin;
}

function quart_in(time, begin, change, duration) {
  const t = time / duration;
  return change * t * t * t * t + begin;
}
function quart_out(time, begin, change, duration) {
  const t = time / duration - 1;
  return -change * (t * t * t * t - 1) + begin;
}
function quart_inout(time, begin, change, duration) {
  let t = time / (duration / 2);
  if (t < 1.0) return change / 2 * t * t * t * t + begin;
  t -= 2.0;
  return -change / 2 * (t * t * t * t - 2) + begin;
}

function quint_in(time, begin, change, duration) {
  const t = time / duration;
  return change * t * t * t * t * t + begin;
}
function quint_out(time, begin, change, duration) {
  const t = time / duration - 1;
  return change * (t * t * t * t * t + 1) + begin;
}
function quint_inout(time, begin, change, duration) {
  let t = time / (duration / 2);
  if (t < 1.0) return change / 2 * t * t * t * t * t + begin;
  t -= 2.0;
  return change / 2 * (t * t * t * t * t + 2) + begin;
}

function sine_in(time, begin, change, duration) {
  return -change * Math.cos(time / duration * M_PI_2) + change + begin;
}
function sine_out(time, begin, change, duration) {
  return change * Math.sin(time / duration * M_PI_2) + begin;
}
function sine_inout(time, begin, change, duration) {
  return -change / 2 * (Math.cos(M_PI * time / duration) - 1) + begin;
}

const EASING_TABLE = {
  back:    { in: back_in,    out: back_out,    inout: back_inout    },
  bounce:  { in: bounce_in,  out: bounce_out,  inout: bounce_inout  },
  circ:    { in: circ_in,    out: circ_out,    inout: circ_inout    },
  cubic:   { in: cubic_in,   out: cubic_out,   inout: cubic_inout   },
  elastic: { in: elastic_in, out: elastic_out, inout: elastic_inout },
  expo:    { in: expo_in,    out: expo_out,    inout: expo_inout    },
  quad:    { in: quad_in,    out: quad_out,    inout: quad_inout    },
  quart:   { in: quart_in,   out: quart_out,   inout: quart_inout   },
  quint:   { in: quint_in,   out: quint_out,   inout: quint_inout   },
  sine:    { in: sine_in,    out: sine_out,    inout: sine_inout    },
};

// ─────────────────────────────────────────────────────────────────────────
//  Cubic-bezier inversion — port of Blender's solve_cubic + findzero +
//  berekeny + correct_bezpart. fcurve.cc:1377-1559.
// ─────────────────────────────────────────────────────────────────────────

function cbrt(x) {
  return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3);
}

/**
 * Find roots of `c0 + c1 x + c2 x^2 + c3 x^3 = 0` in [SMALL, 1.000001].
 * Returns the count; writes roots into `o`. Port of Blender's solve_cubic
 * (fcurve.cc:1423).
 *
 * @param {number} c0
 * @param {number} c1
 * @param {number} c2
 * @param {number} c3
 * @param {Float32Array} o   -- output (length ≥ 3)
 * @returns {number} number of valid roots written
 */
function solveCubic(c0, c1, c2, c3, o) {
  let nr = 0;
  if (c3 !== 0.0) {
    let a = c2 / c3;
    const b = c1 / c3;
    const c = c0 / c3;
    a = a / 3;
    const p = b / 3 - a * a;
    const q = (2 * a * a * a - a * b + c) / 2;
    const d = q * q + p * p * p;
    if (d > 0.0) {
      const t = Math.sqrt(d);
      o[0] = cbrt(-q + t) + cbrt(-q - t) - a;
      if (o[0] >= SMALL && o[0] <= 1.000001) return 1;
      return 0;
    }
    if (d === 0.0) {
      const t = cbrt(-q);
      o[0] = 2 * t - a;
      if (o[0] >= SMALL && o[0] <= 1.000001) nr++;
      o[nr] = -t - a;
      if (o[nr] >= SMALL && o[nr] <= 1.000001) return nr + 1;
      return nr;
    }
    const phi = Math.acos(-q / Math.sqrt(-(p * p * p)));
    const t = Math.sqrt(-p);
    const cp = Math.cos(phi / 3);
    const cq = Math.sqrt(3 - 3 * cp * cp);
    o[0] = 2 * t * cp - a;
    if (o[0] >= SMALL && o[0] <= 1.000001) nr++;
    o[nr] = -t * (cp + cq) - a;
    if (o[nr] >= SMALL && o[nr] <= 1.000001) nr++;
    o[nr] = -t * (cp - cq) - a;
    if (o[nr] >= SMALL && o[nr] <= 1.000001) return nr + 1;
    return nr;
  }
  const a = c2;
  const b = c1;
  const c = c0;
  if (a !== 0.0) {
    let p = b * b - 4 * a * c;
    if (p > 0) {
      p = Math.sqrt(p);
      o[0] = (-b - p) / (2 * a);
      if (o[0] >= SMALL && o[0] <= 1.000001) nr++;
      o[nr] = (-b + p) / (2 * a);
      if (o[nr] >= SMALL && o[nr] <= 1.000001) return nr + 1;
      return nr;
    }
    if (p === 0) {
      o[0] = -b / (2 * a);
      if (o[0] >= SMALL && o[0] <= 1.000001) return 1;
    }
    return 0;
  }
  if (b !== 0.0) {
    o[0] = -c / b;
    if (o[0] >= SMALL && o[0] <= 1.000001) return 1;
    return 0;
  }
  if (c === 0.0) {
    o[0] = 0.0;
    return 1;
  }
  return 0;
}

/**
 * Find the [0,1] bezier parameter `t` such that the cubic-bezier
 * x-axis curve `B_x(t)` passes through `x`. Port of Blender findzero.
 * fcurve.cc:1535.
 *
 * @param {number} x   -- target x value (= evaltime)
 * @param {number} q0  -- B_x control 0 (= prev.time)
 * @param {number} q1  -- B_x control 1 (= prev.handleRight.time)
 * @param {number} q2  -- B_x control 2 (= next.handleLeft.time)
 * @param {number} q3  -- B_x control 3 (= next.time)
 * @param {Float32Array} o
 * @returns {number} number of roots
 */
function findZero(x, q0, q1, q2, q3, o) {
  return solveCubic(q0 - x, 3 * (q1 - q0), 3 * (q0 - 2 * q1 + q2), q3 - q0 + 3 * (q1 - q2), o);
}

/**
 * Evaluate cubic-bezier y-axis curve at parameter `t`. Port of Blender
 * berekeny. fcurve.cc:1545.
 */
function bezierY(f1, f2, f3, f4, t) {
  const c0 = f1;
  const c1 = 3.0 * (f2 - f1);
  const c2 = 3.0 * (f1 - 2.0 * f2 + f3);
  const c3 = f4 - f1 + 3.0 * (f2 - f3);
  return c0 + t * c1 + t * t * c2 + t * t * t * c3;
}

/**
 * Clamp a bezier segment's handles so they don't overshoot the segment
 * span — prevents non-monotonic time-axis curves (which would have
 * multiple y-values for one x). Port of Blender BKE_fcurve_correct_bezpart.
 * fcurve.cc:1377. Mutates v2 / v3 in place; v1 / v4 untouched.
 */
function correctBezpart(v1, v2, v3, v4) {
  const h1 = [v1[0] - v2[0], v1[1] - v2[1]];
  const h2 = [v4[0] - v3[0], v4[1] - v3[1]];
  const len = v4[0] - v1[0];
  const len1 = Math.abs(h1[0]);
  const len2 = Math.abs(h2[0]);
  if ((len1 + len2) === 0.0) return;
  if (len1 > len) {
    const fac = len / len1;
    v2[0] = v1[0] - fac * h1[0];
    v2[1] = v1[1] - fac * h1[1];
  }
  if (len2 > len) {
    const fac = len / len2;
    v3[0] = v4[0] - fac * h2[0];
    v3[1] = v4[1] - fac * h2[1];
  }
}

// Reusable scratch — eval is called every frame on every fcurve.
const SCRATCH_ROOTS = new Float32Array(3);

/**
 * Evaluate the segment from `prev` to `next` at `time`. Returns the
 * value at that point per `prev.interpolation`'s shape.
 *
 * Mirrors the BEZT_IPO_* dispatch in Blender's
 * `fcurve_eval_keyframes_interpolate` (fcurve.cc:2026).
 *
 * Falls back to `prev.value` if findZero fails to invert (degenerate
 * handles) — matches Blender's behavior for the same failure mode
 * (fcurve.cc:2122-2132 returns 0; we return prev.value as the safer
 * "do no harm" choice).
 *
 * @param {*} prev   -- BezTriple keyform at segment START
 * @param {*} next   -- BezTriple keyform at segment END
 * @param {number} time
 * @returns {number}
 */
export function evaluateBezTripleSegment(prev, next, time) {
  const duration = next.time - prev.time;
  const begin = prev.value;
  const change = next.value - prev.value;
  const segTime = time - prev.time;

  // Constant segment (or zero-length): hold prev value.
  if (prev.interpolation === 'constant' || duration === 0) {
    return prev.value;
  }
  if (prev.interpolation === 'linear' || !prev.interpolation) {
    return begin + (change * segTime) / duration;
  }
  if (prev.interpolation === 'bezier') {
    const v1 = [prev.time, prev.value];
    const v2 = prev.handleRight
      ? [prev.handleRight.time, prev.handleRight.value]
      : [prev.time + duration / 3, prev.value];
    const v3 = next.handleLeft
      ? [next.handleLeft.time, next.handleLeft.value]
      : [next.time - duration / 3, next.value];
    const v4 = [next.time, next.value];
    // Optimization (fcurve.cc:2110): if all y-values equal, return early.
    if (Math.abs(v1[1] - v4[1]) < Number.EPSILON &&
        Math.abs(v2[1] - v3[1]) < Number.EPSILON &&
        Math.abs(v3[1] - v4[1]) < Number.EPSILON) {
      return v1[1];
    }
    correctBezpart(v1, v2, v3, v4);
    const nRoots = findZero(time, v1[0], v2[0], v3[0], v4[0], SCRATCH_ROOTS);
    if (nRoots === 0) return prev.value;
    return bezierY(v1[1], v2[1], v3[1], v4[1], SCRATCH_ROOTS[0]);
  }

  // Named easings (back / bounce / circ / cubic / elastic / expo /
  // quad / quart / quint / sine).
  const easingFns = EASING_TABLE[prev.interpolation];
  if (!easingFns) {
    // Unknown interpolation enum — degrade to linear.
    return begin + (change * segTime) / duration;
  }
  const mode = (prev.easeMode && prev.easeMode !== 'auto')
    ? prev.easeMode
    : DEFAULT_EASE_MODE[prev.interpolation];
  const fn = easingFns[mode];
  if (!fn) return begin + (change * segTime) / duration;

  // Easings with extra parameters
  if (prev.interpolation === 'back') {
    const overshoot = typeof prev.back === 'number' ? prev.back : DEFAULT_BACK_OVERSHOOT;
    return fn(segTime, begin, change, duration, overshoot);
  }
  if (prev.interpolation === 'elastic') {
    const amp = typeof prev.amplitude === 'number' ? prev.amplitude : DEFAULT_ELASTIC_AMPLITUDE;
    const per = typeof prev.period === 'number' ? prev.period : DEFAULT_ELASTIC_PERIOD;
    return fn(segTime, begin, change, duration, amp, per);
  }
  return fn(segTime, begin, change, duration);
}

/**
 * Like `evaluateBezTripleSegment` but returns the [0,1] parametric
 * lerp factor `te` instead of the value. Used by `interpolateMeshVerts`
 * which holds arrays of {x,y} per keyform and lerps each component
 * with one shared `te`. For `bezier` interpolation this returns the
 * BezTriple parameter `t`, which approximates per-component bezier
 * evaluation when value-axis handles aren't stored per-vertex (the
 * mesh_verts shape is one-handle-per-keyform, not per-component).
 *
 * @param {*} prev
 * @param {*} next
 * @param {number} time
 * @returns {number} te ∈ [0,1]
 */
export function evaluateBezTripleParam(prev, next, time) {
  const duration = next.time - prev.time;
  if (duration === 0 || prev.interpolation === 'constant') return 0;
  const segTime = time - prev.time;
  const t = segTime / duration;
  if (prev.interpolation === 'linear' || !prev.interpolation) return t;
  if (prev.interpolation === 'bezier') {
    const v1 = [prev.time, prev.value];
    const v2 = prev.handleRight
      ? [prev.handleRight.time, prev.handleRight.value]
      : [prev.time + duration / 3, prev.value];
    const v3 = next.handleLeft
      ? [next.handleLeft.time, next.handleLeft.value]
      : [next.time - duration / 3, next.value];
    const v4 = [next.time, next.value];
    correctBezpart(v1, v2, v3, v4);
    const nRoots = findZero(time, v1[0], v2[0], v3[0], v4[0], SCRATCH_ROOTS);
    if (nRoots === 0) return t;
    return SCRATCH_ROOTS[0];
  }
  // Named easing → return parametric value evaluated as if begin=0, change=1, duration=1.
  // segTime / duration → [0,1]; reuse the easing fn with normalized inputs.
  const easingFns = EASING_TABLE[prev.interpolation];
  if (!easingFns) return t;
  const mode = (prev.easeMode && prev.easeMode !== 'auto')
    ? prev.easeMode
    : DEFAULT_EASE_MODE[prev.interpolation];
  const fn = easingFns[mode];
  if (!fn) return t;
  if (prev.interpolation === 'back') {
    return fn(t, 0, 1, 1, DEFAULT_BACK_OVERSHOOT);
  }
  if (prev.interpolation === 'elastic') {
    return fn(t, 0, 1, 1, DEFAULT_ELASTIC_AMPLITUDE, DEFAULT_ELASTIC_PERIOD);
  }
  return fn(t, 0, 1, 1);
}
