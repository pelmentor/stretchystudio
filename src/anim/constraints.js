/**
 * Phase 4 — Per-Object constraint evaluator.
 *
 * Constraints transform transforms (vs modifiers, which transform
 * geometry). They run AFTER the modifier stack and BEFORE the final
 * world matrix is composed, mutating the owner object's transform in
 * place based on a target object's transform.
 *
 * Blender per `reference/blender/source/blender/blenkernel/intern/constraint.cc`.
 * Type enum at `DNA_constraint_types.h:100-107`. Storage on each
 * `bConstraint` (see `DNA_constraint_types.h:668`). The four constraint
 * types ported here:
 *
 *   - `COPY_LOCATION`  (Blender `CONSTRAINT_TYPE_LOCLIKE`,
 *     `loclike_evaluate` at constraint.cc:1959).
 *   - `COPY_ROTATION`  (Blender `CONSTRAINT_TYPE_ROTLIKE`,
 *     `rotlike_evaluate` at constraint.cc:2058).
 *   - `LIMIT_ROTATION` (Blender `CONSTRAINT_TYPE_ROTLIMIT`,
 *     `rotlimit_evaluate` at constraint.cc:1769).
 *   - `TRACK_TO`       (Blender `CONSTRAINT_TYPE_TRACKTO`,
 *     `trackto_evaluate` at constraint.cc:1308).
 *
 * # Deviations from Blender's evaluators (SS-specific)
 *
 * - **2D collapse**. SS objects have a single `rotation` angle (Z-axis
 *   only) and `(x, y)` translation. The 3D euler / per-axis flags from
 *   the `bConstraint` data structures collapse: `LOCLIKE_X` / `LOCLIKE_Y`
 *   stay (they're 2D); `LOCLIKE_Z` and any Z-axis flag is silently
 *   ignored. `ROTLIKE_X` / `ROTLIKE_Y` (which control which euler axis
 *   to copy in 3D) collapse to a single "copy or don't" flag (the
 *   Z-axis rotation in Blender ↔ the single rotation in SS). `TRACK_TO`
 *   degenerates to "rotate owner so its +X axis points at the target."
 * - **No coordinate-frame parameters** (Blender's `ownspace`/`tarspace`
 *   from `eBConstraint_SpaceTypes`: WORLD/LOCAL/POSE/LOCAL_WITH_PARENT/
 *   OWNLOCAL). SS's flat-canvas single-frame model collapses these to a
 *   single space — owner and target are evaluated in canvas space.
 *   `space: 'world' | 'local'` is reserved on the constraint payload
 *   for future use but ignored today.
 * - **No rotation-order field**. SS rotation is a single Z angle, so
 *   ordering is irrelevant. Blender's `data->euler_order` doesn't apply.
 *
 * # Constraint payload contract
 *
 * Each `ConstraintData` entry on `Object.constraints[]` carries:
 *
 *   {
 *     id:        string,
 *     type:      'COPY_LOCATION' | 'COPY_ROTATION' | 'LIMIT_ROTATION' | 'TRACK_TO',
 *     name:      string,
 *     enabled:   boolean,    // default true
 *     influence: number,     // 0..1; default 1
 *     payload:   object      // type-specific (see below)
 *   }
 *
 * Type-specific `payload` shapes:
 *
 *   COPY_LOCATION:
 *     {
 *       targetId:  string,    // node id whose transform to read
 *       useX:      boolean,   // default true
 *       useY:      boolean,   // default true
 *       invertX:   boolean,   // negate target.x before copying
 *       invertY:   boolean,
 *       offset:    boolean,   // when true, add owner's existing pos to copied
 *     }
 *
 *   COPY_ROTATION:
 *     {
 *       targetId:  string,
 *       invert:    boolean,
 *       mixMode:   'replace' | 'add' | 'offset' | 'before' | 'after',
 *                  // default 'replace'; 'offset' kept for backward compat,
 *                  // collapses to 'add' in 2D
 *     }
 *
 *   LIMIT_ROTATION:
 *     {
 *       useMin:    boolean,
 *       min:       number,    // radians
 *       useMax:    boolean,
 *       max:       number,
 *     }
 *
 *   TRACK_TO:
 *     {
 *       targetId:  string,    // node id of target
 *     }
 *
 * # Influence
 *
 * After computing the constrained transform, we lerp from the
 * pre-constraint owner state by `influence`. `0` = constraint has no
 * effect; `1` = full constraint output. Blender uses linear influence
 * for simple constraints; rotation lerp uses shortest-arc.
 *
 * @module anim/constraints
 */

import { getBonePose, isBoneGroup } from '../store/objectDataAccess.js';

const TWO_PI = Math.PI * 2;

/**
 * Wrap an angle to the canonical (-PI, PI] range. Used as the
 * 2D analogue of Blender's `clamp_angle` (constraint.cc:1828) which
 * treats angles as living on a continuous loop.
 *
 * @param {number} a
 * @returns {number}
 */
function wrapPi(a) {
  let x = a % TWO_PI;
  if (x > Math.PI) x -= TWO_PI;
  else if (x <= -Math.PI) x += TWO_PI;
  return x;
}

/**
 * Clamp an angle to a [min, max] range using the same continuous-loop
 * approach Blender uses post-#117927. Returns `min` or `max` if the
 * shortest-arc difference falls outside.
 *
 * @param {number} a
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampAngle(a, min, max) {
  const wa = wrapPi(a);
  if (min <= max) {
    if (wa < min) return min;
    if (wa > max) return max;
    return wa;
  }
  // min > max means the allowed arc wraps through ±PI.
  if (wa > min || wa < max) return wa;
  // Outside the allowed wrap-arc — pick the closer boundary.
  const distToMin = Math.abs(wrapPi(wa - min));
  const distToMax = Math.abs(wrapPi(wa - max));
  return distToMin < distToMax ? min : max;
}

/**
 * Linear interpolate two angles along the shortest arc (-PI..PI).
 * `t = 0` returns `a`; `t = 1` returns `b`.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerpAngle(a, b, t) {
  const diff = wrapPi(b - a);
  return a + diff * t;
}

/**
 * Read an object's effective transform. For bones the rest pivot is
 * separate from pose offsets; constraints operate on the EFFECTIVE
 * transform (rest + pose). For non-bones, just `node.transform`.
 *
 * @param {object} node
 * @returns {{ x: number, y: number, rotation: number, scaleX: number, scaleY: number }}
 */
function effectiveTransform(node) {
  if (!node) return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const t = node.transform ?? {};
  if (isBoneGroup(node)) {
    const pose = getBonePose(node) ?? { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
    return {
      x:        (t.pivotX ?? 0) + (pose.x ?? 0),
      y:        (t.pivotY ?? 0) + (pose.y ?? 0),
      rotation: pose.rotation ?? 0,
      scaleX:   pose.scaleX ?? 1,
      scaleY:   pose.scaleY ?? 1,
    };
  }
  return {
    x:        t.x ?? 0,
    y:        t.y ?? 0,
    rotation: t.rotation ?? 0,
    scaleX:   t.scaleX ?? 1,
    scaleY:   t.scaleY ?? 1,
  };
}

/**
 * Evaluate one COPY_LOCATION constraint and return a new transform
 * record. Pure: doesn't mutate inputs. Falls back to the input
 * transform unchanged when the target is missing.
 */
function evalCopyLocation(con, ownerTransform, targetTransform) {
  const p = con.payload ?? {};
  const useX = p.useX !== false;
  const useY = p.useY !== false;
  const out = { ...ownerTransform };
  if (!targetTransform) return out;
  if (useX) {
    let v = targetTransform.x;
    if (p.invertX) v = -v;
    if (p.offset) v += ownerTransform.x;
    out.x = v;
  }
  if (useY) {
    let v = targetTransform.y;
    if (p.invertY) v = -v;
    if (p.offset) v += ownerTransform.y;
    out.y = v;
  }
  return out;
}

function evalCopyRotation(con, ownerTransform, targetTransform) {
  const p = con.payload ?? {};
  const out = { ...ownerTransform };
  if (!targetTransform) return out;
  let r = targetTransform.rotation;
  if (p.invert) r = -r;
  const mode = p.mixMode ?? 'replace';
  switch (mode) {
    case 'add':
    case 'offset':
      out.rotation = wrapPi(ownerTransform.rotation + r);
      break;
    case 'before':
      // 2D: matrix multiplication of rotations is commutative, so
      // 'before' and 'after' both collapse to addition. Preserved for
      // payload compatibility with the 3D Blender constraint.
      out.rotation = wrapPi(r + ownerTransform.rotation);
      break;
    case 'after':
      out.rotation = wrapPi(ownerTransform.rotation + r);
      break;
    case 'replace':
    default:
      out.rotation = wrapPi(r);
      break;
  }
  return out;
}

function evalLimitRotation(con, ownerTransform) {
  const p = con.payload ?? {};
  const out = { ...ownerTransform };
  const r = ownerTransform.rotation;
  if (p.useMin && p.useMax) {
    out.rotation = clampAngle(r, p.min, p.max);
  } else if (p.useMin) {
    const wa = wrapPi(r);
    out.rotation = wa < p.min ? p.min : wa;
  } else if (p.useMax) {
    const wa = wrapPi(r);
    out.rotation = wa > p.max ? p.max : wa;
  }
  return out;
}

function evalTrackTo(con, ownerTransform, targetTransform) {
  const out = { ...ownerTransform };
  if (!targetTransform) return out;
  // Rotate owner so its local +X axis points at target. `atan2` of
  // the target-relative-to-owner vector gives the world angle.
  const dx = targetTransform.x - ownerTransform.x;
  const dy = targetTransform.y - ownerTransform.y;
  if (dx === 0 && dy === 0) return out;
  out.rotation = wrapPi(Math.atan2(dy, dx));
  return out;
}

/**
 * Look up an object node by id within `project.nodes`. Returns null if
 * the project lacks a nodes array or no node matches.
 *
 * @param {object} project
 * @param {string|null|undefined} id
 * @returns {object|null}
 */
function findNodeById(project, id) {
  if (!project || !Array.isArray(project.nodes)) return null;
  if (typeof id !== 'string' || id.length === 0) return null;
  return project.nodes.find((n) => n?.id === id) ?? null;
}

/**
 * Apply a single constraint to the owner's transform. Pure: returns
 * the post-constraint transform without mutating inputs. Disabled or
 * unknown constraints pass `ownerTransform` through unchanged.
 *
 * @param {object} con  ConstraintData
 * @param {{x:number, y:number, rotation:number, scaleX:number, scaleY:number}} ownerTransform
 * @param {object} project
 * @returns {{x:number, y:number, rotation:number, scaleX:number, scaleY:number}}
 */
export function evaluateConstraint(con, ownerTransform, project) {
  if (!con || con.enabled === false) return ownerTransform;
  const influence = typeof con.influence === 'number'
    ? Math.max(0, Math.min(1, con.influence))
    : 1;
  if (influence === 0) return ownerTransform;
  const targetId = con.payload?.targetId;
  const targetNode = targetId ? findNodeById(project, targetId) : null;
  const targetTransform = targetNode ? effectiveTransform(targetNode) : null;

  let constrained;
  switch (con.type) {
    case 'COPY_LOCATION':
      constrained = evalCopyLocation(con, ownerTransform, targetTransform);
      break;
    case 'COPY_ROTATION':
      constrained = evalCopyRotation(con, ownerTransform, targetTransform);
      break;
    case 'LIMIT_ROTATION':
      constrained = evalLimitRotation(con, ownerTransform);
      break;
    case 'TRACK_TO':
      constrained = evalTrackTo(con, ownerTransform, targetTransform);
      break;
    default:
      // Unknown / not-yet-implemented constraint types pass through.
      return ownerTransform;
  }
  if (influence >= 1) return constrained;

  // Lerp owner ↔ constrained by influence. Translation lerps linearly;
  // rotation lerps along shortest arc; scale lerps multiplicatively
  // (Blender uses linear scale lerp; identical for SS's narrow case).
  return {
    x:        ownerTransform.x + (constrained.x - ownerTransform.x) * influence,
    y:        ownerTransform.y + (constrained.y - ownerTransform.y) * influence,
    rotation: lerpAngle(ownerTransform.rotation, constrained.rotation, influence),
    scaleX:   ownerTransform.scaleX + (constrained.scaleX - ownerTransform.scaleX) * influence,
    scaleY:   ownerTransform.scaleY + (constrained.scaleY - ownerTransform.scaleY) * influence,
  };
}

/**
 * Walk an Object's constraint stack and apply each constraint in order
 * to `seedTransform`. Returns the final post-stack transform without
 * mutating any input. The result is the owner's transform after all
 * constraints have been resolved.
 *
 * Stack order matches Blender: top-of-stack is applied first, output
 * feeds the next constraint as input. Constraints with `enabled:false`
 * are skipped. Unknown types pass through.
 *
 * @param {object} owner
 * @param {{x:number, y:number, rotation:number, scaleX:number, scaleY:number}|null} [seedTransform]
 *   the starting transform; defaults to `effectiveTransform(owner)`
 * @param {object} project
 * @returns {{x:number, y:number, rotation:number, scaleX:number, scaleY:number}}
 */
export function evaluateConstraints(owner, seedTransform, project) {
  if (!owner) return seedTransform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const stack = Array.isArray(owner.constraints) ? owner.constraints : [];
  let cur = seedTransform ?? effectiveTransform(owner);
  for (const con of stack) {
    cur = evaluateConstraint(con, cur, project);
  }
  return cur;
}
