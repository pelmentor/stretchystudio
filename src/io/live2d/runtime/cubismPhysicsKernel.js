// @ts-check
/**
 * Cubism Physics Kernel — byte-faithful port of the Cubism Web Framework's
 * `CubismPhysics` algorithm into v3's runtime physics tick.
 *
 * This module is the production sibling of
 * `scripts/cubism_physics/oracle/cubismPhysicsOracle.mjs` (Phase 0 oracle). The
 * algorithm is identical; only the input shape differs:
 *  - Oracle ingests parsed `physics3.json` directly.
 *  - This module ingests v3's resolved `rule` shape (the output of
 *    `physicsConfig.resolvePhysicsRules` and `physics3jsonImport.parsePhysics3Json`).
 *
 * Reference: `reference/cubism-web-framework/physics/cubismphysics.ts` at commit
 * `d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b`. License: Live2D Open Software
 * License (see `reference/cubism-web-framework/LICENSE.md`).
 *
 * Kept in sync with the oracle by construction — both were transcribed from the
 * same TS source. If you change one, change the other.
 *
 * Public API:
 *   const state = createKernelState(rules, paramSpecs);  // once per project
 *   kernelTick(state, rules, paramValues, paramSpecs, dt);  // each frame
 *
 * `createPhysicsState` and `tickPhysics` in physicsTick.js delegate to these
 * functions when the kernel flag = `'cubism-port'` (the default).
 *
 * @module io/live2d/runtime/cubismPhysicsKernel
 */

// physics types tags. @ref cubismphysics.ts:25-27
const PhysicsTypeTagX = 'X';
const PhysicsTypeTagY = 'Y';
const PhysicsTypeTagAngle = 'Angle';

// Constants. @ref cubismphysics.ts:30-39
const AirResistance = 5.0;
const MaximumWeight = 100.0;
const MovementThreshold = 0.001;
const MaxDeltaTime = 5.0;

// CubismPhysicsSource enum. @ref cubismphysicsinternal.ts:21-25
const Source_X = 0;
const Source_Y = 1;
const Source_Angle = 2;

// v3-rule type → Cubism source-type map.
const V3_TYPE_TO_SOURCE = {
  SRC_TO_X: Source_X,
  SRC_TO_Y: Source_Y,
  SRC_TO_G_ANGLE: Source_Angle,
};

// ---------- math helpers (transcribed from _dep_cubismmath.ts) ----------

/** @ref _dep_cubismmath.ts:154 */
function degreesToRadian(d) { return (d / 180.0) * Math.PI; }

/** @ref _dep_cubismmath.ts:175 — directionToRadian returns wrapped (-π..π) */
function directionToRadian(from, to) {
  const q1 = Math.atan2(to.y, to.x);
  const q2 = Math.atan2(from.y, from.x);
  let ret = q1 - q2;
  while (ret < -Math.PI) ret += Math.PI * 2.0;
  while (ret >  Math.PI) ret -= Math.PI * 2.0;
  return ret;
}

/** @ref _dep_cubismmath.ts:217 — radianToDirection: (sin θ, cos θ). */
function radianToDirection(totalAngle) {
  return { x: Math.sin(totalAngle), y: Math.cos(totalAngle) };
}

/** Inline normalize on a {x,y} literal (mutates). @ref _dep_cubismvector2.ts:132 */
function vec2Normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len > 0) { v.x = v.x / len; v.y = v.y / len; }
}

// ---------- standalone functions (file-scope helpers in cubismphysics.ts) ----------

/** @ref cubismphysics.ts:897 */
function sign(value) { if (value > 0.0) return 1; if (value < 0.0) return -1; return 0; }

/** @ref cubismphysics.ts:1041 */
function getRangeValue(min, max) { return Math.abs(Math.max(min, max) - Math.min(min, max)); }

/** @ref cubismphysics.ts:1048 */
function getDefaultValue(min, max) { return Math.min(min, max) + getRangeValue(min, max) / 2.0; }

/** @ref cubismphysics.ts:984 */
function getOutputTranslationX(translation, particles, particleIndex, isInverted, parentGravity) {
  let v = translation.x; if (isInverted) v *= -1.0; return v;
}
/** @ref cubismphysics.ts:1000 */
function getOutputTranslationY(translation, particles, particleIndex, isInverted, parentGravity) {
  let v = translation.y; if (isInverted) v *= -1.0; return v;
}
/** @ref cubismphysics.ts:1015 */
function getOutputAngle(translation, particles, particleIndex, isInverted, parentGravity) {
  let pg = parentGravity;
  if (particleIndex >= 2) {
    pg = {
      x: particles[particleIndex - 1].position.x - particles[particleIndex - 2].position.x,
      y: particles[particleIndex - 1].position.y - particles[particleIndex - 2].position.y,
    };
  } else {
    pg = { x: pg.x * -1.0, y: pg.y * -1.0 };
  }
  let v = directionToRadian(pg, translation);
  if (isInverted) v *= -1.0;
  return v;
}

/** @ref cubismphysics.ts:1053 */
function getOutputScaleTranslationX(translationScale, angleScale) { return translationScale.x; }
/** @ref cubismphysics.ts:1060 */
function getOutputScaleTranslationY(translationScale, angleScale) { return translationScale.y; }
/** @ref cubismphysics.ts:1067 */
function getOutputScaleAngle(translationScale, angleScale) { return angleScale; }

/** @ref cubismphysics.ts:909 */
function getInputTranslationXFromNormalizedParameterValue(targetTranslation, targetAngle, value, parameterMinimumValue, parameterMaximumValue, parameterDefaultValue, normalizationPosition, normalizationAngle, isInverted, weight) {
  targetTranslation.x +=
    normalizeParameterValue(
      value, parameterMinimumValue, parameterMaximumValue, parameterDefaultValue,
      normalizationPosition.minimum, normalizationPosition.maximum, normalizationPosition.defalut,
      isInverted
    ) * weight;
}
/** @ref cubismphysics.ts:934 */
function getInputTranslationYFromNormalizedParamterValue(targetTranslation, targetAngle, value, parameterMinimumValue, parameterMaximumValue, parameterDefaultValue, normalizationPosition, normalizationAngle, isInverted, weight) {
  targetTranslation.y +=
    normalizeParameterValue(
      value, parameterMinimumValue, parameterMaximumValue, parameterDefaultValue,
      normalizationPosition.minimum, normalizationPosition.maximum, normalizationPosition.defalut,
      isInverted
    ) * weight;
}
/** @ref cubismphysics.ts:959 */
function getInputAngleFromNormalizedParameterValue(targetTranslation, targetAngle, value, parameterMinimumValue, parameterMaximumValue, parameterDefaultValue, normalizationPosition, normalizationAngle, isInverted, weight) {
  targetAngle.angle +=
    normalizeParameterValue(
      value, parameterMinimumValue, parameterMaximumValue, parameterDefaultValue,
      normalizationAngle.minimum, normalizationAngle.maximum, normalizationAngle.defalut,
      isInverted
    ) * weight;
}

/**
 * @ref cubismphysics.ts:1277.
 * NOTE: returns `result * -1.0` when isInverted=false. This is the upstream
 * "flip-by-default" convention — a Cubism-format `Reflect=false` means the
 * normalised contribution is negated. v3's previous Verlet integrator did
 * NOT flip; that's one of the seven divergence sources documented in
 * `CUBISM_PHYSICS_PORT_PHASE0_FINDINGS.md`. This kernel preserves the
 * Cubism semantics — round-tripped physics3.json rules now behave per the
 * authored intent.
 */
function normalizeParameterValue(value, parameterMinimum, parameterMaximum, parameterDefault, normalizedMinimum, normalizedMaximum, normalizedDefault, isInverted) {
  let result = 0.0;
  const maxValue = Math.max(parameterMaximum, parameterMinimum);
  if (maxValue < value) value = maxValue;
  const minValue = Math.min(parameterMaximum, parameterMinimum);
  if (minValue > value) value = minValue;

  const minNormValue = Math.min(normalizedMinimum, normalizedMaximum);
  const maxNormValue = Math.max(normalizedMinimum, normalizedMaximum);
  const middleNormValue = normalizedDefault;
  const middleValue = getDefaultValue(minValue, maxValue);
  const paramValue = value - middleValue;

  switch (sign(paramValue)) {
    case 1: {
      const nLength = maxNormValue - middleNormValue;
      const pLength = maxValue - middleValue;
      if (pLength !== 0.0) { result = paramValue * (nLength / pLength); result += middleNormValue; }
      break;
    }
    case -1: {
      const nLength = minNormValue - middleNormValue;
      const pLength = minValue - middleValue;
      if (pLength !== 0.0) { result = paramValue * (nLength / pLength); result += middleNormValue; }
      break;
    }
    case 0: { result = middleNormValue; break; }
  }
  return isInverted ? result : result * -1.0;
}

/** @ref cubismphysics.ts:1086 — updateParticles. See the oracle doc-comment for an algorithm walkthrough. */
function updateParticles(strand, strandCount, totalTranslation, totalAngle, windDirection, thresholdValue, deltaTimeSeconds, airResistance) {
  strand[0].position = { x: totalTranslation.x, y: totalTranslation.y };

  const totalRadian = degreesToRadian(totalAngle);
  const currentGravity = radianToDirection(totalRadian);
  vec2Normalize(currentGravity);

  for (let i = 1; i < strandCount; i++) {
    strand[i].force = {
      x: currentGravity.x * strand[i].acceleration + windDirection.x,
      y: currentGravity.y * strand[i].acceleration + windDirection.y,
    };
    strand[i].lastPosition = { x: strand[i].position.x, y: strand[i].position.y };

    const delay = strand[i].delay * deltaTimeSeconds * 30.0;

    let direction = {
      x: strand[i].position.x - strand[i - 1].position.x,
      y: strand[i].position.y - strand[i - 1].position.y,
    };
    const radian = directionToRadian(strand[i].lastGravity, currentGravity) / airResistance;

    // BUG-COMPATIBLE rotation: upstream rewrites direction.x before computing direction.y.
    // @ref cubismphysics.ts:1131-1136
    direction.x = Math.cos(radian) * direction.x - direction.y * Math.sin(radian);
    direction.y = Math.sin(radian) * direction.x + direction.y * Math.cos(radian);

    strand[i].position = {
      x: strand[i - 1].position.x + direction.x,
      y: strand[i - 1].position.y + direction.y,
    };
    const velocity = { x: strand[i].velocity.x * delay, y: strand[i].velocity.y * delay };
    const force = { x: strand[i].force.x * delay * delay, y: strand[i].force.y * delay * delay };
    strand[i].position = {
      x: strand[i].position.x + velocity.x + force.x,
      y: strand[i].position.y + velocity.y + force.y,
    };

    let newDirection = {
      x: strand[i].position.x - strand[i - 1].position.x,
      y: strand[i].position.y - strand[i - 1].position.y,
    };
    vec2Normalize(newDirection);
    strand[i].position = {
      x: strand[i - 1].position.x + newDirection.x * strand[i].radius,
      y: strand[i - 1].position.y + newDirection.y * strand[i].radius,
    };

    if (Math.abs(strand[i].position.x) < thresholdValue) strand[i].position.x = 0.0;

    if (delay !== 0.0) {
      strand[i].velocity = {
        x: (strand[i].position.x - strand[i].lastPosition.x) / delay * strand[i].mobility,
        y: (strand[i].position.y - strand[i].lastPosition.y) / delay * strand[i].mobility,
      };
    }
    strand[i].force = { x: 0.0, y: 0.0 };
    strand[i].lastGravity = { x: currentGravity.x, y: currentGravity.y };
  }
}

/** @ref cubismphysics.ts:1238 — updateOutputParameterValue. */
function updateOutputParameterValue(parameterValueRef, parameterValueMinimum, parameterValueMaximum, translation, output) {
  const outputScale = output.getScale(output.translationScale, output.angleScale);
  let value = translation * outputScale;

  if (value < parameterValueMinimum) {
    if (value < output.valueBelowMinimum) output.valueBelowMinimum = value;
    value = parameterValueMinimum;
  } else if (value > parameterValueMaximum) {
    if (value > output.valueExceededMaximum) output.valueExceededMaximum = value;
    value = parameterValueMaximum;
  }

  const weight = output.weight / MaximumWeight;
  if (weight >= 1.0) {
    parameterValueRef.value = value;
  } else {
    value = parameterValueRef.value * (1.0 - weight) + value * weight;
    parameterValueRef.value = value;
  }
}

// ---------- v3 rule → kernel rig adapter ----------

/**
 * Build a kernel rig from a list of v3-shape resolved physics rules.
 *
 * v3 rule fields (from physicsConfig.resolvePhysicsRules / parsePhysics3Json):
 *   inputs[].{paramId, type:'SRC_TO_X|Y|G_ANGLE', weight, isReverse}
 *   outputs[].{paramId, vertexIndex, scale, isReverse}
 *   vertices[].{x, y, mobility, delay, acceleration, radius}
 *   normalization.{posMin, posMax, angleMin, angleMax, posDef?, angleDef?}
 *
 * Mapped to Cubism's flat rig (one "subRig" per v3 rule). Per-output type is
 * inferred from the v3 field shape — v3 rules always have a single `scale`,
 * which in physics3.json semantics maps to:
 *   - For type Angle: angleScale
 *   - For type X: translationScale.x
 *   - For type Y: translationScale.y
 * v3 rules are always **angle outputs** in practice (writeRuleOutputs in the
 * legacy verlet kernel did not switch on type). The kernel preserves Cubism's
 * full output-type dispatch — if a future rule emits X/Y, it will work. For
 * back-compat with the existing rules, we default to Angle.
 *
 * @param {Array<object>} rules
 * @returns {object} kernel rig (CubismPhysicsRig-shape)
 */
function buildRigFromV3Rules(rules) {
  const rig = {
    gravity: { x: 0, y: 0 },                          // overwritten to (0, 0) per @ref :55
    wind: { x: 0, y: 0 },
    fps: 0,                                           // v3 rules don't carry fps; kernel uses dt directly
    subRigCount: 0,
    settings: [],
    inputs: [],
    outputs: [],
    particles: [],
  };
  const ruleIdToSettingIndex = new Map();

  for (const rule of rules) {
    if (!rule || !Array.isArray(rule.vertices) || rule.vertices.length < 2) continue;
    if (!Array.isArray(rule.outputs) || rule.outputs.length === 0) continue;
    if (!Array.isArray(rule.inputs) || rule.inputs.length === 0) continue;

    const norm = rule.normalization ?? {};
    const sub = {
      ruleId: rule.id,
      ruleName: rule.name,
      normalizationPosition: {
        minimum: norm.posMin ?? -10,
        maximum: norm.posMax ??  10,
        defalut: norm.posDef ??   0,                  // typo from upstream preserved
      },
      normalizationAngle: {
        minimum: norm.angleMin ?? -10,
        maximum: norm.angleMax ??  10,
        defalut: norm.angleDef ??   0,
      },
      inputCount:    rule.inputs.length,
      outputCount:   rule.outputs.length,
      particleCount: rule.vertices.length,
      baseInputIndex:    rig.inputs.length,
      baseOutputIndex:   rig.outputs.length,
      baseParticleIndex: rig.particles.length,
    };

    for (const inp of rule.inputs) {
      const sourceType = V3_TYPE_TO_SOURCE[inp.type] ?? Source_Angle;
      const input = {
        source: { targetType: 0, id: inp.paramId },
        sourceParameterIndex: -1,
        weight: inp.weight ?? 0,
        reflect: !!inp.isReverse,                     // wire-format identity
        type: sourceType,
        getNormalizedParameterValue: null,
      };
      if      (sourceType === Source_X)     input.getNormalizedParameterValue = getInputTranslationXFromNormalizedParameterValue;
      else if (sourceType === Source_Y)     input.getNormalizedParameterValue = getInputTranslationYFromNormalizedParamterValue;
      else                                  input.getNormalizedParameterValue = getInputAngleFromNormalizedParameterValue;
      rig.inputs.push(input);
    }

    for (const out of rule.outputs) {
      const output = {
        destination: { targetType: 0, id: out.paramId },
        destinationParameterIndex: -1,
        vertexIndex: out.vertexIndex ?? 1,
        translationScale: { x: out.scale ?? 0, y: out.scale ?? 0 },
        angleScale: out.scale ?? 0,
        weight: out.weight ?? 100,                    // physics3.json defaults to 100
        reflect: !!out.isReverse,
        type: Source_Angle,                           // see doc-comment above
        valueBelowMinimum: 0,
        valueExceededMaximum: 0,
        getValue: getOutputAngle,
        getScale: getOutputScaleAngle,
      };
      // Future-proof for X/Y outputs (not currently emitted by v3, but the
      // kernel honours physics3.json round-trip).
      if (out.type === 'X')      { output.type = Source_X;     output.getValue = getOutputTranslationX; output.getScale = getOutputScaleTranslationX; }
      else if (out.type === 'Y') { output.type = Source_Y;     output.getValue = getOutputTranslationY; output.getScale = getOutputScaleTranslationY; }
      rig.outputs.push(output);
    }

    for (const v of rule.vertices) {
      rig.particles.push({
        initialPosition: { x: 0, y: 0 },
        mobility: v.mobility ?? 0,
        delay:    v.delay    ?? 0,
        acceleration: v.acceleration ?? 0,
        radius:   v.radius   ?? 0,
        position: { x: v.x ?? 0, y: v.y ?? 0 },
        lastPosition: { x: 0, y: 0 },
        lastGravity:  { x: 0, y: -1 },
        force:    { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
      });
    }

    ruleIdToSettingIndex.set(rule.id, rig.settings.length);
    rig.settings.push(sub);
  }

  rig.subRigCount = rig.settings.length;
  return { rig, ruleIdToSettingIndex };
}

/** @ref cubismphysics.ts:804 — initialize: reset particles to chain layout. */
function initializeParticles(rig) {
  for (let settingIndex = 0; settingIndex < rig.subRigCount; settingIndex++) {
    const sub = rig.settings[settingIndex];
    const strand = rig.particles.slice(sub.baseParticleIndex, sub.baseParticleIndex + sub.particleCount);

    strand[0].initialPosition = { x: 0.0, y: 0.0 };
    strand[0].lastPosition = { x: 0.0, y: 0.0 };
    strand[0].lastGravity = { x: 0.0, y: 1.0 };       // = -1 then *= -1 per @ref :825-826
    strand[0].velocity = { x: 0.0, y: 0.0 };
    strand[0].force = { x: 0.0, y: 0.0 };

    for (let i = 1; i < sub.particleCount; i++) {
      strand[i].initialPosition = {
        x: strand[i - 1].initialPosition.x + 0,
        y: strand[i - 1].initialPosition.y + strand[i].radius,
      };
      strand[i].position = { x: strand[i].initialPosition.x, y: strand[i].initialPosition.y };
      strand[i].lastPosition = { x: strand[i].initialPosition.x, y: strand[i].initialPosition.y };
      strand[i].lastGravity = { x: 0.0, y: 1.0 };
      strand[i].velocity = { x: 0.0, y: 0.0 };
      strand[i].force = { x: 0.0, y: 0.0 };
    }
  }
}

// ---------- public API ----------

/**
 * @typedef {Object} KernelState
 * @property {object} rig                       — flat Cubism-shape rig
 * @property {Map<string, number>} ruleIdToSettingIndex
 * @property {Array<{outputs: number[]}>} currentRigOutputs
 * @property {Array<{outputs: number[]}>} previousRigOutputs
 * @property {number} currentRemainTime         — accumulator from last evaluate
 * @property {Float32Array|null} parameterCaches
 * @property {Float32Array|null} parameterInputCaches
 * @property {string[]} paramIds                — stable index order
 * @property {{gravity:{x:number,y:number}, wind:{x:number,y:number}}} options
 */

/**
 * Build kernel state from v3 rules + parameter spec map.
 *
 * @param {Array<object>} rules
 * @param {Map<string,{min:number,max:number,default:number}>} _paramSpecs  — currently unused (kept for symmetry; specs read on tick)
 * @returns {KernelState}
 */
export function createKernelState(rules, _paramSpecs) {
  const { rig, ruleIdToSettingIndex } = buildRigFromV3Rules(rules);
  initializeParticles(rig);

  const currentRigOutputs = [];
  const previousRigOutputs = [];
  for (const sub of rig.settings) {
    currentRigOutputs.push({ outputs: new Array(sub.outputCount).fill(0) });
    previousRigOutputs.push({ outputs: new Array(sub.outputCount).fill(0) });
  }

  return {
    rig,
    ruleIdToSettingIndex,
    currentRigOutputs,
    previousRigOutputs,
    currentRemainTime: 0,
    parameterCaches: null,
    parameterInputCaches: null,
    paramIds: [],
    options: { gravity: { x: 0.0, y: -1.0 }, wind: { x: 0.0, y: 0.0 } },
  };
}

/**
 * Tick the kernel forward by `dtSeconds`.
 *
 * @param {KernelState} state                  — created by createKernelState
 * @param {Object<string,number>} paramValues — input + output param map; mutated in place for outputs
 * @param {Map<string,{min:number,max:number,default:number}>} paramSpecs
 * @param {number} dtSeconds                  — elapsed time since last tick
 * @returns {{stepsApplied:number, outputsChanged:number}}
 */
export function kernelTick(state, paramValues, paramSpecs, dtSeconds) {
  if (!state || !state.rig || state.rig.subRigCount === 0) {
    return { stepsApplied: 0, outputsChanged: 0 };
  }
  const dt = Math.max(0, Math.min(dtSeconds, MaxDeltaTime));
  if (dt <= 0) return { stepsApplied: 0, outputsChanged: 0 };

  // 1. Build / refresh the kernel-internal param-pool index.
  //    The rig holds string ids; this maps them to consecutive integer indices.
  //    Param ids appearing only as outputs are also indexed (so destination
  //    lookups succeed). Cached on `state.paramIds` so we don't re-scan unless
  //    the input keyset changes.
  const allIds = collectAllRigParamIds(state.rig);
  if (state.paramIds.length !== allIds.length || !arraysEqual(state.paramIds, allIds)) {
    state.paramIds = allIds;
    // Reset sourceParameterIndex so they're re-resolved on this tick.
    for (const inp of state.rig.inputs) inp.sourceParameterIndex = -1;
    for (const out of state.rig.outputs) out.destinationParameterIndex = -1;
    state.parameterCaches = null;
    state.parameterInputCaches = null;
  }
  const N = state.paramIds.length;

  // 2. Materialise per-tick float arrays from paramValues + paramSpecs.
  //    These mirror Cubism's parameterValues / parameterMaximumValues / etc.
  const parameterValues = new Float32Array(N);
  const parameterMinimumValues = new Float32Array(N);
  const parameterMaximumValues = new Float32Array(N);
  const parameterDefaultValues = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const id = state.paramIds[i];
    const spec = paramSpecs.get(id) ?? { min: -1, max: 1, default: 0 };
    const raw = paramValues[id];
    parameterValues[i] = (typeof raw === 'number' && Number.isFinite(raw)) ? raw : (spec.default ?? 0);
    parameterMinimumValues[i] = spec.min;
    parameterMaximumValues[i] = spec.max;
    parameterDefaultValues[i] = spec.default;
  }

  // Lazy-init param caches.
  if (!state.parameterCaches || state.parameterCaches.length < N) {
    state.parameterCaches = new Float32Array(N);
  }
  if (!state.parameterInputCaches || state.parameterInputCaches.length < N) {
    state.parameterInputCaches = new Float32Array(N);
    for (let j = 0; j < N; j++) state.parameterInputCaches[j] = parameterValues[j];
  }

  // 3. Cubism evaluate(). @ref cubismphysics.ts:485
  let physicsDeltaTime;
  state.currentRemainTime += dt;
  if (state.currentRemainTime > MaxDeltaTime) state.currentRemainTime = 0.0;

  if (state.rig.fps > 0.0) physicsDeltaTime = 1.0 / state.rig.fps;
  else                     physicsDeltaTime = dt;

  let stepsApplied = 0;

  while (state.currentRemainTime >= physicsDeltaTime) {
    // copy current → previous
    for (let settingIndex = 0; settingIndex < state.rig.subRigCount; settingIndex++) {
      const sub = state.rig.settings[settingIndex];
      for (let i = 0; i < sub.outputCount; i++) {
        state.previousRigOutputs[settingIndex].outputs[i] = state.currentRigOutputs[settingIndex].outputs[i];
      }
    }

    // input cache lerp. @ref :552-558
    const inputWeight = physicsDeltaTime / state.currentRemainTime;
    for (let j = 0; j < N; j++) {
      state.parameterCaches[j] = state.parameterInputCaches[j] * (1.0 - inputWeight) + parameterValues[j] * inputWeight;
      state.parameterInputCaches[j] = state.parameterCaches[j];
    }

    for (let settingIndex = 0; settingIndex < state.rig.subRigCount; settingIndex++) {
      const totalAngle = { angle: 0.0 };
      const totalTranslation = { x: 0.0, y: 0.0 };
      const sub = state.rig.settings[settingIndex];
      const inputs = state.rig.inputs.slice(sub.baseInputIndex, sub.baseInputIndex + sub.inputCount);
      const outputs = state.rig.outputs.slice(sub.baseOutputIndex, sub.baseOutputIndex + sub.outputCount);
      const particles = state.rig.particles.slice(sub.baseParticleIndex, sub.baseParticleIndex + sub.particleCount);

      // Inputs.
      for (let i = 0; i < sub.inputCount; i++) {
        const w = inputs[i].weight / MaximumWeight;
        if (inputs[i].sourceParameterIndex === -1) {
          inputs[i].sourceParameterIndex = state.paramIds.indexOf(inputs[i].source.id);
        }
        const idx = inputs[i].sourceParameterIndex;
        if (idx === -1) continue;
        inputs[i].getNormalizedParameterValue(
          totalTranslation, totalAngle,
          state.parameterCaches[idx],
          parameterMinimumValues[idx], parameterMaximumValues[idx], parameterDefaultValues[idx],
          sub.normalizationPosition, sub.normalizationAngle,
          inputs[i].reflect, w
        );
      }

      // Rotate translation by -totalAngle. BUG-COMPATIBLE @ref :603-610
      const radAngle = degreesToRadian(-totalAngle.angle);
      totalTranslation.x = totalTranslation.x * Math.cos(radAngle) - totalTranslation.y * Math.sin(radAngle);
      totalTranslation.y = totalTranslation.x * Math.sin(radAngle) + totalTranslation.y * Math.cos(radAngle);

      updateParticles(
        particles, sub.particleCount,
        totalTranslation, totalAngle.angle,
        state.options.wind,
        MovementThreshold * sub.normalizationPosition.maximum,
        physicsDeltaTime, AirResistance
      );

      // Outputs.
      for (let i = 0; i < sub.outputCount; i++) {
        const particleIndex = outputs[i].vertexIndex;
        if (outputs[i].destinationParameterIndex === -1) {
          outputs[i].destinationParameterIndex = state.paramIds.indexOf(outputs[i].destination.id);
        }
        const dstIdx = outputs[i].destinationParameterIndex;
        if (particleIndex < 1 || particleIndex >= sub.particleCount) continue;
        if (dstIdx === -1) continue;

        const translation = {
          x: particles[particleIndex].position.x - particles[particleIndex - 1].position.x,
          y: particles[particleIndex].position.y - particles[particleIndex - 1].position.y,
        };
        const outputValue = outputs[i].getValue(
          translation, particles, particleIndex, outputs[i].reflect, state.options.gravity
        );
        state.currentRigOutputs[settingIndex].outputs[i] = outputValue;

        const paramRef = { value: state.parameterCaches[dstIdx] };
        updateOutputParameterValue(
          paramRef,
          parameterMinimumValues[dstIdx], parameterMaximumValues[dstIdx],
          outputValue, outputs[i]
        );
        state.parameterCaches[dstIdx] = paramRef.value;
      }
    }
    state.currentRemainTime -= physicsDeltaTime;
    stepsApplied++;
  }

  // 4. Final interpolation. @ref :691-693 — writes back into parameterValues.
  const alpha = state.currentRemainTime / physicsDeltaTime;
  let outputsChanged = 0;
  for (let settingIndex = 0; settingIndex < state.rig.subRigCount; settingIndex++) {
    const sub = state.rig.settings[settingIndex];
    const outputs = state.rig.outputs.slice(sub.baseOutputIndex, sub.baseOutputIndex + sub.outputCount);

    for (let i = 0; i < sub.outputCount; i++) {
      if (outputs[i].destinationParameterIndex === -1) continue;
      const dstIdx = outputs[i].destinationParameterIndex;
      const blended =
        state.previousRigOutputs[settingIndex].outputs[i] * (1 - alpha) +
        state.currentRigOutputs[settingIndex].outputs[i] * alpha;

      const paramRef = { value: parameterValues[dstIdx] };
      updateOutputParameterValue(
        paramRef,
        parameterMinimumValues[dstIdx], parameterMaximumValues[dstIdx],
        blended, outputs[i]
      );
      parameterValues[dstIdx] = paramRef.value;
    }
  }

  // 5. Write OUTPUT param values back into the user-facing paramValues map.
  //    (Inputs were already there; we don't overwrite them.)
  const outputIds = new Set();
  for (const out of state.rig.outputs) outputIds.add(out.destination.id);
  for (const id of outputIds) {
    const idx = state.paramIds.indexOf(id);
    if (idx === -1) continue;
    const newVal = parameterValues[idx];
    const prev = paramValues[id];
    if (typeof prev !== 'number' || Math.abs(prev - newVal) > 1e-5) {
      paramValues[id] = newVal;
      outputsChanged++;
    }
  }

  return { stepsApplied, outputsChanged };
}

/** Reset particle positions to chain layout — useful after rig changes. */
export function kernelReset(state) {
  if (!state || !state.rig) return;
  initializeParticles(state.rig);
  for (const sub of state.currentRigOutputs) sub.outputs.fill(0);
  for (const sub of state.previousRigOutputs) sub.outputs.fill(0);
  state.currentRemainTime = 0;
  state.parameterCaches = null;
  state.parameterInputCaches = null;
  for (const inp of state.rig.inputs) inp.sourceParameterIndex = -1;
  for (const out of state.rig.outputs) out.destinationParameterIndex = -1;
}

// ---------- helpers ----------

function collectAllRigParamIds(rig) {
  const set = new Set();
  for (const inp of rig.inputs)  set.add(inp.source.id);
  for (const out of rig.outputs) set.add(out.destination.id);
  return Array.from(set);
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Internals exported for tests.
export const __testing__ = {
  AirResistance, MaximumWeight, MovementThreshold, MaxDeltaTime,
  Source_X, Source_Y, Source_Angle,
  buildRigFromV3Rules, initializeParticles,
  updateParticles, updateOutputParameterValue, normalizeParameterValue,
  directionToRadian, radianToDirection, degreesToRadian,
};
