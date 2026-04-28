/**
 * v2 R9 — Physics tick. Cubism-style pendulum integrator that turns
 * head/body angle inputs into lagged hair / clothing / bust / arm
 * sway outputs. Pure JS, frame-independent (fixed-dt accumulator),
 * no GL — driven from the main viewport tick.
 *
 * # Algorithm
 *
 * Each `physicsRule` describes one pendulum chain:
 *
 *   - `inputs`:      list of param ids contributing to a "drive"
 *                    direction. Each input has a `type` (SRC_TO_X /
 *                    SRC_TO_Y / SRC_TO_G_ANGLE) saying whether it
 *                    contributes to the chain's translation or to its
 *                    gravity-rotation angle, plus a `weight` (0..100)
 *                    for the within-type sum.
 *
 *   - `vertices`:    pendulum chain. Vertex 0 is the anchor (no
 *                    physics — it tracks the input translation
 *                    directly). Each subsequent vertex is a damped
 *                    particle hanging at distance `radius` from its
 *                    parent under a rotated gravity vector.
 *
 *                    Per-vertex tunables match Cubism's schema:
 *                      * `mobility`     — how strongly the vertex
 *                                         responds vs stays put. <1
 *                                         dampens, =1 free.
 *                      * `delay`        — phase lag. Higher = vertex
 *                                         lags further behind the
 *                                         driver. Implemented as a
 *                                         lerp factor on the rotated
 *                                         gravity direction (0 = snap,
 *                                         1 = never moves).
 *                      * `acceleration` — gravity strength scalar.
 *                                         Larger = faster settle.
 *                      * `radius`       — rod length to parent vertex.
 *
 *   - `normalization`: posMin/posMax/angleMin/angleMax — the unit box
 *                      against which inputs are scaled. Translation
 *                      inputs land in [posMin..posMax]; angle inputs
 *                      land in [angleMin..angleMax].
 *
 *   - `outputs`:     read the `vertexIndex`-th vertex's swing angle,
 *                    map it into the destination param via `scale` and
 *                    `isReverse`, write to `paramValues`.
 *
 * # Integration
 *
 * Standard verlet step per particle, plus a rod constraint pinning
 * each vertex at `radius` from its parent. Verlet is well-behaved
 * under the fixed-dt regime (1/60 s) we run at; energy creep over
 * many seconds is bounded by the `mobility` velocity-damping factor.
 *
 * # Output mapping
 *
 *   pendulum.angle (degrees, naturally bounded to ~±angleMax under
 *   sustained input by the rod-constrained pendulum reaching steady
 *   state pointing along the rotated gravity vector)
 *
 *   →  outputValue = pendulum.angle / angleMax * out.scale
 *      *  isReverse ? -1 : 1
 *      clamp [paramSpec.min, paramSpec.max]
 *
 * So when the driver (e.g. ParamBodyAngleZ) is at ±10° (= ±angleMax)
 * the pendulum settles ±10° from rest, the / angleMax normalises to
 * ±1, and `out.scale` recovers the destination param's natural unit
 * (e.g. 1.434 for skirt sway).
 *
 * # Frame independence
 *
 * The tick uses a fixed-dt accumulator (1/60 s) so simulation state
 * is identical regardless of host framerate (60 Hz, 144 Hz, paused
 * frames during slow ops). The viewport tick passes its real elapsed
 * dt; we step the simulation as many 1/60 substeps as fit and carry
 * the leftover into the next frame.
 *
 * @module io/live2d/runtime/physicsTick
 */

const PHYSICS_DT = 1 / 60;          // fixed simulation step (s)
const MAX_SUBSTEPS = 6;             // cap to prevent spiral-of-death after long pauses
const ACCEL_SCALAR = 100;           // tuning constant: maps acceleration*radius force to deg/s²
                                    // Calibrated so default Hiyori rules settle in ~0.5 s.

/**
 * @typedef {Object} ParticleState
 * @property {[number, number]} position
 * @property {[number, number]} lastPosition
 * @property {number} angle              - swing angle in degrees, computed each step
 * @property {boolean} initialized
 */

/**
 * @typedef {Object} RuleState
 * @property {ParticleState[]} particles
 * @property {number} accumulator        - leftover dt from previous frame
 */

/**
 * @typedef {Object} PhysicsState
 * @property {Map<string, RuleState>} byRuleId
 */

/**
 * Build a fresh physics state for a list of rules. Particles start at
 * the rest position implied by the rule's vertex layout (0, +radius
 * down the chain) and uninitialised verlet history. The first tick
 * primes `lastPosition` so the chain doesn't snap on frame 1.
 *
 * @param {Array<object>} rules - resolved physics rules
 * @returns {PhysicsState}
 */
export function createPhysicsState(rules) {
  const byRuleId = new Map();
  if (!Array.isArray(rules)) return { byRuleId };
  for (const rule of rules) {
    if (!rule || !Array.isArray(rule.vertices) || rule.vertices.length === 0) continue;
    const particles = rule.vertices.map((v, i) => {
      const position = restPositionForIndex(rule.vertices, i);
      return {
        position: [position[0], position[1]],
        lastPosition: [position[0], position[1]],
        angle: 0,
        initialized: false,
      };
    });
    byRuleId.set(rule.id, { particles, accumulator: 0 });
  }
  return { byRuleId };
}

/**
 * Rest position of vertex `i` along the chain. Particles hang straight
 * down from the anchor at increasing radius — the chain at rest is
 * vertical with all particles at (0, sum of radii).
 */
function restPositionForIndex(vertices, i) {
  let y = 0;
  for (let k = 1; k <= i; k++) {
    y += vertices[k].radius;
  }
  return [0, y];
}

/**
 * Tick the physics state forward by `dtSeconds`, integrating each
 * rule's pendulum chain and writing outputs to `paramValues`.
 *
 * Mutates `paramValues` in place (caller is expected to reflect
 * changes back into `useParamValuesStore` via setMany if needed).
 *
 * @param {PhysicsState} state
 * @param {Array<object>} rules            - resolved physics rules
 * @param {Object<string, number>} paramValues - mutated: outputs are written here
 * @param {Map<string, {min:number, max:number, default:number}>} paramSpecs
 *        - id → spec (for input normalisation + output clamp). Missing
 *          ids default to {min:-1,max:1,default:0}.
 * @param {number} dtSeconds              - real elapsed time since last tick
 * @returns {{stepsApplied: number, outputsChanged: number}}
 *          stepsApplied = how many fixed substeps ran; outputsChanged
 *          = how many distinct output params were written (for the
 *          caller's "should I update the store?" check).
 */
export function tickPhysics(state, rules, paramValues, paramSpecs, dtSeconds) {
  if (!state || !Array.isArray(rules)) return { stepsApplied: 0, outputsChanged: 0 };
  const dt = Math.max(0, Math.min(dtSeconds, MAX_SUBSTEPS * PHYSICS_DT));
  let totalSteps = 0;

  for (const rule of rules) {
    const rs = state.byRuleId.get(rule.id);
    if (!rs) continue;
    rs.accumulator += dt;
    let steps = 0;
    while (rs.accumulator >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
      stepRule(rule, rs, paramValues, paramSpecs);
      rs.accumulator -= PHYSICS_DT;
      steps += 1;
    }
    totalSteps += steps;
  }

  // Even if no substep fired this frame, we re-read outputs from the
  // current state so first-frame and post-init paramValues reflect rest.
  let outputsChanged = 0;
  for (const rule of rules) {
    const rs = state.byRuleId.get(rule.id);
    if (!rs) continue;
    outputsChanged += writeRuleOutputs(rule, rs, paramValues, paramSpecs);
  }

  return { stepsApplied: totalSteps, outputsChanged };
}

/**
 * Evolve one rule's pendulum chain by exactly one fixed substep.
 * Internal — used by `tickPhysics`.
 */
function stepRule(rule, rs, paramValues, paramSpecs) {
  const { tx, ty, ta } = aggregateInputs(rule, paramValues, paramSpecs);

  const particles = rs.particles;
  if (particles.length === 0) return;

  // Anchor (vertex 0) tracks the input translation directly.
  particles[0].position[0] = tx + rule.vertices[0].x;
  particles[0].position[1] = ty + rule.vertices[0].y;
  if (!particles[0].initialized) {
    particles[0].lastPosition[0] = particles[0].position[0];
    particles[0].lastPosition[1] = particles[0].position[1];
    particles[0].initialized = true;
  }

  // Rotated gravity direction. Cubism convention: angle is around
  // the canvas Z axis, with +angle leaning right; gravity points down
  // (+y) at angle = 0 and rotates by ta degrees.
  const radian = (ta * Math.PI) / 180;
  const gravX = Math.sin(radian);
  const gravY = Math.cos(radian);

  for (let i = 1; i < particles.length; i++) {
    const p = particles[i];
    const parent = particles[i - 1];
    const v = rule.vertices[i];

    // First-time prime: lastPosition = position so verlet velocity = 0
    // on the first step (otherwise the rest-vs-prior-rest delta is
    // garbage). Position itself is left at the rest layout from
    // createPhysicsState, NOT snapped to current gravity — we want the
    // particle to *swing* into the new direction, not teleport.
    if (!p.initialized) {
      p.lastPosition[0] = p.position[0];
      p.lastPosition[1] = p.position[1];
      p.initialized = true;
    }

    // Spring force toward the rotated-gravity target hanging from
    // parent. `acceleration` controls how fast the pendulum settles.
    const tgtX = parent.position[0] + gravX * v.radius;
    const tgtY = parent.position[1] + gravY * v.radius;
    const fx = (tgtX - p.position[0]) * v.acceleration * ACCEL_SCALAR;
    const fy = (tgtY - p.position[1]) * v.acceleration * ACCEL_SCALAR;

    // Verlet step.
    let nextX = p.position[0] * 2 - p.lastPosition[0] + fx * PHYSICS_DT * PHYSICS_DT;
    let nextY = p.position[1] * 2 - p.lastPosition[1] + fy * PHYSICS_DT * PHYSICS_DT;

    // Velocity-form damping. `delay` ∈ [0..1]; keep (1 - delay) of the
    // velocity each substep, so larger delay = more damping = stronger
    // lag. `mobility` further scales motion (lower = stiffer joint).
    const damping = (1 - v.delay) * v.mobility;
    const velX = (nextX - p.position[0]) * damping;
    const velY = (nextY - p.position[1]) * damping;
    nextX = p.position[0] + velX;
    nextY = p.position[1] + velY;

    // Rod constraint: clamp distance to parent at exactly `radius`.
    const rx = nextX - parent.position[0];
    const ry = nextY - parent.position[1];
    const dist = Math.sqrt(rx * rx + ry * ry);
    if (dist > 1e-6) {
      const k = v.radius / dist;
      nextX = parent.position[0] + rx * k;
      nextY = parent.position[1] + ry * k;
    } else {
      // Degenerate case — point exactly at parent. Snap to gravity dir.
      nextX = parent.position[0] + gravX * v.radius;
      nextY = parent.position[1] + gravY * v.radius;
    }

    p.lastPosition[0] = p.position[0];
    p.lastPosition[1] = p.position[1];
    p.position[0] = nextX;
    p.position[1] = nextY;
  }

  // Compute swing angles relative to chain rest direction (downwards).
  // atan2(dx, dy): when (dx,dy) = (0, +radius) (rest), angle = 0. When
  // pendulum swings right, dx > 0 → positive angle.
  for (let i = 1; i < particles.length; i++) {
    const p = particles[i];
    const parent = particles[i - 1];
    const dx = p.position[0] - parent.position[0];
    const dy = p.position[1] - parent.position[1];
    p.angle = (Math.atan2(dx, dy) * 180) / Math.PI;
  }
}

/**
 * Aggregate a rule's inputs into translation (tx, ty) + angle (ta)
 * drive values, in the rule's normalisation units.
 *
 * Per-input, the param value is normalised to [-1..1] using the param
 * spec's range (negative side uses [min..default], positive side uses
 * [default..max]; `isReverse` flips sign), then weighted by
 * `weight / totalWeight-of-same-type` and accumulated into the
 * matching axis. Final scale to normalisation units happens once per
 * axis.
 */
function aggregateInputs(rule, paramValues, paramSpecs) {
  let sumWX = 0; let sumX = 0;
  let sumWY = 0; let sumY = 0;
  let sumWA = 0; let sumA = 0;

  for (const inp of rule.inputs ?? []) {
    const spec = paramSpecs.get(inp.paramId) ?? { min: -1, max: 1, default: 0 };
    const raw = paramValues[inp.paramId];
    const v = (typeof raw === 'number' && Number.isFinite(raw)) ? raw : (spec.default ?? 0);
    let n = normalizeParam(v, spec);
    if (inp.isReverse) n = -n;
    const w = inp.weight ?? 0;
    if (w <= 0) continue;
    if (inp.type === 'SRC_TO_X') {
      sumWX += w; sumX += n * w;
    } else if (inp.type === 'SRC_TO_Y') {
      sumWY += w; sumY += n * w;
    } else if (inp.type === 'SRC_TO_G_ANGLE') {
      sumWA += w; sumA += n * w;
    }
  }

  const norm = rule.normalization ?? { posMin: -10, posMax: 10, angleMin: -10, angleMax: 10 };
  const tx = sumWX > 0 ? scaleNormalizedToRange(sumX / sumWX, norm.posMin, norm.posMax) : 0;
  const ty = sumWY > 0 ? scaleNormalizedToRange(sumY / sumWY, norm.posMin, norm.posMax) : 0;
  const ta = sumWA > 0 ? scaleNormalizedToRange(sumA / sumWA, norm.angleMin, norm.angleMax) : 0;
  return { tx, ty, ta };
}

/**
 * Map a raw param value to [-1..1] using its spec range. Asymmetric
 * ranges are handled correctly: negative input scales by the negative
 * half-range, positive by the positive half-range.
 */
function normalizeParam(value, spec) {
  const def = spec.default ?? 0;
  if (value >= def) {
    const span = (spec.max ?? 1) - def;
    return span > 1e-6 ? Math.min(1, (value - def) / span) : 0;
  }
  const span = def - (spec.min ?? -1);
  return span > 1e-6 ? Math.max(-1, (value - def) / span) : 0;
}

/** Map [-1..1] to a [min..max] range with default at 0. */
function scaleNormalizedToRange(n, min, max) {
  if (n >= 0) return n * max;
  return -n * min; // n < 0, min < 0 → product > 0; -n*min keeps sign right
}

/**
 * Write a rule's outputs into `paramValues`. Returns the number of
 * outputs that actually changed value (epsilon=1e-5) so the caller
 * can decide whether to update Zustand.
 */
function writeRuleOutputs(rule, rs, paramValues, paramSpecs) {
  let changed = 0;
  const norm = rule.normalization ?? { angleMax: 10 };
  const angleMax = norm.angleMax || 10;
  const outs = rule.outputs ?? [];
  for (const out of outs) {
    const idx = out.vertexIndex ?? 0;
    const p = rs.particles[idx];
    if (!p) continue;
    const spec = paramSpecs.get(out.paramId) ?? { min: -1, max: 1, default: 0 };
    let value = (p.angle / angleMax) * (out.scale ?? 1);
    if (out.isReverse) value = -value;
    if (value < (spec.min ?? -Infinity)) value = spec.min;
    if (value > (spec.max ?? Infinity))  value = spec.max;
    const prev = paramValues[out.paramId];
    if (typeof prev !== 'number' || Math.abs(prev - value) > 1e-5) {
      paramValues[out.paramId] = value;
      changed += 1;
    }
  }
  return changed;
}

/**
 * Build a `paramSpecs` Map from `project.parameters` (or
 * `rigSpec.parameters`). Helper for the React tick layer.
 *
 * @param {Array<{id:string, min?:number, max?:number, default?:number}>} parameters
 * @returns {Map<string, {min:number, max:number, default:number}>}
 */
export function buildParamSpecs(parameters) {
  const map = new Map();
  if (!Array.isArray(parameters)) return map;
  for (const p of parameters) {
    if (!p || typeof p.id !== 'string') continue;
    map.set(p.id, {
      min: typeof p.min === 'number' ? p.min : -1,
      max: typeof p.max === 'number' ? p.max : 1,
      default: typeof p.default === 'number' ? p.default : 0,
    });
  }
  return map;
}

// Internals exported for tests only — not part of the public surface.
export const __testing__ = {
  PHYSICS_DT,
  MAX_SUBSTEPS,
  ACCEL_SCALAR,
  normalizeParam,
  scaleNormalizedToRange,
  aggregateInputs,
  stepRule,
  writeRuleOutputs,
  restPositionForIndex,
};
