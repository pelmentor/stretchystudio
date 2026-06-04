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
 *   I-16 — STATIC bone world matrix NON-TRANSLATION magnitude. I-14
 *         catches huge m[6]/m[7] (translation column). I-16 catches
 *         huge m[0]/m[4] (scale) and m[1]/m[3] (shear) — the matrix
 *         components fed into the linear part of bone-skinning
 *         `px = m[0]·x + m[3]·y + m[6]`. A scale of 1000 multiplies
 *         every vertex x by 1000 before translation; rendering is
 *         identically huge to a 1000-px translation. Threshold 100
 *         (same as I-10's per-bone stored-scale ceiling). Together
 *         with I-14: stored-data composition produces a clean matrix
 *         iff BOTH I-14 AND I-16 pass.
 *
 *   I-17 — Depgraph TRANSFORM_COMPOSE scale magnitude (bones only).
 *         Sister of I-16 on the eval-time path. `|t.scaleX|, |t.scaleY|
 *         ≤ 100`. Catches eval-time scale blowup: constraint solver
 *         amplification, animated scale fcurve unit mismatch, or
 *         compose-cascade. Pairs with I-15 the same way I-16 pairs
 *         with I-14.
 *
 *   I-18 — Keyform vertexPositions MAGNITUDE. I-5 catches NaN; I-18
 *         catches huge-but-finite values. Each vertex coordinate must
 *         lie within `±10 × max(canvas)`. Catches rest geometry that
 *         enters the ART_MESH_EVAL pipeline already huge (bake step
 *         reading wrong `mesh.vertices` shape per
 *         [[mesh-vertices-dual-shape]], PSD ingest writing
 *         object-indices through a flat-array slot, or upstream
 *         transform-bake producing out-of-canvas coords).
 *
 *   I-19 — EVAL-TIME bone WORLD matrix magnitude (chain product). The
 *         matrix `applyBonePostChainSkin` actually multiplies into the
 *         vertex buffer — built by `resolveBoneWorldFromCtx` walking
 *         the parent chain at eval time using composed-pose-derived
 *         locals. I-14/I-16 measure static composition (stored
 *         transform algebra). I-15/I-17 measure per-bone composed
 *         transform. Neither catches the chain product: per-bone
 *         composed scale ≤ 100 (I-17 passes) can compound to `100^N`
 *         over an N-depth chain. Five bones at scale 4 each → chain
 *         product 1024 → 800× handwear-bbox class. Checks both
 *         translation (m[6]/m[7]) and scale/shear (m[0]/m[4]/m[1]/m[3])
 *         on the eval-time world matrix using the SAME function the
 *         bone-skin kernel calls, so the matrix we inspect IS the
 *         matrix applied to vertices.
 *
 *   I-21 — Part eval bbox CENTER drift from authored mesh.vertices
 *         center at REST POSE. I-9 catches part bbox EXTENT
 *         (RENDERS HUGE). I-21 catches part bbox POSITION shifted
 *         from the authored center (RENDERS-IN-WRONG-PLACE class —
 *         the "head flies into the corner" bug 2026-06-02 where
 *         face/hair/eyes all appear at canvas origin while bbox
 *         extent stayed normal). At rest pose the modifier chain
 *         should be identity for warp-driven parts → eval bbox
 *         center must match authored mesh.vertices bbox center.
 *         Threshold: 0.25 × max(canvas dim) — already "a quarter
 *         canvas away" = corner class.
 *
 *   I-20 — Per-step ART_MESH_EVAL bbox trace for I-9 offenders.
 *         Diagnostic-only: when I-9 fires on a part, re-eval the
 *         depgraph with `ctx.artMeshBboxTrace = Set([partId])` and
 *         `kernelArtMeshEval` captures bbox(bufA) BEFORE the modifier
 *         loop + AFTER each modifier step + AFTER bone-skin. The
 *         per-step bbox lines tell us EXACTLY which modifier blows up
 *         the part's verts. Pinpoints chain-composition bugs that
 *         I-14..I-19 can't catch — e.g. a warp-lift kernel producing
 *         corrupt output, an unexpected modifier in the stack, or a
 *         vertex-frame mismatch at the keyform-blend boundary. Only
 *         runs when I-9 already fired; no overhead on clean rigs.
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
import { resolveBoneWorldFromCtx } from '../../../anim/depgraph/kernels/bonePostChain.js';
import { getMesh } from '../../../store/objectDataAccess.js';

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
    // Skip parts the renderer will skip outright (user-explicit hide via
    // outliner toggle).
    //
    // # Why this is NOT the variant-skip path post-v49 (2026-06-04 audit)
    //
    // Pre-v49, `variantNormalizer.js` set `variant.visible = false` so
    // every detected variant fell here AND was filtered out of every
    // `n.visible !== false` rig pipeline gate (the bug-08 root cause).
    // Variants had empty modifiers because they never entered the rig
    // pipeline; this skip prevented I-1 false positives.
    //
    // Post-v49 (bug-08 closure), variants are `visible:true,
    // opacity:0` — they ENTER the rig pipeline, `seedAllRig` populates
    // their `modifiers[]` from `rigCollector.artMeshes`, and I-1 finds
    // a non-empty stack. So this skip no longer needs a variant-aware
    // branch: variants pass I-1 on their own merits.
    //
    // The skip still has value for user-hidden parts (outliner toggle
    // off): the renderer's `visMap` check at `scenePass.js:219` skips
    // them too, so invariants checking "what will be rendered" should
    // skip them as well. `runRigInvariantChecks` runs only post-seed
    // (`RigService.js:308` + `:610`), so any variant that's empty here
    // is either pre-Init-Rig (shouldn't happen — Init Rig owns this
    // call) or a genuine seed failure (which I-1 SHOULD surface).
    if (n.visible === false) continue;

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
    // I-18: keyform vertexPositions MAGNITUDE — every (x,y) within
    //       10× canvas. Catches huge-but-finite rest geometry that
    //       slipped into a keyform (bone-bake reading the wrong
    //       `mesh.vertices` shape, a PSD layer with corrupted
    //       coordinates, or transform-baked keyforms that fall outside
    //       canvas-px range). I-5 catches NaN; I-18 catches finite-
    //       but-out-of-range — together they bracket the
    //       vertexPositions sanity that feeds ART_MESH_EVAL.
    const keyforms = mesh?.runtime?.keyforms;
    const canvasW5 = project.canvas?.width ?? project.canvas?.w ?? 2048;
    const canvasH5 = project.canvas?.height ?? project.canvas?.h ?? 2048;
    const vertMaxAbs = 10 * Math.max(canvasW5, canvasH5);
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
        let outOfRangeIdx = -1;
        let outOfRangeVal = 0;
        for (let i = 0; i < vec.length; i++) {
          const v = vec.get(i);
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            if (nonFiniteIdx < 0) nonFiniteIdx = i;
            continue;
          }
          if (outOfRangeIdx < 0 && Math.abs(v) > vertMaxAbs) {
            outOfRangeIdx = i;
            outOfRangeVal = v;
          }
        }
        if (nonFiniteIdx >= 0) {
          const sample = vec.get(nonFiniteIdx);
          violate('I-5', n.id, n.name, `keyforms[${ki}].vertexPositions[${nonFiniteIdx}] is non-finite (value=${sample === null ? 'null' : typeof sample === 'object' ? JSON.stringify(sample) : String(sample)})`);
        }
        if (outOfRangeIdx >= 0) {
          const axis = outOfRangeIdx % 2 === 0 ? 'x' : 'y';
          const vertIdx = outOfRangeIdx >> 1;
          violate('I-18', n.id, n.name, `keyforms[${ki}].vertexPositions[${outOfRangeIdx}] (${axis} of vertex ${vertIdx})=${outOfRangeVal.toFixed(0)} exceeds ±${vertMaxAbs} (10× canvas ${canvasW5}×${canvasH5}) — rest geometry already huge BEFORE bone-skin / warp eval. Likely source: bone-bake or PSD ingest read the wrong vertices shape and wrote object-array indices through a flat-array slot`);
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
      // I-16: STATIC composed world matrix NON-TRANSLATION magnitude
      // (scale m[0]/m[4] + shear m[1]/m[3]). I-14 above only catches
      // huge translation in m[6]/m[7] — but matrix-vector mult
      // `px = m[0]·x + m[3]·y + m[6]` blows up equally if scale OR shear
      // is huge with finite translation. Bone-baked skinning
      // (`renderer/boneSkinning.js:248-250`) is exactly this matmul, so
      // a huge m[0] turns canvas-px x=900 into 900× m[0] before
      // adding translation — exactly the handwear-bbox 170K×1.27M
      // class (bug-03 2026-05-25/06-02). Threshold 100 = same ceiling
      // I-10 enforces per-bone individually; product of a chain of
      // I-10-clean bones can still exceed 100 (100^N composition).
      const matCompThreshold = 100;
      const checkComp = (label, val) => {
        if (Number.isFinite(val) && Math.abs(val) > matCompThreshold) {
          violate('I-16', nodeId, node.name,
            `bone role="${node.boneRole}" STATIC-composed world matrix ${label}=${val.toFixed(2)} > ${matCompThreshold} (Blender-clean rigs stay near 1; scale/shear blowup from parent-chain composition). m=[${m[0].toFixed(2)},${m[1].toFixed(2)},${m[3].toFixed(2)},${m[4].toFixed(2)},${tx.toFixed(1)},${ty.toFixed(1)}]. Bone-skinning math (px=m[0]·x+m[3]·y+m[6]) blows up at this magnitude — RENDERS HUGE for any part skinned to this bone`);
        }
      };
      checkComp('m[0]=scaleX', m[0]);
      checkComp('m[4]=scaleY', m[4]);
      checkComp('m[1]=shearXY', m[1]);
      checkComp('m[3]=shearYX', m[3]);
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
          // I-21: eval bbox CENTER drift from authored rest center. I-9
          // catches part bbox EXTENT (RENDERS HUGE class). I-21 catches
          // part bbox POSITION shifted from authored at REST POSE
          // (RENDERS-IN-WRONG-PLACE class — head "flies into the corner"
          // bug 2026-06-02 where face/hair/eyes all appear at canvas
          // origin while bbox extent is still small/normal). At rest
          // pose (params at default), modifier chain SHOULD be identity
          // for face/body-warp parts → eval bbox center MUST match
          // authored mesh.vertices bbox center within a few px. A drift
          // of `0.25 × canvas dim` flags a part displaced by a quarter
          // canvas — already "the corner" class.
          const partMesh = partNode ? getMesh(partNode, project) : null;
          const restVerts = partMesh?.vertices;
          if (Array.isArray(restVerts) && restVerts.length > 0) {
            let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
            const r0 = restVerts[0];
            if (typeof r0 === 'object' && r0 !== null) {
              for (let i = 0; i < restVerts.length; i++) {
                const rv = restVerts[i];
                const rx = rv?.x, ry = rv?.y;
                if (typeof rx === 'number' && Number.isFinite(rx)) {
                  if (rx < rMinX) rMinX = rx; if (rx > rMaxX) rMaxX = rx;
                }
                if (typeof ry === 'number' && Number.isFinite(ry)) {
                  if (ry < rMinY) rMinY = ry; if (ry > rMaxY) rMaxY = ry;
                }
              }
            } else if (typeof r0 === 'number') {
              for (let i = 0; i < restVerts.length; i += 2) {
                const rx = restVerts[i], ry = restVerts[i + 1];
                if (typeof rx === 'number' && Number.isFinite(rx)) {
                  if (rx < rMinX) rMinX = rx; if (rx > rMaxX) rMaxX = rx;
                }
                if (typeof ry === 'number' && Number.isFinite(ry)) {
                  if (ry < rMinY) rMinY = ry; if (ry > rMaxY) rMaxY = ry;
                }
              }
            }
            if (Number.isFinite(rMinX) && Number.isFinite(rMaxX)) {
              const evalCx = (minX + maxX) / 2;
              const evalCy = (minY + maxY) / 2;
              const restCx = (rMinX + rMaxX) / 2;
              const restCy = (rMinY + rMaxY) / 2;
              const driftX = evalCx - restCx;
              const driftY = evalCy - restCy;
              const driftMag = Math.hypot(driftX, driftY);
              const driftThreshold = 0.25 * Math.max(cw, ch);
              if (driftMag > driftThreshold) {
                violate('I-21', partId, partName,
                  `depgraph eval bbox center=(${evalCx.toFixed(0)},${evalCy.toFixed(0)}) drifted ${driftMag.toFixed(0)}px from authored mesh.vertices center=(${restCx.toFixed(0)},${restCy.toFixed(0)}) at REST POSE — RENDERS-IN-WRONG-PLACE class. Threshold ${driftThreshold.toFixed(0)}px (0.25× canvas ${cw}×${ch}). drift=(${driftX.toFixed(0)},${driftY.toFixed(0)}). At rest pose the modifier chain should be identity; this part's chain is producing non-identity translation. Likely cause: a body/face warp's lifted grid is not at rest, OR a parent transform applies non-zero pose at default`);
              }
            }
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
        // I-17: TRANSFORM_COMPOSE scale magnitude. I-15 above only
        // checks translation (`t.x`/`t.y`) — but the composed transform
        // FEEDS the world matrix via `composedTransformToBonePose`
        // → `makeBoneLocalMatrix`, where `scaleX`/`scaleY` populate
        // m[0]/m[4]. A scale of 1000 from eval (constraint solver
        // amplification, fcurve unit mismatch, depgraph cascade) lands
        // in the matrix and blows up bone-skinning identically to I-16
        // but on the runtime path. Same threshold (100) as I-16 / I-10.
        const scaleThreshold = 100;
        if (typeof t.scaleX === 'number' && Number.isFinite(t.scaleX) && Math.abs(t.scaleX) > scaleThreshold) {
          violate('I-17', ownerId, owner.name,
            `bone role="${owner.boneRole}" TRANSFORM_COMPOSE output |scaleX|=${Math.abs(t.scaleX).toFixed(2)} > ${scaleThreshold} (Blender-clean rigs stay near 1). composed=(${(t.x ?? 0).toFixed(1)},${(t.y ?? 0).toFixed(1)},rot=${(t.rotation ?? 0).toFixed(2)},scale=${t.scaleX.toFixed(2)}×${(t.scaleY ?? 1).toFixed(2)}), ranConstraints=${out.ranConstraints ?? 0}. Eval-time scale blowup — any part skinned to this bone RENDERS HUGE`);
        }
        if (typeof t.scaleY === 'number' && Number.isFinite(t.scaleY) && Math.abs(t.scaleY) > scaleThreshold) {
          violate('I-17', ownerId, owner.name,
            `bone role="${owner.boneRole}" TRANSFORM_COMPOSE output |scaleY|=${Math.abs(t.scaleY).toFixed(2)} > ${scaleThreshold} (Blender-clean rigs stay near 1). composed=(${(t.x ?? 0).toFixed(1)},${(t.y ?? 0).toFixed(1)},rot=${(t.rotation ?? 0).toFixed(2)},scale=${(t.scaleX ?? 1).toFixed(2)}×${t.scaleY.toFixed(2)}), ranConstraints=${out.ranConstraints ?? 0}. Eval-time scale blowup — any part skinned to this bone RENDERS HUGE`);
        }
      }
    }
  } catch (err) {
    logger.warn('rigInvariantCheck', `I-8/I-9/I-15 skipped — depgraph eval threw: ${/** @type {any} */ (err)?.message ?? String(err)}`);
  }

  // ─── I-20 — per-step ART_MESH_EVAL bbox trace for I-9 offenders ───
  // When I-9 fires on a part, the chain composition is opaque — we know
  // the FINAL bbox is huge but not WHICH MODIFIER in the stack produced
  // the blowup. I-20 re-runs depgraph eval with `ctx.artMeshBboxTrace`
  // populated for every I-9 offender, then the artMesh kernel captures
  // bbox(bufA) before the loop + after each modifier step + after bone
  // skin. We log per-step bbox so the offending step is named.
  //
  // Doubles eval cost when triggered, but only fires after I-9 already
  // detected breakage — diagnostic-only path, never on a clean rig.
  // The trace itself is opt-in inside kernelArtMeshEval — no overhead
  // on the steady-state hot path.
  const i9Offenders = summary.violations
    .filter((v) => v.invariant === 'I-9')
    .map((v) => v.id);
  if (i9Offenders.length > 0) {
    try {
      const traceSet = new Set(i9Offenders);
      const graph2 = buildDepGraph(project, {});
      const ctx2 = evalDepGraph(graph2, {
        project,
        timeMs: 0,
        paramOverrides: new Map(),
        action: null,
        artMeshBboxTrace: traceSet,
      });
      const results = ctx2.artMeshBboxTraceResults;
      if (results instanceof Map) {
        for (const partId of i9Offenders) {
          const trace = results.get(partId);
          if (!Array.isArray(trace) || trace.length === 0) continue;
          const partNode = byId.get(partId);
          const partName = partNode?.name ?? partId;
          for (let s = 0; s < trace.length; s++) {
            const step = trace[s];
            const ex = Number.isFinite(step.minX) ? step.maxX - step.minX : NaN;
            const ey = Number.isFinite(step.minY) ? step.maxY - step.minY : NaN;
            violate('I-20', partId, partName,
              `step[${s}] "${step.label}" — bbox ${Number.isFinite(ex) ? ex.toFixed(0) : 'NaN'}×${Number.isFinite(ey) ? ey.toFixed(0) : 'NaN'}, range=[${Number.isFinite(step.minX) ? step.minX.toFixed(0) : 'NaN'},${Number.isFinite(step.minY) ? step.minY.toFixed(0) : 'NaN'}]→[${Number.isFinite(step.maxX) ? step.maxX.toFixed(0) : 'NaN'},${Number.isFinite(step.maxY) ? step.maxY.toFixed(0) : 'NaN'}]`);
          }
        }
      }
    } catch (err) {
      logger.warn('rigInvariantCheck', `I-20 trace skipped — re-eval threw: ${/** @type {any} */ (err)?.message ?? String(err)}`);
    }
  }

  // ─── I-19 — EVAL-TIME bone WORLD matrix magnitude (chain product) ──
  // I-14/I-16 measure STATIC `computeWorldMatrices` (stored transform
  // algebra, no constraint/fcurve). I-15/I-17 measure the per-bone
  // TRANSFORM_COMPOSE output. NEITHER measures the eval-time WORLD
  // matrix that `applyBonePostChainSkin` actually consumes — that's
  // built by `resolveBoneWorldFromCtx` walking the parent chain at
  // eval time, using composed-pose-derived locals. Per-bone composed
  // pose is bounded by I-17 (scale ≤ 100), but the CHAIN PRODUCT can
  // multiply: `100^N` for a depth-N chain. Five bones at composed
  // scale 4 each individually pass I-17 (4 < 100), but the chain
  // product is `4^5 = 1024` — handwear bbox 800× class.
  //
  // Runs the SAME `resolveBoneWorldFromCtx` function the bone-skin
  // kernel uses in production, so the matrix we inspect IS the matrix
  // applied to vertices. Same dual-check as I-14/I-16: translation +
  // scale + shear magnitudes.
  let evalWorldChecked = 0;
  try {
    const graph = buildDepGraph(project, {});
    const ctx = evalDepGraph(graph, {
      project,
      timeMs: 0,
      paramOverrides: new Map(),
      action: null,
    });
    const cw19 = project.canvas?.width ?? project.canvas?.w ?? 2048;
    const ch19 = project.canvas?.height ?? project.canvas?.h ?? 2048;
    const maxBoneCoord19 = 10 * Math.max(cw19, ch19);
    const matCompThreshold19 = 100;
    const cache19 = new Map();
    for (const n of nodes) {
      if (!n || !n.boneRole) continue;
      evalWorldChecked++;
      let m;
      try {
        m = resolveBoneWorldFromCtx(n.id, ctx, byId, cache19);
      } catch (err) {
        logger.warn('rigInvariantCheck', `I-19 resolveBoneWorldFromCtx threw for bone "${n.name ?? n.id}": ${/** @type {any} */ (err)?.message ?? String(err)}`);
        continue;
      }
      if (!m || m.length !== 9) continue;
      const tx = m[6], ty = m[7];
      if (Number.isFinite(tx) && Math.abs(tx) > maxBoneCoord19) {
        violate('I-19', n.id, n.name,
          `bone role="${n.boneRole}" EVAL-TIME (resolveBoneWorldFromCtx) world matrix |translation.x|=${Math.abs(tx).toFixed(0)} > ${maxBoneCoord19} (10× canvas). world=(${tx.toFixed(1)},${ty.toFixed(1)}), m=[${m[0].toFixed(2)},${m[1].toFixed(2)},${m[3].toFixed(2)},${m[4].toFixed(2)},${tx.toFixed(1)},${ty.toFixed(1)}]. Chain-composed eval-time matrix blows up where stored algebra (I-14) was clean — constraint solver / pose offset / parent chain multiplied composed-pose locals into a huge product`);
      } else if (Number.isFinite(ty) && Math.abs(ty) > maxBoneCoord19) {
        violate('I-19', n.id, n.name,
          `bone role="${n.boneRole}" EVAL-TIME (resolveBoneWorldFromCtx) world matrix |translation.y|=${Math.abs(ty).toFixed(0)} > ${maxBoneCoord19} (10× canvas). world=(${tx.toFixed(1)},${ty.toFixed(1)}), m=[${m[0].toFixed(2)},${m[1].toFixed(2)},${m[3].toFixed(2)},${m[4].toFixed(2)},${tx.toFixed(1)},${ty.toFixed(1)}]. Chain-composed eval-time matrix blows up where stored algebra (I-14) was clean — constraint solver / pose offset / parent chain multiplied composed-pose locals into a huge product`);
      }
      const checkComp19 = (label, val) => {
        if (Number.isFinite(val) && Math.abs(val) > matCompThreshold19) {
          violate('I-19', n.id, n.name,
            `bone role="${n.boneRole}" EVAL-TIME (resolveBoneWorldFromCtx) world matrix ${label}=${val.toFixed(2)} > ${matCompThreshold19} (chain product). m=[${m[0].toFixed(2)},${m[1].toFixed(2)},${m[3].toFixed(2)},${m[4].toFixed(2)},${tx.toFixed(1)},${ty.toFixed(1)}]. Per-bone I-17 passes (each composed scale ≤ 100) but chain product blew up — the EXACT matrix bone-LBS applies to handwear/vertex skinning. Multiplies every input vertex by this scale before adding translation — RENDERS HUGE`);
        }
      };
      checkComp19('m[0]=scaleX', m[0]);
      checkComp19('m[4]=scaleY', m[4]);
      checkComp19('m[1]=shearXY', m[1]);
      checkComp19('m[3]=shearYX', m[3]);
    }
  } catch (err) {
    logger.warn('rigInvariantCheck', `I-19 skipped — depgraph eval threw: ${/** @type {any} */ (err)?.message ?? String(err)}`);
  }

  // ─── summary log ──────────────────────────────────────────────────
  if (summary.ok) {
    logger.info('rigInvariantCheck',
      `OK | parts=${partsChecked} lattices=${latticesChecked} bones=${bonesChecked} worldMatrices=${worldMatrixChecked} evalFrames=${evalChecked} composedBones=${composeChecked} evalWorld=${evalWorldChecked} | I-1..I-20 all pass`,
      { partsChecked, latticesChecked, bonesChecked, worldMatrixChecked, evalChecked, composeChecked, evalWorldChecked });
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
