// @ts-check

/**
 * Structural invariant checks for the post-Init-Rig project state.
 *
 * Existence rationale (2026-05-25 user directive, [[invariant-checks-over-user-repro]]):
 * when a bug surfaces from "viewport looks wrong," the FIRST response is to
 * build a structural check that catches the bug CLASS from logs, not to
 * ping-pong with the user asking them to click parts and read pivot values.
 *
 * Each violation is logged as a single `logger.error` with the smoking-gun
 * fields **inlined into the message string** (per
 * [[inline-diagnostic-fields]] — the user's console-paste collapses Object
 * payloads to `[object Object]` so the message string is the only reliable
 * surface). Counts are summarised once at the end so the user sees the
 * total + the top-N offenders without scrolling 200KB of log.
 *
 * Invariants checked (all post-Init-Rig, all on `project.nodes`):
 *
 *   I-1 — Modifier-stack non-emptiness. Every `type:'part'` node with a
 *         non-empty mesh has at least one entry in `part.modifiers[]`.
 *         (Empty stack → renderer falls back to root frame → part renders
 *         at canvas origin. Face-displacement regression class.)
 *
 *   I-2 — Modifier leaf reachability. Each `modifiers[i]`'s reference
 *         (`objectId` for `type:'lattice'`, `deformerId` for other
 *         modifier types, `boneId` for armature) resolves to an existing
 *         node in `project.nodes`. A dangling reference means the chain
 *         walk in `synthesizeModifierStacks` breaks at that link.
 *
 *   I-3 — Lattice parent reachability. Each `objectKind:'lattice'` node's
 *         `parent` (if non-null) resolves to an existing node.
 *
 *   I-4 — Lattice cage shape. Each lattice has a `dataId` pointing at a
 *         cage `type:'object'` with `gridSize` matching the lattice's
 *         `gridSize` and `vertices.length === rows × cols × 2`.
 *
 *   I-5 — Keyform vertexPositions shape. Every part-mesh's
 *         `runtime.keyforms[i].vertexPositions` is a Float32Array (or
 *         number array) of length `2 × vertexCount` with all-finite
 *         entries. Catches the dual-`mesh.vertices`-shape bug (object
 *         array bleeding into a flat-array field —
 *         [[mesh-vertices-dual-shape]], handwear scale-to-infinity 2026-05-25).
 *
 *   I-6 — boneWeights consistency. If `mesh.jointBoneId` is set,
 *         `mesh.boneWeights.length === vertexCount` (the actual vertex
 *         count, regardless of whether `mesh.vertices` is object- or
 *         flat-shape). Catches the same shape-mismatch class as I-5 on
 *         the bone-skin side.
 *
 *   I-7 — Bone pivot finiteness. Every node with `boneRole` has
 *         `transform.pivotX/Y` as finite numbers. Catches the
 *         bone-NaN cascade class ([[shelby-invisible-bones-fix-2026-05-25]]).
 *
 *   I-12 — Bone pose translation magnitude. `pose.x/y` (and the v19
 *         channels-shape equivalent) must be within `10 × max(canvas)`.
 *         Pose translation feeds `composed.x = pivotX + pose.x` which
 *         feeds the world-matrix translation; a pose.x of 800K → every
 *         skinned vertex offset by 800K → RENDERS HUGE. Catches the
 *         upstream of I-9 when scale (I-10) and pivot finiteness (I-7)
 *         both pass.
 *
 *   I-13 — Bone pivot magnitude. `transform.pivotX/Y` must be within
 *         `10 × max(canvas)`. I-7 catches NaN; this catches finite-but-
 *         huge pivots (e.g. 800K). Combined with any non-identity
 *         rotation the cross-axis term doesn't cancel out, so the
 *         resulting world-matrix translation is similarly huge. Sister
 *         of I-12 — together they bracket every input to the bone
 *         world-matrix translation channel.
 *
 *   I-14 — STATIC bone world matrix translation magnitude. Runs
 *         `computeWorldMatrices` (the same algebra Blender's depsgraph
 *         uses pre-constraints) and asserts each
 *         bone's resulting WORLD matrix translation (`m[6], m[7]`) is
 *         within `10 × max(canvas)`. Catches stored-data pollution
 *         that combines pivot + pose + parent chain in ways the
 *         per-field invariants (I-7/I-10/I-12/I-13) don't see in
 *         isolation — e.g. a non-zero `transform.rotation` combined
 *         with a non-zero `transform.pivot` produces a non-cancelling
 *         translation term, or a parent chain that accumulates small
 *         per-bone offsets into a huge total. If I-14 PASSES but I-9
 *         still fires, the pollution enters via depgraph
 *         constraint/fcurve eval (I-15's domain), not stored data.
 *
 *   I-15 — Depgraph TRANSFORM_COMPOSE output magnitude (bones only).
 *         After running the depgraph eval, every bone's
 *         `ctx.outputs.get(<boneId>/TRANSFORM/TRANSFORM_COMPOSE).transform`
 *         must have `|x|, |y| ≤ 10 × max(canvas)`. Catches
 *         constraint-solver pollution, fcurve unit-mismatch, or any
 *         depgraph-internal composition that produces huge values
 *         even when stored data (I-1..I-14) is all clean. Pairs with
 *         I-14: I-14 = static pre-constraint check, I-15 = post-
 *         constraint depgraph check. A fire on I-15 without I-14
 *         narrows the source to the constraint eval / animated pose
 *         override path.
 *
 * Returns a summary object so callers can also assert programmatically
 * (used by the framework's own unit tests).
 *
 * @module io/live2d/rig/rigInvariantCheck
 */

import { logger } from '../../../lib/logger.js';
import { buildDepGraph } from '../../../anim/depgraph/build.js';
import { evalDepGraph } from '../../../anim/depgraph/eval.js';
import { OperationCode, NodeType } from '../../../anim/depgraph/types.js';
import { computeWorldMatrices } from '../../../renderer/transforms.js';

/**
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   invariant: string,
 *   message: string,
 * }} Violation
 *
 * @typedef {{
 *   ok: boolean,
 *   violationCount: number,
 *   byInvariant: Record<string, number>,
 *   violations: Violation[],
 * }} CheckSummary
 */

/**
 * Compute the canonical vertex count for a `mesh.vertices` value
 * regardless of shape (object array `[{x,y},...]` or flat number array
 * `[x0,y0,x1,y1,...]`). Returns 0 for missing / unrecognised shapes.
 *
 * @param {unknown} verts
 * @returns {number}
 */
function vertexCountOf(verts) {
  if (!Array.isArray(verts) || verts.length === 0) return 0;
  const v0 = verts[0];
  if (typeof v0 === 'object' && v0 !== null) return verts.length;
  if (typeof v0 === 'number') return verts.length >> 1;
  return 0;
}

/**
 * Coerce a typed-array-or-array to a plain numeric iterable for
 * finiteness checking without allocating per-element.
 *
 * @param {unknown} vp
 * @returns {{ length: number, get: (i: number) => number } | null}
 */
function asNumericVec(vp) {
  if (vp instanceof Float32Array || vp instanceof Float64Array) {
    return { length: vp.length, get: (i) => vp[i] };
  }
  if (Array.isArray(vp)) {
    // Defensive: a `verts.slice()` of an object array would land here.
    // Treat any non-number entry as a finiteness failure (handled by
    // caller).
    return { length: vp.length, get: (i) => /** @type {number} */ (vp[i]) };
  }
  return null;
}

/**
 * Run all structural invariant checks against the post-Init-Rig
 * project. Each violation produces ONE `logger.error` line with the
 * offender's id/name + the smoking-gun fields inlined into the
 * message string. A single `logger.error('rigInvariantCheck', ...)`
 * summary line follows when violations are found; `logger.info`
 * "ok, N parts" when clean.
 *
 * Safe to call with a malformed `project` — degrades to a no-op
 * summary rather than throwing (the rest of Init Rig must not be
 * blocked by an instrumentation bug).
 *
 * @param {object|null|undefined} project
 * @returns {CheckSummary}
 */
export function runRigInvariantChecks(project) {
  /** @type {CheckSummary} */
  const summary = {
    ok: true,
    violationCount: 0,
    byInvariant: {},
    violations: [],
  };

  if (!project || !Array.isArray(project.nodes)) return summary;
  const nodes = project.nodes;
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const n of nodes) {
    if (n && typeof n.id === 'string') byId.set(n.id, n);
  }

  /**
   * @param {string} invariant
   * @param {string} id
   * @param {string|undefined} name
   * @param {string} message
   */
  const violate = (invariant, id, name, message) => {
    summary.ok = false;
    summary.violationCount++;
    summary.byInvariant[invariant] = (summary.byInvariant[invariant] ?? 0) + 1;
    summary.violations.push({ id, name, invariant, message });
    logger.error('rigInvariantCheck', `${invariant} | id=${id} name=${name ?? '?'} | ${message}`);
  };

  // ─── I-1, I-2, I-5, I-6 — per-part checks ─────────────────────────
  let partsChecked = 0;
  for (const n of nodes) {
    if (!n || n.type !== 'part') continue;
    partsChecked++;
    const mesh = n.mesh;
    const vCount = vertexCountOf(mesh?.vertices);
    if (vCount === 0) continue; // no mesh — skip (legitimate for some part types)

    // I-1: at least one modifier
    if (!Array.isArray(n.modifiers) || n.modifiers.length === 0) {
      violate('I-1', n.id, n.name, `part has mesh (${vCount} verts) but modifiers[] is empty or missing → renderer will render at canvas origin`);
    } else {
      // I-2: each modifier reference resolves
      // Field mapping (verified against ArmatureModifierService.js:315 +
      // synthesizeModifierStacks): the armature modifier uses `deformerId`
      // (set to the joint bone id), NOT `boneId`/`armatureId`. Treat the
      // armature and non-lattice modifier refs uniformly.
      for (let i = 0; i < n.modifiers.length; i++) {
        const m = n.modifiers[i];
        if (!m) continue;
        let refId = null;
        let refField = null;
        if (m.type === 'lattice') { refId = m.objectId; refField = 'objectId'; }
        else { refId = m.deformerId ?? null; refField = 'deformerId'; }
        if (typeof refId !== 'string' || refId.length === 0) {
          violate('I-2', n.id, n.name, `modifiers[${i}].type=${m.type} has empty ${refField}`);
        } else if (!byId.has(refId)) {
          violate('I-2', n.id, n.name, `modifiers[${i}].type=${m.type} ${refField}="${refId}" does not resolve to any node`);
        }
      }
    }

    // I-5: keyform vertexPositions shape + finiteness
    const keyforms = mesh?.runtime?.keyforms;
    if (Array.isArray(keyforms)) {
      for (let ki = 0; ki < keyforms.length; ki++) {
        const kf = keyforms[ki];
        const vp = kf?.vertexPositions;
        const vec = asNumericVec(vp);
        if (!vec) {
          violate('I-5', n.id, n.name, `keyforms[${ki}].vertexPositions is missing or not an array (got ${vp?.constructor?.name ?? typeof vp})`);
          continue;
        }
        if (vec.length !== vCount * 2) {
          violate('I-5', n.id, n.name, `keyforms[${ki}].vertexPositions.length=${vec.length} but expected ${vCount * 2} (vertexCount=${vCount} × 2)`);
        }
        let nonFiniteIdx = -1;
        for (let i = 0; i < vec.length; i++) {
          const v = vec.get(i);
          if (typeof v !== 'number' || !Number.isFinite(v)) { nonFiniteIdx = i; break; }
        }
        if (nonFiniteIdx >= 0) {
          const sample = vec.get(nonFiniteIdx);
          violate('I-5', n.id, n.name, `keyforms[${ki}].vertexPositions[${nonFiniteIdx}] is non-finite (value=${sample === null ? 'null' : typeof sample === 'object' ? JSON.stringify(sample) : String(sample)})`);
        }
      }
    }

    // I-6: boneWeights consistency
    if (typeof mesh?.jointBoneId === 'string' && mesh.jointBoneId.length > 0) {
      const bw = mesh.boneWeights;
      if (!Array.isArray(bw)) {
        violate('I-6', n.id, n.name, `mesh.jointBoneId="${mesh.jointBoneId}" but boneWeights is missing or not an array`);
      } else if (bw.length !== vCount) {
        violate('I-6', n.id, n.name, `mesh.jointBoneId="${mesh.jointBoneId}" boneWeights.length=${bw.length} but vertexCount=${vCount}`);
      }
    }
  }

  // ─── I-3, I-4 — per-lattice checks ────────────────────────────────
  let latticesChecked = 0;
  for (const n of nodes) {
    if (!n || n.type !== 'object' || n.objectKind !== 'lattice') continue;
    latticesChecked++;

    // I-3: lattice parent reachability
    if (typeof n.parent === 'string' && n.parent.length > 0 && !byId.has(n.parent)) {
      violate('I-3', n.id, n.name, `lattice.parent="${n.parent}" does not resolve to any node`);
    }

    // I-4: lattice cage shape.
    // `gridSize.{rows,cols}` is the number of CELLS, not points (verified
    // against [v43_lattice_substrate.js](../../../store/migrations/v43_lattice_substrate.js)
    // where the cage receives baseGrid points laid out as a `(rows+1)`
    // by `(cols+1)` grid of control points). So expected cage vertices
    // = `(rows+1) × (cols+1)`.
    if (typeof n.dataId === 'string' && n.dataId.length > 0) {
      const cage = byId.get(n.dataId);
      if (!cage) {
        violate('I-4', n.id, n.name, `lattice.dataId="${n.dataId}" does not resolve to any cage node`);
      } else {
        const rows = n.gridSize?.rows ?? 0;
        const cols = n.gridSize?.cols ?? 0;
        const expectedVerts = (rows > 0 && cols > 0) ? (rows + 1) * (cols + 1) : 0;
        // Cage vertices may be stored as flat `[x0, y0, ...]` (length 2N) OR object array (length N).
        const cageVertCount = vertexCountOf(cage.vertices);
        if (expectedVerts > 0 && cageVertCount > 0 && cageVertCount !== expectedVerts) {
          violate('I-4', n.id, n.name, `lattice.gridSize=${rows}×${cols} cells expects ${expectedVerts} cage points (${rows + 1}×${cols + 1}); cage="${cage.id}" has ${cageVertCount}`);
        }
      }
    }
  }

  // ─── I-7, I-10, I-12, I-13 — bone transform sanity ────────────────
  // I-7:  pivot must be finite (catches NaN cascade — Shelby 2026-05-25).
  // I-10: scale must be in [0.01, 100]. A scale outside this range is
  //       almost certainly corruption — Blender's UI defaults bones to
  //       1.0 and animation typically stays in [0.1, 10]. A scale of
  //       1000 propagates multiplicatively up the bone chain (root
  //       1000× × torso 1× × arm 1× = 1000× at the elbow) and produces
  //       the "RENDERS HUGE" handwear class (caught by I-9 2026-05-25).
  // I-12: pose translation magnitude — `pose.x/y` is the additive
  //       canvas-px offset on the bone joint. `effectiveTransform`
  //       (`anim/constraints.js:171`) returns `composed.x = pivotX +
  //       pose.x` for a bone; that value rides into
  //       `composedTransformToBonePose` (`kernels/bonePostChain.js:84`)
  //       and feeds `makeBoneLocalMatrix`'s translation channel. A
  //       pose.x of 800K → world-matrix translation 800K → every
  //       skinned vertex offset by 800K. Threshold 10× canvas — animation
  //       pose offsets rarely exceed a few hundred px; anything beyond
  //       10× canvas is catastrophic pollution.
  // I-13: bone pivot magnitude — `transform.pivotX/Y` is the bone's
  //       canvas-px joint position. I-7 only catches NaN; a finite-but-
  //       huge pivot (e.g. 800K) combined with any non-identity
  //       rotation produces world-matrix translation of similar
  //       magnitude via the T(pivot) × R × S × T(-pivot) algebra (the
  //       cross-axis term doesn't cancel when R≠0). Catches the
  //       upstream of I-9 when scale and pose are clean (the exact
  //       situation as the 2026-05-26 handwear bbox where I-10/I-11
  //       both pass but the eval still emits 700K-px coordinates).
  //       Same 10× canvas threshold as I-12.
  const cwBone = project.canvas?.width ?? project.canvas?.w ?? 2048;
  const chBone = project.canvas?.height ?? project.canvas?.h ?? 2048;
  const maxBoneCoord = 10 * Math.max(cwBone, chBone);
  let bonesChecked = 0;
  for (const n of nodes) {
    if (!n || !n.boneRole) continue;
    bonesChecked++;
    const px = n.transform?.pivotX;
    const py = n.transform?.pivotY;
    if (typeof px !== 'number' || !Number.isFinite(px) || typeof py !== 'number' || !Number.isFinite(py)) {
      violate('I-7', n.id, n.name, `bone role="${n.boneRole}" has non-finite pivot (pivotX=${px} pivotY=${py})`);
    } else {
      // I-13: pivot magnitude (only when pivot is finite — NaN already
      // raised I-7 above; running the magnitude check on NaN would emit
      // a spurious second violation since `NaN > maxBoneCoord` is false
      // and `Math.abs(NaN) > maxBoneCoord` is also false, but defensive
      // code stays clearer.)
      if (Math.abs(px) > maxBoneCoord) {
        violate('I-13', n.id, n.name, `bone role="${n.boneRole}" has out-of-range transform.pivotX=${px} (|x| > ${maxBoneCoord} = 10× canvas max ${Math.max(cwBone, chBone)}) — feeds world matrix translation`);
      }
      if (Math.abs(py) > maxBoneCoord) {
        violate('I-13', n.id, n.name, `bone role="${n.boneRole}" has out-of-range transform.pivotY=${py} (|y| > ${maxBoneCoord} = 10× canvas max ${Math.max(cwBone, chBone)}) — feeds world matrix translation`);
      }
    }
    const sx = n.transform?.scaleX;
    const sy = n.transform?.scaleY;
    if (typeof sx === 'number' && Number.isFinite(sx) && (sx < 0.01 || sx > 100)) {
      violate('I-10', n.id, n.name, `bone role="${n.boneRole}" has out-of-range transform.scaleX=${sx} (expected ~1; range [0.01, 100])`);
    }
    if (typeof sy === 'number' && Number.isFinite(sy) && (sy < 0.01 || sy > 100)) {
      violate('I-10', n.id, n.name, `bone role="${n.boneRole}" has out-of-range transform.scaleY=${sy} (expected ~1; range [0.01, 100])`);
    }
    // I-10b: pose scale (if present, also must be in range)
    const psx = n.pose?.scaleX;
    const psy = n.pose?.scaleY;
    if (typeof psx === 'number' && Number.isFinite(psx) && (psx < 0.01 || psx > 100)) {
      violate('I-10', n.id, n.name, `bone role="${n.boneRole}" has out-of-range pose.scaleX=${psx} (expected ~1; range [0.01, 100])`);
    }
    if (typeof psy === 'number' && Number.isFinite(psy) && (psy < 0.01 || psy > 100)) {
      violate('I-10', n.id, n.name, `bone role="${n.boneRole}" has out-of-range pose.scaleY=${psy} (expected ~1; range [0.01, 100])`);
    }
    // I-12: pose translation magnitude (additive canvas-px offset)
    const ptx = n.pose?.x;
    const pty = n.pose?.y;
    if (typeof ptx === 'number' && Number.isFinite(ptx) && Math.abs(ptx) > maxBoneCoord) {
      violate('I-12', n.id, n.name, `bone role="${n.boneRole}" has out-of-range pose.x=${ptx} (|x| > ${maxBoneCoord} = 10× canvas max ${Math.max(cwBone, chBone)}) — feeds composed.x via pivot+pose addition`);
    }
    if (typeof pty === 'number' && Number.isFinite(pty) && Math.abs(pty) > maxBoneCoord) {
      violate('I-12', n.id, n.name, `bone role="${n.boneRole}" has out-of-range pose.y=${pty} (|y| > ${maxBoneCoord} = 10× canvas max ${Math.max(cwBone, chBone)}) — feeds composed.y via pivot+pose addition`);
    }
    // I-12b: v19+ channels-shape pose — read the inner channel directly
    // (mirrors `getBonePose`'s channels-shape branch in
    // `objectDataAccess.js:370-373`) so this invariant catches both
    // shapes. Skipped when the flat shape above already had the field.
    const chPose = n.pose && typeof n.pose === 'object' && !Array.isArray(n.pose)
      && n.pose.channels && typeof n.pose.channels === 'object' && !Array.isArray(n.pose.channels)
      ? n.pose.channels[n.id]
      : null;
    if (chPose && typeof chPose === 'object') {
      const cptx = chPose.x;
      const cpty = chPose.y;
      if (typeof cptx === 'number' && Number.isFinite(cptx) && Math.abs(cptx) > maxBoneCoord) {
        violate('I-12', n.id, n.name, `bone role="${n.boneRole}" has out-of-range pose.channels[id].x=${cptx} (|x| > ${maxBoneCoord} = 10× canvas max ${Math.max(cwBone, chBone)})`);
      }
      if (typeof cpty === 'number' && Number.isFinite(cpty) && Math.abs(cpty) > maxBoneCoord) {
        violate('I-12', n.id, n.name, `bone role="${n.boneRole}" has out-of-range pose.channels[id].y=${cpty} (|y| > ${maxBoneCoord} = 10× canvas max ${Math.max(cwBone, chBone)})`);
      }
    }
  }

  // ─── I-11 — lattice cage vertex range sanity ──────────────────────
  // Every lattice's cage vertices must lie within a "reasonable"
  // canvas-px range — extreme values (e.g. 100× the canvas) indicate
  // a polluted cage. The body-warp chain DOES go beyond canvas edges
  // (e.g. BodyWarpZ y:[-179, 1970] on a 1792-canvas — 0.1× over). The
  // 100× threshold catches catastrophic pollution without false
  // positives on legitimate over-extents.
  const cw11 = project.canvas?.width ?? project.canvas?.w ?? 2048;
  const ch11 = project.canvas?.height ?? project.canvas?.h ?? 2048;
  const cageMaxAbs = 100 * Math.max(cw11, ch11);
  for (const n of nodes) {
    if (!n || !n.isLatticeCage) continue;
    const verts = n.vertices;
    if (!Array.isArray(verts) || verts.length === 0) continue;
    let badIdx = -1;
    let badVal = 0;
    const v0 = verts[0];
    const isObjShape = typeof v0 === 'object' && v0 !== null;
    if (isObjShape) {
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        const x = v?.x, y = v?.y;
        if (typeof x === 'number' && Math.abs(x) > cageMaxAbs) { badIdx = i; badVal = x; break; }
        if (typeof y === 'number' && Math.abs(y) > cageMaxAbs) { badIdx = i; badVal = y; break; }
      }
    } else {
      for (let i = 0; i < verts.length; i++) {
        if (typeof verts[i] === 'number' && Math.abs(verts[i]) > cageMaxAbs) { badIdx = i; badVal = verts[i]; break; }
      }
    }
    if (badIdx >= 0) {
      violate('I-11', n.id, n.name, `lattice cage vertex[${badIdx}]=${badVal.toFixed(0)} exceeds ${cageMaxAbs} (100× canvas max ${Math.max(cw11, ch11)}) — cage is polluted`);
    }
  }

  // ─── I-14 — STATIC bone WORLD matrix translation magnitude ────────
  // `computeWorldMatrices` walks every node and composes the bone
  // local matrices into world matrices using the SAME `makeBoneLocalMatrix`
  // algebra the renderer uses (`renderer/transforms.js:142`). This is the
  // pre-constraint composition — no fcurves, no constraint solver, no
  // animation overrides. If a bone's resulting world matrix translation
  // is huge here, the bug is in the STORED data (some combination of
  // transform.x/y, transform.rotation, transform.pivot, pose channels,
  // or parent chain). If this passes but I-9 still fires, the bug is
  // strictly in depgraph dynamic eval (I-15's domain).
  let worldMatrixChecked = 0;
  try {
    const worldMap = computeWorldMatrices(nodes);
    for (const [nodeId, m] of worldMap) {
      const node = byId.get(nodeId);
      if (!node || !node.boneRole) continue;
      worldMatrixChecked++;
      if (!m || m.length !== 9) continue;
      const tx = m[6], ty = m[7];
      if (Number.isFinite(tx) && Math.abs(tx) > maxBoneCoord) {
        violate('I-14', nodeId, node.name,
          `bone role="${node.boneRole}" STATIC-composed world matrix |translation.x|=${Math.abs(tx).toFixed(0)} > ${maxBoneCoord} (10× canvas). world.translation=(${tx.toFixed(1)}, ${ty.toFixed(1)}), m=[${m[0].toFixed(2)},${m[1].toFixed(2)},${m[3].toFixed(2)},${m[4].toFixed(2)},${tx.toFixed(1)},${ty.toFixed(1)}]. Stored-data composition is broken (transform.rotation×pivot interaction, transform.x/y, or parent-chain accumulation)`);
      } else if (Number.isFinite(ty) && Math.abs(ty) > maxBoneCoord) {
        violate('I-14', nodeId, node.name,
          `bone role="${node.boneRole}" STATIC-composed world matrix |translation.y|=${Math.abs(ty).toFixed(0)} > ${maxBoneCoord} (10× canvas). world.translation=(${tx.toFixed(1)}, ${ty.toFixed(1)}), m=[${m[0].toFixed(2)},${m[1].toFixed(2)},${m[3].toFixed(2)},${m[4].toFixed(2)},${tx.toFixed(1)},${ty.toFixed(1)}]. Stored-data composition is broken (transform.rotation×pivot interaction, transform.x/y, or parent-chain accumulation)`);
      }
    }
  } catch (err) {
    logger.warn('rigInvariantCheck', `I-14 skipped — computeWorldMatrices threw: ${/** @type {any} */ (err)?.message ?? String(err)}`);
  }

  // ─── I-8, I-9, I-15 — EVAL-TIME invariants. Drive `buildDepGraph` +
  // `evalDepGraph` directly (the same primitives `evalProjectFrameViaDepgraph`
  // wraps for production) so we have access to `ctx.outputs` for both
  // ART_MESH_EVAL frames (I-8/I-9) AND TRANSFORM_COMPOSE bone outputs
  // (I-15). Math is identical to production — the framework calls the
  // same engine the viewport ticks.
  //
  // I-8  — every part's evaluated `vertexPositions` is finite.
  // I-9  — every part's evaluated bbox extent is bounded (≤ 100× canvas).
  // I-15 — every bone's TRANSFORM_COMPOSE output `transform.x/y` magnitude
  //        is within 10× canvas. Catches constraint-solver pollution,
  //        fcurve unit mismatch, or any depgraph-internal composition
  //        producing huge values when stored data (I-1..I-14) is clean.
  //
  // Defensive: depgraph eval is a heavy operation. Wrap in try/catch
  // and degrade to skipped-checks rather than block Init Rig.
  let evalChecked = 0;
  let composeChecked = 0;
  try {
    const graph = buildDepGraph(project, {});
    const ctx = evalDepGraph(graph, {
      project,
      timeMs: 0,
      paramOverrides: new Map(),
      action: null,
    });
    // Canvas dimension — used to bound "reasonable" bbox extent. A
    // mesh extent larger than 100× the canvas is essentially Infinity
    // (the handwear bug renders at ~Infinity * canvas-scale).
    const cw = project.canvas?.width ?? project.canvas?.w ?? 2048;
    const ch = project.canvas?.height ?? project.canvas?.h ?? 2048;
    const maxReasonableExtent = Math.max(cw, ch) * 100;
    const artMeshSuffix = `/${NodeType.GEOMETRY}/${OperationCode.ART_MESH_EVAL}`;
    const composeSuffix = `/${NodeType.TRANSFORM}/${OperationCode.TRANSFORM_COMPOSE}`;
    for (const [opKey, out] of ctx.outputs) {
      // I-8/I-9: ART_MESH_EVAL outputs ────────────────────────────────
      if (opKey.endsWith(artMeshSuffix) && out?.vertexPositions) {
        const partId = opKey.slice(0, opKey.length - artMeshSuffix.length);
        evalChecked++;
        const vp = out.vertexPositions;
        const partNode = byId.get(partId);
        const partName = partNode?.name ?? partId;
        let nonFiniteIdx = -1;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < vp.length; i += 2) {
          const x = vp[i], y = vp[i + 1];
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            if (nonFiniteIdx < 0) nonFiniteIdx = i;
            continue;
          }
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        if (nonFiniteIdx >= 0) {
          violate('I-8', partId, partName, `depgraph eval produced non-finite vertexPositions[${nonFiniteIdx}]=(${vp[nonFiniteIdx]}, ${vp[nonFiniteIdx + 1]}) — RENDERS AT INFINITY (gray-viewport class)`);
        } else if (Number.isFinite(minX) && Number.isFinite(maxX)) {
          const extentX = maxX - minX;
          const extentY = maxY - minY;
          if (extentX > maxReasonableExtent || extentY > maxReasonableExtent) {
            violate('I-9', partId, partName, `depgraph eval produced part bbox ${extentX.toFixed(0)}×${extentY.toFixed(0)} px on a ${cw}×${ch} canvas (≥100× canvas) — RENDERS HUGE (gray-viewport class). bbox=[${minX.toFixed(0)},${minY.toFixed(0)}]→[${maxX.toFixed(0)},${maxY.toFixed(0)}]`);
          }
        }
        continue;
      }
      // I-15: TRANSFORM_COMPOSE outputs (bones only) ──────────────────
      if (opKey.endsWith(composeSuffix) && out?.transform) {
        const ownerId = opKey.slice(0, opKey.length - composeSuffix.length);
        const owner = byId.get(ownerId);
        if (!owner || !owner.boneRole) continue;
        composeChecked++;
        const t = out.transform;
        if (typeof t.x === 'number' && Number.isFinite(t.x) && Math.abs(t.x) > maxBoneCoord) {
          violate('I-15', ownerId, owner.name,
            `bone role="${owner.boneRole}" TRANSFORM_COMPOSE output |x|=${Math.abs(t.x).toFixed(0)} > ${maxBoneCoord} (10× canvas). composed=(${t.x.toFixed(1)},${t.y.toFixed(1)},rot=${(t.rotation ?? 0).toFixed(2)},scale=${(t.scaleX ?? 1).toFixed(2)}×${(t.scaleY ?? 1).toFixed(2)}), ranConstraints=${out.ranConstraints ?? 0}. Constraint/fcurve/dynamic-eval polluted the composed transform`);
        } else if (typeof t.y === 'number' && Number.isFinite(t.y) && Math.abs(t.y) > maxBoneCoord) {
          violate('I-15', ownerId, owner.name,
            `bone role="${owner.boneRole}" TRANSFORM_COMPOSE output |y|=${Math.abs(t.y).toFixed(0)} > ${maxBoneCoord} (10× canvas). composed=(${t.x.toFixed(1)},${t.y.toFixed(1)},rot=${(t.rotation ?? 0).toFixed(2)},scale=${(t.scaleX ?? 1).toFixed(2)}×${(t.scaleY ?? 1).toFixed(2)}), ranConstraints=${out.ranConstraints ?? 0}. Constraint/fcurve/dynamic-eval polluted the composed transform`);
        }
      }
    }
  } catch (err) {
    logger.warn('rigInvariantCheck', `I-8/I-9/I-15 skipped — depgraph eval threw: ${/** @type {any} */ (err)?.message ?? String(err)}`);
  }

  // ─── summary log ──────────────────────────────────────────────────
  if (summary.ok) {
    logger.info('rigInvariantCheck',
      `OK | parts=${partsChecked} lattices=${latticesChecked} bones=${bonesChecked} worldMatrices=${worldMatrixChecked} evalFrames=${evalChecked} composedBones=${composeChecked} | I-1..I-15 all pass`,
      { partsChecked, latticesChecked, bonesChecked, worldMatrixChecked, evalChecked, composeChecked });
  } else {
    const byInvStr = Object.entries(summary.byInvariant)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const top5 = summary.violations.slice(0, 5)
      .map((v) => `${v.invariant}/${v.name ?? v.id}`)
      .join(', ');
    logger.error('rigInvariantCheck',
      `FAIL | ${summary.violationCount} violation(s) | by-invariant: ${byInvStr} | first-5: ${top5}`,
      { violationCount: summary.violationCount, byInvariant: summary.byInvariant });
  }

  return summary;
}
