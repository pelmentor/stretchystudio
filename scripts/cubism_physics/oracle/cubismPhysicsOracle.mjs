/**
 * Cubism Physics Oracle — pure-JS transcription of Cubism Web Framework's
 * `CubismPhysics`. Used as the byte-faithful reference for v3's runtime physics
 * port (see `docs/live2d-export/CUBISM_PHYSICS_PORT.md`).
 *
 * Source snapshot: `reference/cubism-web-framework/physics/`
 *   - cubismphysics.ts (kernel: evaluate, updateParticles, updateOutputParameterValue, normalizeParameterValue)
 *   - cubismphysicsinternal.ts (CubismPhysicsRig, Input, Output, Particle, SubRig, Normalization)
 *   - _dep_cubismvector2.ts (CubismVector2)
 *   - _dep_cubismmath.ts (CubismMath)
 *
 * Each function carries a `// @ref cubismphysics.ts:NNN` line referencing the
 * upstream line so divergence can be traced to a specific upstream branch.
 *
 * Design notes:
 * - The TS source's public API takes `CubismModel` (which transitively pulls in
 *   Live2DCubismCore .wasm). For the oracle we replace that with a plain
 *   `parameterPool` object: `{values, minimumValues, maximumValues, defaultValues, ids}`.
 *   `getParameterIndex(id)` is implemented as `ids.indexOf(id)`.
 * - `CubismPhysicsJson` is bypassed entirely. `setRig(rigJson)` populates the
 *   internal rig from a parsed `physics3.json` object directly. The mapping
 *   matches the parser's behaviour line-for-line — see `setRig` below.
 * - `CubismVector2` is replaced with plain `{x, y}` literals + inlined math
 *   (the TS source has lots of `new CubismVector2(...)`; the algorithm result
 *   is identical with object-literal vectors).
 *
 * Constants and behavioural quirks preserved:
 * - AirResistance = 5.0 (rotation toward gravity is divided by this each frame)
 * - MaximumWeight = 100.0 (input/output weight normalisation)
 * - MovementThreshold = 0.001 (sub-threshold X positions snap to 0)
 * - MaxDeltaTime = 5.0 (>5s elapsed → reset accumulator)
 * - normalizeParameterValue returns `result * -1.0` when isInverted=false
 *   (yes, the inverted-by-default sign convention; see @ref :1347)
 * - delay is scaled by `dt * 30` (the "30 fps reference" frame-rate compensation)
 * - Output blending: weight>=1 hard-replaces param; <1 lerps with previous
 * - Frame-rate decoupling via _currentRemainTime accumulator @ 1/fps if fps>0
 * - Inter-frame interpolation via _previousRigOutputs / _currentRigOutputs
 *
 * @module scripts/cubism_physics/oracle/cubismPhysicsOracle
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

// ---------- math helpers (transcribed from _dep_cubismmath.ts) ----------

/** @ref _dep_cubismmath.ts:154 */
function degreesToRadian(d) { return (d / 180.0) * Math.PI; }

/** @ref _dep_cubismmath.ts:175 — directionToRadian(from, to) returns a wrapped (-π..π) angle */
function directionToRadian(from, to) {
  const q1 = Math.atan2(to.y, to.x);
  const q2 = Math.atan2(from.y, from.x);
  let ret = q1 - q2;
  while (ret < -Math.PI) ret += Math.PI * 2.0;
  while (ret >  Math.PI) ret -= Math.PI * 2.0;
  return ret;
}

/** @ref _dep_cubismmath.ts:217 — radianToDirection: (sin(θ), cos(θ)). Note: not standard polar; +x = sin, +y = cos. */
function radianToDirection(totalAngle) {
  return { x: Math.sin(totalAngle), y: Math.cos(totalAngle) };
}

/** Inline normalize on a {x,y} literal (mutates). @ref _dep_cubismvector2.ts:132 */
function vec2Normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len > 0) {
    v.x = v.x / len;
    v.y = v.y / len;
  }
}

// ---------- standalone functions (file-scope helpers in cubismphysics.ts) ----------

/** @ref cubismphysics.ts:897 */
function sign(value) {
  if (value > 0.0) return 1;
  if (value < 0.0) return -1;
  return 0;
}

/** @ref cubismphysics.ts:1041 */
function getRangeValue(min, max) {
  const maxValue = Math.max(min, max);
  const minValue = Math.min(min, max);
  return Math.abs(maxValue - minValue);
}

/** @ref cubismphysics.ts:1048 */
function getDefaultValue(min, max) {
  const minValue = Math.min(min, max);
  return minValue + getRangeValue(min, max) / 2.0;
}

/** @ref cubismphysics.ts:984 */
function getOutputTranslationX(translation, particles, particleIndex, isInverted, parentGravity) {
  let outputValue = translation.x;
  if (isInverted) outputValue *= -1.0;
  return outputValue;
}

/** @ref cubismphysics.ts:1000 */
function getOutputTranslationY(translation, particles, particleIndex, isInverted, parentGravity) {
  let outputValue = translation.y;
  if (isInverted) outputValue *= -1.0;
  return outputValue;
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
  let outputValue = directionToRadian(pg, translation);
  if (isInverted) outputValue *= -1.0;
  return outputValue;
}

/** @ref cubismphysics.ts:1053 */
function getOutputScaleTranslationX(translationScale, angleScale) { return translationScale.x; }

/** @ref cubismphysics.ts:1060 */
function getOutputScaleTranslationY(translationScale, angleScale) { return translationScale.y; }

/** @ref cubismphysics.ts:1067 */
function getOutputScaleAngle(translationScale, angleScale) { return angleScale; }

/** @ref cubismphysics.ts:909 — input X normalised contribution */
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
 * @ref cubismphysics.ts:1277 — normalizeParameterValue.
 * NOTE the sign-flip at @ref :1347: returns `result * -1.0` when isInverted=false.
 * This bakes the upstream convention "inverted=on means uninverted" into the kernel.
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
      if (pLength !== 0.0) {
        result = paramValue * (nLength / pLength);
        result += middleNormValue;
      }
      break;
    }
    case -1: {
      const nLength = minNormValue - middleNormValue;
      const pLength = minValue - middleValue;
      if (pLength !== 0.0) {
        result = paramValue * (nLength / pLength);
        result += middleNormValue;
      }
      break;
    }
    case 0: {
      result = middleNormValue;
      break;
    }
  }
  return isInverted ? result : result * -1.0;
}

/**
 * @ref cubismphysics.ts:1086 — updateParticles. Cubism's pendulum integration:
 *   1. anchor[0] = totalTranslation
 *   2. for each subsequent particle:
 *      - force = currentGravity * acceleration + windDirection
 *      - lastPosition = position (snapshot before integration)
 *      - delay = particle.delay * dt * 30
 *      - direction = position - parent.position; rotate it toward currentGravity by `directionToRadian(lastGravity, currentGravity) / 5.0` rad
 *      - position = parent + direction
 *      - position += velocity * delay + force * delay²
 *      - newDirection = (position - parent).normalize(); position = parent + newDirection * radius   (rod constraint)
 *      - if |position.x| < threshold → position.x = 0
 *      - if delay != 0: velocity = (position - lastPosition) / delay * mobility
 *      - reset force, lastGravity = currentGravity
 */
function updateParticles(strand, strandCount, totalTranslation, totalAngle, windDirection, thresholdValue, deltaTimeSeconds, airResistance) {
  // strand[0].position = totalTranslation
  strand[0].position = { x: totalTranslation.x, y: totalTranslation.y };

  const totalRadian = degreesToRadian(totalAngle);
  const currentGravity = radianToDirection(totalRadian);
  vec2Normalize(currentGravity);

  for (let i = 1; i < strandCount; i++) {
    // force = currentGravity * acceleration + windDirection
    strand[i].force = {
      x: currentGravity.x * strand[i].acceleration + windDirection.x,
      y: currentGravity.y * strand[i].acceleration + windDirection.y,
    };

    // lastPosition snapshot
    strand[i].lastPosition = { x: strand[i].position.x, y: strand[i].position.y };

    const delay = strand[i].delay * deltaTimeSeconds * 30.0;

    // direction = position - parent.position
    let direction = {
      x: strand[i].position.x - strand[i - 1].position.x,
      y: strand[i].position.y - strand[i - 1].position.y,
    };

    // radian = (angle from lastGravity to currentGravity) / airResistance
    const radian = directionToRadian(strand[i].lastGravity, currentGravity) / airResistance;

    // 2D rotation of direction by radian.
    // BUG-COMPATIBLE: upstream uses the freshly-overwritten direction.x in the y-component math.
    // @ref cubismphysics.ts:1131-1136
    //   direction.x = cos(r)*direction.x - direction.y*sin(r);
    //   direction.y = sin(r)*direction.x + direction.y*cos(r);   ← uses the NEW direction.x
    // We preserve that quirk because it's part of the Cubism behaviour we're matching.
    const oldDx = direction.x;
    direction.x = Math.cos(radian) * direction.x - direction.y * Math.sin(radian);
    direction.y = Math.sin(radian) * direction.x + direction.y * Math.cos(radian);

    // position = parent.position + direction
    strand[i].position = {
      x: strand[i - 1].position.x + direction.x,
      y: strand[i - 1].position.y + direction.y,
    };

    // velocity * delay
    const velocity = {
      x: strand[i].velocity.x * delay,
      y: strand[i].velocity.y * delay,
    };
    // force * delay * delay
    const force = {
      x: strand[i].force.x * delay * delay,
      y: strand[i].force.y * delay * delay,
    };
    strand[i].position = {
      x: strand[i].position.x + velocity.x + force.x,
      y: strand[i].position.y + velocity.y + force.y,
    };

    // rod constraint: re-normalise (position - parent) and scale by radius
    let newDirection = {
      x: strand[i].position.x - strand[i - 1].position.x,
      y: strand[i].position.y - strand[i - 1].position.y,
    };
    vec2Normalize(newDirection);
    strand[i].position = {
      x: strand[i - 1].position.x + newDirection.x * strand[i].radius,
      y: strand[i - 1].position.y + newDirection.y * strand[i].radius,
    };

    if (Math.abs(strand[i].position.x) < thresholdValue) {
      strand[i].position.x = 0.0;
    }

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

/**
 * @ref cubismphysics.ts:1238 — updateOutputParameterValue.
 * @param parameterValueRef one-element {value} reference (replaces Float32Array[0])
 */
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

// ---------- Main class ----------

/**
 * @ref cubismphysics.ts:44 — CubismPhysics class, transcribed.
 * Public API mirrors upstream:
 *   const phys = new CubismPhysicsOracle();
 *   phys.setRig(physicsRigJson);     // parsed physics3.json
 *   phys.setParameterPool(pool);     // { values, ids, minimumValues, maximumValues, defaultValues }
 *   phys.evaluate(deltaTimeSeconds); // mutates pool.values for output params
 */
export class CubismPhysicsOracle {
  constructor() {
    this._physicsRig = null;
    // @ref cubismphysics.ts:781-790 — default Options
    this._options = {
      gravity: { x: 0.0, y: -1.0 },
      wind: { x: 0.0, y: 0.0 },
    };
    this._currentRigOutputs = [];
    this._previousRigOutputs = [];
    this._currentRemainTime = 0.0;
    this._parameterCaches = null;
    this._parameterInputCaches = null;
    this._pool = null;
  }

  setOptions(options) { this._options = options; }
  getOption() { return this._options; }
  getRig() { return this._physicsRig; }

  /**
   * Initialise the rig from a parsed physics3.json object. Mirrors the
   * `parse(...)` method byte-for-byte except we skip CubismPhysicsJson and
   * read the JSON directly. The mapping below follows cubismphysicsjson.ts
   * exactly — see the @ref tags.
   *
   * @param json parsed physics3.json
   */
  setRig(json) {
    const meta = json.Meta || {};
    const settings = json.PhysicsSettings || [];

    this._physicsRig = {
      // @ref cubismphysics.ts:81-85
      gravity: { x: meta.EffectiveForces?.Gravity?.X ?? 0, y: meta.EffectiveForces?.Gravity?.Y ?? 0 },
      wind:    { x: meta.EffectiveForces?.Wind?.X ?? 0,    y: meta.EffectiveForces?.Wind?.Y ?? 0    },
      subRigCount: meta.PhysicsSettingCount ?? settings.length,
      fps: meta.Fps ?? 0,
      settings: [],
      inputs: [],
      outputs: [],
      particles: [],
    };
    // @ref cubismphysics.ts:55 — gravity.y = 0 after create(). The physics3.json
    // gravity is overwritten; only Options.gravity is used in updateParticles.
    this._physicsRig.gravity.y = 0;

    let inputIndex = 0, outputIndex = 0, particleIndex = 0;

    for (let i = 0; i < settings.length; i++) {
      const s = settings[i];
      const norm = s.Normalization || {};

      // SubRig. @ref cubismphysics.ts:122-137
      const sub = {
        normalizationPosition: {
          minimum: norm.Position?.Minimum ?? 0,
          maximum: norm.Position?.Maximum ?? 0,
          defalut: norm.Position?.Default ?? 0,
        },
        normalizationAngle: {
          minimum: norm.Angle?.Minimum ?? 0,
          maximum: norm.Angle?.Maximum ?? 0,
          defalut: norm.Angle?.Default ?? 0,
        },
        inputCount: (s.Input || []).length,
        outputCount: (s.Output || []).length,
        particleCount: (s.Vertices || []).length,
        baseInputIndex: inputIndex,
        baseOutputIndex: outputIndex,
        baseParticleIndex: particleIndex,
      };
      this._physicsRig.settings.push(sub);

      // Inputs. @ref cubismphysics.ts:142-175
      for (let j = 0; j < sub.inputCount; j++) {
        const ij = s.Input[j];
        const inp = {
          source: { targetType: 0, id: ij.Source?.Id ?? '' },
          sourceParameterIndex: -1,
          weight: ij.Weight ?? 0,
          reflect: !!ij.Reflect,
          type: 0,
          getNormalizedParameterValue: null,
        };
        const t = ij.Type;
        if (t === PhysicsTypeTagX) {
          inp.type = Source_X;
          inp.getNormalizedParameterValue = getInputTranslationXFromNormalizedParameterValue;
        } else if (t === PhysicsTypeTagY) {
          inp.type = Source_Y;
          inp.getNormalizedParameterValue = getInputTranslationYFromNormalizedParamterValue;
        } else if (t === PhysicsTypeTagAngle) {
          inp.type = Source_Angle;
          inp.getNormalizedParameterValue = getInputAngleFromNormalizedParameterValue;
        }
        this._physicsRig.inputs.push(inp);
      }
      inputIndex += sub.inputCount;

      // Outputs. @ref cubismphysics.ts:181-242
      const currentRigOutput = { outputs: new Array(sub.outputCount).fill(0) };
      const previousRigOutput = { outputs: new Array(sub.outputCount).fill(0) };
      for (let j = 0; j < sub.outputCount; j++) {
        const oj = s.Output[j];
        const out = {
          destination: { targetType: 0, id: oj.Destination?.Id ?? '' },
          destinationParameterIndex: -1,
          vertexIndex: oj.VertexIndex ?? 0,
          translationScale: { x: oj.TranslationScale?.X ?? 0, y: oj.TranslationScale?.Y ?? 0 },
          angleScale: oj.Scale ?? oj.AngleScale ?? 0,  // physics3.json uses "Scale" for angle outputs
          weight: oj.Weight ?? 0,
          reflect: !!oj.Reflect,
          type: 0,
          valueBelowMinimum: 0,
          valueExceededMaximum: 0,
          getValue: null,
          getScale: null,
        };
        const t = oj.Type;
        if (t === PhysicsTypeTagX) {
          out.type = Source_X;
          out.getValue = getOutputTranslationX;
          out.getScale = getOutputScaleTranslationX;
        } else if (t === PhysicsTypeTagY) {
          out.type = Source_Y;
          out.getValue = getOutputTranslationY;
          out.getScale = getOutputScaleTranslationY;
        } else if (t === PhysicsTypeTagAngle) {
          out.type = Source_Angle;
          out.getValue = getOutputAngle;
          out.getScale = getOutputScaleAngle;
        }
        this._physicsRig.outputs.push(out);
      }
      this._currentRigOutputs.push(currentRigOutput);
      this._previousRigOutputs.push(previousRigOutput);
      outputIndex += sub.outputCount;

      // Particles. @ref cubismphysics.ts:251-265
      for (let j = 0; j < sub.particleCount; j++) {
        const pj = s.Vertices[j];
        this._physicsRig.particles.push({
          initialPosition: { x: 0, y: 0 },
          mobility: pj.Mobility ?? 0,
          delay: pj.Delay ?? 0,
          acceleration: pj.Acceleration ?? 0,
          radius: pj.Radius ?? 0,
          position: { x: pj.Position?.X ?? 0, y: pj.Position?.Y ?? 0 },
          lastPosition: { x: 0, y: 0 },
          lastGravity: { x: 0, y: -1 },
          force: { x: 0, y: 0 },
          velocity: { x: 0, y: 0 },
        });
      }
      particleIndex += sub.particleCount;
    }

    this.initialize();
  }

  /** @ref cubismphysics.ts:804 — initialize: reset particles to chain layout. */
  initialize() {
    for (let settingIndex = 0; settingIndex < this._physicsRig.subRigCount; settingIndex++) {
      const sub = this._physicsRig.settings[settingIndex];
      const strand = this._physicsRig.particles.slice(sub.baseParticleIndex, sub.baseParticleIndex + sub.particleCount);

      strand[0].initialPosition = { x: 0.0, y: 0.0 };
      strand[0].lastPosition = { x: strand[0].initialPosition.x, y: strand[0].initialPosition.y };
      strand[0].lastGravity = { x: 0.0, y: -1.0 };
      strand[0].lastGravity.y *= -1.0;  // y = 1.0 — @ref :826 (yes, it really does this)
      strand[0].velocity = { x: 0.0, y: 0.0 };
      strand[0].force = { x: 0.0, y: 0.0 };

      for (let i = 1; i < sub.particleCount; i++) {
        const radius = { x: 0.0, y: strand[i].radius };
        strand[i].initialPosition = {
          x: strand[i - 1].initialPosition.x + radius.x,
          y: strand[i - 1].initialPosition.y + radius.y,
        };
        strand[i].position = { x: strand[i].initialPosition.x, y: strand[i].initialPosition.y };
        strand[i].lastPosition = { x: strand[i].initialPosition.x, y: strand[i].initialPosition.y };
        strand[i].lastGravity = { x: 0.0, y: -1.0 };
        strand[i].lastGravity.y *= -1.0;  // y = 1.0
        strand[i].velocity = { x: 0.0, y: 0.0 };
        strand[i].force = { x: 0.0, y: 0.0 };
      }
    }
  }

  /**
   * @param pool { ids: string[], values: Float32Array, minimumValues, maximumValues, defaultValues }
   * Replaces CubismModel.getModel().parameters in the upstream signature.
   */
  setParameterPool(pool) {
    this._pool = pool;
  }

  /** @ref cubismphysics.ts:485 — evaluate(model, dt). */
  evaluate(deltaTimeSeconds) {
    if (deltaTimeSeconds <= 0.0) return;
    if (!this._pool) throw new Error('cubismPhysicsOracle: no parameter pool set');
    const { values: parameterValues, minimumValues: parameterMinimumValues, maximumValues: parameterMaximumValues, defaultValues: parameterDefaultValues, ids: parameterIds } = this._pool;
    const parameterCount = parameterIds.length;

    let physicsDeltaTime;
    this._currentRemainTime += deltaTimeSeconds;
    if (this._currentRemainTime > MaxDeltaTime) this._currentRemainTime = 0.0;

    if (!this._parameterCaches || this._parameterCaches.length < parameterCount) {
      this._parameterCaches = new Float32Array(parameterCount);
    }
    if (!this._parameterInputCaches || this._parameterInputCaches.length < parameterCount) {
      this._parameterInputCaches = new Float32Array(parameterCount);
      for (let j = 0; j < parameterCount; j++) this._parameterInputCaches[j] = parameterValues[j];
    }

    if (this._physicsRig.fps > 0.0) {
      physicsDeltaTime = 1.0 / this._physicsRig.fps;
    } else {
      physicsDeltaTime = deltaTimeSeconds;
    }

    while (this._currentRemainTime >= physicsDeltaTime) {
      // copy current → previous
      for (let settingIndex = 0; settingIndex < this._physicsRig.subRigCount; settingIndex++) {
        const sub = this._physicsRig.settings[settingIndex];
        for (let i = 0; i < sub.outputCount; i++) {
          this._previousRigOutputs[settingIndex].outputs[i] = this._currentRigOutputs[settingIndex].outputs[i];
        }
      }

      // input cache lerp. @ref :552-558
      const inputWeight = physicsDeltaTime / this._currentRemainTime;
      for (let j = 0; j < parameterCount; j++) {
        this._parameterCaches[j] =
          this._parameterInputCaches[j] * (1.0 - inputWeight) +
          parameterValues[j] * inputWeight;
        this._parameterInputCaches[j] = this._parameterCaches[j];
      }

      for (let settingIndex = 0; settingIndex < this._physicsRig.subRigCount; settingIndex++) {
        const totalAngle = { angle: 0.0 };
        const totalTranslation = { x: 0.0, y: 0.0 };
        const sub = this._physicsRig.settings[settingIndex];
        const inputs = this._physicsRig.inputs.slice(sub.baseInputIndex, sub.baseInputIndex + sub.inputCount);
        const outputs = this._physicsRig.outputs.slice(sub.baseOutputIndex, sub.baseOutputIndex + sub.outputCount);
        const particles = this._physicsRig.particles.slice(sub.baseParticleIndex, sub.baseParticleIndex + sub.particleCount);

        // Inputs.
        for (let i = 0; i < sub.inputCount; i++) {
          const w = inputs[i].weight / MaximumWeight;
          if (inputs[i].sourceParameterIndex === -1) {
            inputs[i].sourceParameterIndex = parameterIds.indexOf(inputs[i].source.id);
          }
          const idx = inputs[i].sourceParameterIndex;
          if (idx === -1) continue;
          inputs[i].getNormalizedParameterValue(
            totalTranslation, totalAngle,
            this._parameterCaches[idx],
            parameterMinimumValues[idx], parameterMaximumValues[idx], parameterDefaultValues[idx],
            sub.normalizationPosition, sub.normalizationAngle,
            inputs[i].reflect, w
          );
        }

        // Rotate translation by -totalAngle. @ref :603-610
        const radAngle = degreesToRadian(-totalAngle.angle);
        // BUG-COMPATIBLE: upstream uses the freshly-overwritten totalTranslation.x in the y-component math.
        const oldTx = totalTranslation.x;
        totalTranslation.x = totalTranslation.x * Math.cos(radAngle) - totalTranslation.y * Math.sin(radAngle);
        totalTranslation.y = totalTranslation.x * Math.sin(radAngle) + totalTranslation.y * Math.cos(radAngle);

        // Update particles.
        updateParticles(
          particles, sub.particleCount,
          totalTranslation, totalAngle.angle,
          this._options.wind,
          MovementThreshold * sub.normalizationPosition.maximum,
          physicsDeltaTime, AirResistance
        );

        // Write the back-slice changes into the rig (since slice() returns a copy of refs but the elements ARE the same objects).
        // Actually each strand[i] reference IS the same object in this._physicsRig.particles — slice copies the array,
        // not the elements — so position mutations propagate correctly. No write-back needed.

        // Outputs.
        for (let i = 0; i < sub.outputCount; i++) {
          const particleIndex = outputs[i].vertexIndex;
          if (outputs[i].destinationParameterIndex === -1) {
            outputs[i].destinationParameterIndex = parameterIds.indexOf(outputs[i].destination.id);
          }
          const dstIdx = outputs[i].destinationParameterIndex;
          if (particleIndex < 1 || particleIndex >= sub.particleCount) continue;
          if (dstIdx === -1) continue;

          const translation = {
            x: particles[particleIndex].position.x - particles[particleIndex - 1].position.x,
            y: particles[particleIndex].position.y - particles[particleIndex - 1].position.y,
          };
          const outputValue = outputs[i].getValue(
            translation, particles, particleIndex, outputs[i].reflect, this._options.gravity
          );
          this._currentRigOutputs[settingIndex].outputs[i] = outputValue;

          // Apply to parameter cache. @ref :658-686
          const paramRef = { value: this._parameterCaches[dstIdx] };
          updateOutputParameterValue(
            paramRef,
            parameterMinimumValues[dstIdx], parameterMaximumValues[dstIdx],
            outputValue, outputs[i]
          );
          this._parameterCaches[dstIdx] = paramRef.value;
        }
      }
      this._currentRemainTime -= physicsDeltaTime;
    }

    // Final interpolation step. @ref :691-693
    const alpha = this._currentRemainTime / physicsDeltaTime;
    this.interpolate(alpha);
  }

  /** @ref cubismphysics.ts:701 — interpolate previous/current outputs into parameter values. */
  interpolate(weight) {
    const { values: parameterValues, minimumValues, maximumValues } = this._pool;

    for (let settingIndex = 0; settingIndex < this._physicsRig.subRigCount; settingIndex++) {
      const sub = this._physicsRig.settings[settingIndex];
      const outputs = this._physicsRig.outputs.slice(sub.baseOutputIndex, sub.baseOutputIndex + sub.outputCount);

      for (let i = 0; i < sub.outputCount; i++) {
        if (outputs[i].destinationParameterIndex === -1) continue;
        const dstIdx = outputs[i].destinationParameterIndex;
        const blended =
          this._previousRigOutputs[settingIndex].outputs[i] * (1 - weight) +
          this._currentRigOutputs[settingIndex].outputs[i] * weight;

        const paramRef = { value: parameterValues[dstIdx] };
        updateOutputParameterValue(
          paramRef,
          minimumValues[dstIdx], maximumValues[dstIdx],
          blended, outputs[i]
        );
        parameterValues[dstIdx] = paramRef.value;
      }
    }
  }
}

// Internals exported for testing.
export const __testing__ = {
  AirResistance, MaximumWeight, MovementThreshold, MaxDeltaTime,
  Source_X, Source_Y, Source_Angle,
  degreesToRadian, directionToRadian, radianToDirection, vec2Normalize,
  sign, getRangeValue, getDefaultValue,
  getOutputTranslationX, getOutputTranslationY, getOutputAngle,
  getOutputScaleTranslationX, getOutputScaleTranslationY, getOutputScaleAngle,
  getInputTranslationXFromNormalizedParameterValue,
  getInputTranslationYFromNormalizedParamterValue,
  getInputAngleFromNormalizedParameterValue,
  normalizeParameterValue,
  updateParticles, updateOutputParameterValue,
};
