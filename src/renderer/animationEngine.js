/**
 * Animation engine — keyform interpolation utilities.
 *
 * Action data model (stored in project.actions, post-v36):
 *   { id, name, duration (ms), fps,
 *     fcurves: [{ rnaPath, keyforms: [{ time (ms), value, easing, type }] }] }
 *
 * Targets (decoded via `decodeFCurveTarget` from `anim/animationFCurve.js`):
 *   - param target  → `objects["__params__"].values["<paramId>"]`
 *   - node property → `objects["<nodeId>"].<property>` where
 *     property ∈ 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity' |
 *                'visible' | 'mesh_verts' | 'blendShape:{id}'
 */

import { isBoneGroup, getBonePose, setBonePose } from '../store/objectDataAccess.js';
import { decodeFCurveTarget, buildParamFCurve, buildNodeFCurve } from '../anim/animationFCurve.js';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function bezier1D(t, startTension, endTension) {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  return 3 * mt2 * t * startTension + 3 * mt * t2 * endTension + t3;
}

/**
 * 1D Cubic Bezier Solver (X -> Y)
 */
export function evaluateCubicBezier(x, cx1, cy1, cx2, cy2) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (cx1 === cy1 && cx2 === cy2) return x; // Linear shortcut

  // Binary search for t given x
  let lower = 0;
  let upper = 1;
  let t = x;
  
  for (let i = 0; i < 12; i++) {
    const currentX = bezier1D(t, cx1, cx2);
    if (Math.abs(currentX - x) < 0.0001) break;
    if (x > currentX) lower = t;
    else upper = t;
    t = (lower + upper) / 2;
  }
  
  return bezier1D(t, cy1, cy2);
}

/**
 * Evaluate a given easing shape
 */
export function evaluateEasing(t, easing) {
  if (easing === 'linear') return t;
  if (!easing || easing === 'ease' || easing === 'ease-both') {
    // defaults to standard smooth curve (Ease Both)
    return evaluateCubicBezier(t, 0.42, 0, 0.58, 1);
  }
  if (easing === 'ease-in') {
    return evaluateCubicBezier(t, 0.42, 0, 1, 1);
  }
  if (easing === 'ease-out') {
    return evaluateCubicBezier(t, 0, 0, 0.58, 1);
  }
  if (easing === 'stepped') return 0;
  if (Array.isArray(easing) && easing.length === 4) {
    return evaluateCubicBezier(t, easing[0], easing[1], easing[2], easing[3]);
  }
  return t;
}

/**
 * Interpolate a single fcurve's keyforms at the given time (ms).
 * Returns undefined if no keyforms. Operates directly on the
 * `{time, value, easing, type}` array (post-v36 keyform shape) — the
 * accessor surface (`kf.time` / `kf.value` / `kf.easing`) is unchanged
 * from the legacy keyframe shape so the primitive's signature stays
 * stable across the v36 rewire.
 *
 * Function name kept as `interpolateTrack` (rather than
 * `interpolateFCurve`) to avoid colliding with the rich
 * `evaluateFCurve` in `anim/fcurve.js` which handles BezTriples,
 * extrapolation modes, modifiers etc. — this is the lighter ms-native
 * interpolator the legacy SS animation engine ships with.
 */
export function interpolateTrack(keyframes, timeMs, loopKeyframes = false, endMs = 0) {
  if (!keyframes || keyframes.length === 0) return undefined;

  // Clamp to edge values
  if (timeMs <= keyframes[0].time) return keyframes[0].value;
  
  if (timeMs >= keyframes[keyframes.length - 1].time) {
    if (loopKeyframes && timeMs < endMs && keyframes.length > 0) {
      const kLast = keyframes[keyframes.length - 1];
      const kFirst = keyframes[0];
      const t = (timeMs - kLast.time) / (endMs - kLast.time);
      const te = evaluateEasing(t, kLast.easing);
      return lerp(kLast.value, kFirst.value, te);
    }
    return keyframes[keyframes.length - 1].value;
  }

  // Binary search for the surrounding pair
  let lo = 0;
  let hi = keyframes.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid + 1].time <= timeMs) lo = mid + 1;
    else hi = mid;
  }

  const kA = keyframes[lo];
  const kB = keyframes[lo + 1];
  const t  = (timeMs - kA.time) / (kB.time - kA.time);
  const te = evaluateEasing(t, kA.easing); // Easing from the *start* keyframe of the segment

  if (typeof kA.value === 'boolean') {
    // Discrete step interpolation for boolean properties like 'visible'
    return kA.value;
  }

  return lerp(kA.value, kB.value, te);
}

/**
 * Interpolate an array of {x,y} vertex positions between two keyframes.
 * Both keyframe values must have the same vertex count.
 */
function interpolateMeshVerts(keyframes, timeMs, loopKeyframes = false, endMs = 0) {
  if (!keyframes || keyframes.length === 0) return undefined;
  if (timeMs <= keyframes[0].time) return keyframes[0].value;

  if (timeMs >= keyframes[keyframes.length - 1].time) {
    if (loopKeyframes && timeMs < endMs && keyframes.length > 0) {
      const kLast = keyframes[keyframes.length - 1];
      const kFirst = keyframes[0];
      const t = (timeMs - kLast.time) / (endMs - kLast.time);
      const te = evaluateEasing(t, kLast.easing);

      return kLast.value.map((vA, i) => {
        const vB = kFirst.value[i];
        if (!vB) return { x: vA.x, y: vA.y };
        return { x: vA.x + (vB.x - vA.x) * te, y: vA.y + (vB.y - vA.y) * te };
      });
    }
    return keyframes[keyframes.length - 1].value;
  }

  let lo = 0;
  let hi = keyframes.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid + 1].time <= timeMs) lo = mid + 1;
    else hi = mid;
  }

  const kA = keyframes[lo];
  const kB = keyframes[lo + 1];
  const t  = (timeMs - kA.time) / (kB.time - kA.time);
  const te = evaluateEasing(t, kA.easing); // Easing from the *start* keyframe of the segment

  return kA.value.map((vA, i) => {
    const vB = kB.value[i];
    if (!vB) return { x: vA.x, y: vA.y };
    return { x: vA.x + (vB.x - vA.x) * te, y: vA.y + (vB.y - vA.y) * te };
  });
}

/**
 * Compute pose overrides for all node-targeted fcurves in an action at
 * the given time.
 *
 * Walks node-targeted fcurves only — fcurves whose rnaPath decodes to a
 * parameter target (Live2D parameter curves consumed by motion3json +
 * can3writer + chainEval) are handled separately by
 * `computeParamOverrides`. Existing callers (CanvasViewport /
 * SkeletonOverlay / GizmoOverlay) consume only node overrides so this
 * split keeps them working unchanged.
 *
 * @param {Object|null} action     - single action object (project.actions[i])
 * @param {number}      timeMs     - current playhead position in milliseconds
 * @returns {Map<string, Object>}  nodeId → {
 *   x?, y?, rotation?, scaleX?, scaleY?, opacity?,
 *   mesh_verts?: [{x,y},...]
 * }
 */
export function computePoseOverrides(action, timeMs, loopKeyframes = false, endMs = 0) {
  const overrides = new Map();
  if (!action || !Array.isArray(action.fcurves)) return overrides;

  for (const fc of action.fcurves) {
    const target = decodeFCurveTarget(fc);
    // Skip parameter targets — those go through computeParamOverrides.
    if (!target || target.kind !== 'node') continue;

    let value;
    if (target.property === 'mesh_verts') {
      value = interpolateMeshVerts(fc.keyforms, timeMs, loopKeyframes, endMs);
    } else {
      value = interpolateTrack(fc.keyforms, timeMs, loopKeyframes, endMs);
    }
    if (value === undefined) continue;

    if (!overrides.has(target.nodeId)) overrides.set(target.nodeId, {});
    overrides.get(target.nodeId)[target.property] = value;
  }

  return overrides;
}

/**
 * Compute Live2D parameter value overrides at the given time. Mirrors
 * `computePoseOverrides` but for fcurves whose rnaPath decodes to a
 * parameter target.
 *
 * The CanvasViewport tick merges this map into `valuesForEval` BEFORE
 * chainEval runs, so the rig evaluator sees the animated parameter
 * values rather than the slider-set defaults. Live preview drivers
 * (breath, cursor look, physics) write on top of this so user-played
 * animations can still co-exist with physics jitter.
 *
 * @param {Object|null} action
 * @param {number}      timeMs
 * @param {boolean}     loopKeyframes
 * @param {number}      endMs
 * @returns {Map<string, number>}  paramId → value
 */
export function computeParamOverrides(action, timeMs, loopKeyframes = false, endMs = 0) {
  const overrides = new Map();
  if (!action || !Array.isArray(action.fcurves)) return overrides;

  for (const fc of action.fcurves) {
    const target = decodeFCurveTarget(fc);
    if (!target || target.kind !== 'param') continue;
    const v = interpolateTrack(fc.keyforms, timeMs, loopKeyframes, endMs);
    if (v === undefined) continue;
    overrides.set(target.paramId, v);
  }

  return overrides;
}

/**
 * Insert or update a keyform in an fcurve's keyforms array (mutates in
 * place). Keeps keyforms sorted by time. Derives `type` from `easing`
 * the same way `animationFCurve.normalizeKeyforms` does so a freshly
 * authored keyform evaluates identically to one minted by the v36
 * migration.
 */
const HOLD_EASINGS_FOR_UPSERT = new Set(['constant', 'hold']);
export function upsertKeyframe(keyforms, timeMs, value, easing = 'ease-both') {
  const type = HOLD_EASINGS_FOR_UPSERT.has(easing) ? 'constant' : 'linear';
  const existing = keyforms.find(kf => kf.time === timeMs);
  if (existing) {
    existing.value  = value;
    existing.easing = easing;
    existing.type   = type;
  } else {
    keyforms.push({ time: timeMs, value, easing, type });
    keyforms.sort((a, b) => a.time - b.time);
  }
}

/** All keyframeable transform properties (in display order) */
export const KEYFRAME_PROPS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity', 'visible'];

/** Prefix for blend shape influence track properties */
export const BLEND_SHAPE_TRACK_PREFIX = 'blendShape:';

/** Human-readable labels */
export const PROP_LABELS = {
  x:        'X',
  y:        'Y',
  rotation: 'Rotation',
  scaleX:   'Scale X',
  scaleY:   'Scale Y',
  opacity:  'Opacity',
  visible:  'Visible',
};

/**
 * Detect whether a node is a bone group (schema v17+ pose carrier).
 * Bones store transform pose-fields (`rotation`, `x`, `y`, `scaleX`,
 * `scaleY`) on `node.pose`, not `node.transform`. Non-bone nodes
 * (parts, plain groups, deformers) keep everything on `transform`.
 */
function isBoneNode(node) {
  return isBoneGroup(node);
}

/**
 * Get the current value of a property from a node (used when inserting keyframes).
 * Reads from transform for non-bones, from `pose` for bones (schema v17+).
 * Opacity/visible/blendShape live on the node directly regardless.
 */
export function getNodePropertyValue(node, property) {
  if (property === 'opacity') return node.opacity ?? 1;
  if (property === 'visible') return node.visible ?? true;
  if (property.startsWith(BLEND_SHAPE_TRACK_PREFIX)) {
    const shapeId = property.slice(BLEND_SHAPE_TRACK_PREFIX.length);
    return node.blendShapeValues?.[shapeId] ?? 0;
  }
  // Bone pose-fields live on `node.pose`. The bone's `node.transform`
  // is reserved for rest layout (only `pivotX/pivotY` is meaningful
  // post-v17), so reading transform.rotation for a bone returns 0
  // regardless of pose. Route through `pose` for bones.
  if (isBoneNode(node) && (property === 'rotation' || property === 'x' || property === 'y' || property === 'scaleX' || property === 'scaleY')) {
    // getBonePose handles v17/v18 flat shape AND v19+ channels shape;
    // returns identity-pose if pose is missing.
    const p = getBonePose(node);
    return p ? p[property] : ((property === 'scaleX' || property === 'scaleY') ? 1 : 0);
  }
  return node.transform?.[property] ?? 0;
}

/**
 * Build an "effective node" — `node` with override values (from
 * keyframes / draftPose / animation playback) merged into the right
 * slot. For bones, transform pose-fields go into a synthetic `pose`;
 * for non-bones, into a synthetic `transform`. Opacity is applied to
 * the node-level `opacity` slot.
 *
 * Returns the input node unchanged when the override map has no
 * entries that affect this node — saves an allocation per render.
 *
 * Used by:
 *   - `scenePass.draw` to feed the renderer with posed verts/values.
 *   - `SkeletonOverlay` / `GizmoOverlay` for `effectiveNodes` in the
 *     overlay pointer-handler scope.
 *
 * @param {object} node
 * @param {Record<string, any>|undefined|null} override
 *        Map of `{x?, y?, rotation?, scaleX?, scaleY?, opacity?, visible?, mesh_verts?, ...blendShape:N?}`.
 * @returns {object}
 */
export function applyOverrideToNode(node, override) {
  if (!override) return node;
  const isBone = isBoneNode(node);
  let pose = null;
  let transform = null;
  for (const k of TRANSFORM_PROPS) {
    if (override[k] === undefined) continue;
    if (isBone) {
      // Base off `getBonePose` (shape-aware) so the synthetic pose is
      // ALWAYS flat shape regardless of v19 channels-shape on the
      // original. Downstream `computeWorldMatrices` reads the synthetic
      // via flat-pose contract.
      if (!pose) pose = { ...(getBonePose(node) ?? IDENTITY_POSE) };
      pose[k] = override[k];
    } else {
      if (!transform) transform = { ...(node.transform ?? {}) };
      transform[k] = override[k];
    }
  }
  if (!pose && !transform && override.opacity === undefined && override.visible === undefined) {
    return node;
  }
  return {
    ...node,
    ...(transform ? { transform } : null),
    ...(pose ? { pose } : null),
    ...(override.opacity !== undefined ? { opacity: override.opacity } : null),
    ...(override.visible !== undefined ? { visible: override.visible } : null),
  };
}

const TRANSFORM_PROPS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
const IDENTITY_POSE = Object.freeze({ rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 });

/**
 * Read a pose-shape value (`rotation`/`x`/`y`/`scaleX`/`scaleY`)
 * routed to the right slot — `pose` for bones, `transform` for
 * everything else. Returns sensible defaults when the slot is
 * missing (0 for translate/rotate, 1 for scale).
 *
 * Use this from drag-start handlers (Gizmo / Modal / Skeleton arc)
 * so the gesture continues from the user's current pose, not from
 * stale transform-fields that v17 zeroed out for bones.
 *
 * @param {object} node
 * @param {'rotation'|'x'|'y'|'scaleX'|'scaleY'} key
 */
export function readPoseValue(node, key) {
  const dflt = (key === 'scaleX' || key === 'scaleY') ? 1 : 0;
  if (isBoneNode(node)) {
    // getBonePose is shape-aware (v17/v18 flat + v19 channels).
    const p = getBonePose(node);
    return p ? p[key] : dflt;
  }
  return node.transform?.[key] ?? dflt;
}

/**
 * Mutator inverse of `readPoseValue`. Writes a partial set of
 * pose-shape values to the right slot. The node is mutated in place
 * (call inside an `updateProject` recipe).
 *
 * For bones, ensures `node.pose` exists (initialized to identity if
 * absent). For non-bones, ensures `node.transform` exists. Doesn't
 * touch unrelated keys, so a translate-only commit doesn't accidentally
 * reset rotation.
 *
 * @param {object} node
 * @param {Partial<{rotation:number, x:number, y:number, scaleX:number, scaleY:number}>} updates
 */
export function writePoseValues(node, updates) {
  if (isBoneNode(node)) {
    // setBonePose handles v19 channels shape + flat shape and skips
    // missing/non-numeric fields, so a translate-only commit doesn't
    // accidentally reset rotation.
    setBonePose(node, updates);
  } else {
    if (!node.transform) node.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
    for (const k of TRANSFORM_PROPS) {
      if (updates[k] !== undefined) node.transform[k] = updates[k];
    }
  }
}

/**
 * Read rest-layout fields off a bone (translate via pivotX/pivotY,
 * rotation/scale via transform.*). Non-bones fall back to
 * `readPoseValue` since rest is a bone-only concept.
 *
 * Used by `applyPoseAsRest` and other rest-bake code paths. The user-
 * facing modal G/R/S no longer routes through here (Armature Edit Mode
 * was collapsed into Pose Mode 2026-05-06; modal writes pose-shape).
 *
 * @param {object} node
 * @param {'rotation'|'x'|'y'|'scaleX'|'scaleY'} key
 */
export function readRestValue(node, key) {
  if (!isBoneNode(node)) return readPoseValue(node, key);
  if (key === 'x') return node.transform?.pivotX ?? 0;
  if (key === 'y') return node.transform?.pivotY ?? 0;
  if (key === 'scaleX' || key === 'scaleY') return node.transform?.[key] ?? 1;
  return node.transform?.[key] ?? 0;
}

/**
 * Mutator inverse of `readRestValue`. Writes `transform.pivotX/Y`
 * (translate) / `transform.rotation` / `transform.scaleX/Y` for bones;
 * falls back to `writePoseValues` for non-bones.
 *
 * Same audience as `readRestValue` — rest-bake helpers, not modal G/R/S
 * (which writes pose-shape only after the 2026-05-06 mode collapse).
 *
 * @param {object} node
 * @param {Partial<{rotation:number, x:number, y:number, scaleX:number, scaleY:number}>} updates
 */
export function writeRestValues(node, updates) {
  if (!isBoneNode(node)) {
    writePoseValues(node, updates);
    return;
  }
  if (!node.transform) node.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
  if (updates.x !== undefined) node.transform.pivotX = updates.x;
  if (updates.y !== undefined) node.transform.pivotY = updates.y;
  if (updates.rotation !== undefined) node.transform.rotation = updates.rotation;
  if (updates.scaleX !== undefined) node.transform.scaleX = updates.scaleX;
  if (updates.scaleY !== undefined) node.transform.scaleY = updates.scaleY;
}

/**
 * Insert/update a parameter keyform at the given time.  Finds the
 * existing param fcurve in `action.fcurves` (by rnaPath decoded
 * paramId), creates one via `buildParamFCurve` if missing, and upserts
 * a keyform at `timeMs`. Mutates the action in place — callers wrap
 * in `updateProject` to snapshot undo.
 *
 * @param {Object} action - mutable action object
 * @param {string} paramId
 * @param {number} timeMs
 * @param {number} value
 * @param {string} [easing='ease-both']
 */
export function setParamKeyframeAt(action, paramId, timeMs, value, easing = 'ease-both') {
  if (!action || !paramId) return;
  if (!Array.isArray(action.fcurves)) action.fcurves = [];
  let fc = action.fcurves.find((f) => {
    const t = decodeFCurveTarget(f);
    return t?.kind === 'param' && t.paramId === paramId;
  });
  if (!fc) {
    fc = buildParamFCurve(paramId, [], { });
    if (!fc) {
      // buildParamFCurve refuses an empty keyforms array; construct
      // the empty fcurve directly so the upsert below can populate it.
      fc = {
        id: `param:${paramId}`,
        rnaPath: `objects["__params__"].values["${paramId}"]`,
        arrayIndex: 0,
        keyforms: [],
        modifiers: [],
        extrapolation: 'constant',
      };
    }
    action.fcurves.push(fc);
  }
  upsertKeyframe(fc.keyforms, timeMs, value, easing);
}
