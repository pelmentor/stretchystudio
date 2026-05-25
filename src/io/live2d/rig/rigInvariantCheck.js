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
 * Returns a summary object so callers can also assert programmatically
 * (used by the framework's own unit tests).
 *
 * @module io/live2d/rig/rigInvariantCheck
 */

import { logger } from '../../../lib/logger.js';

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

  // ─── I-7 — bone pivot finiteness ──────────────────────────────────
  let bonesChecked = 0;
  for (const n of nodes) {
    if (!n || !n.boneRole) continue;
    bonesChecked++;
    const px = n.transform?.pivotX;
    const py = n.transform?.pivotY;
    if (typeof px !== 'number' || !Number.isFinite(px) || typeof py !== 'number' || !Number.isFinite(py)) {
      violate('I-7', n.id, n.name, `bone role="${n.boneRole}" has non-finite pivot (pivotX=${px} pivotY=${py})`);
    }
  }

  // ─── summary log ──────────────────────────────────────────────────
  if (summary.ok) {
    logger.info('rigInvariantCheck',
      `OK | parts=${partsChecked} lattices=${latticesChecked} bones=${bonesChecked} | I-1..I-7 all pass`,
      { partsChecked, latticesChecked, bonesChecked });
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
