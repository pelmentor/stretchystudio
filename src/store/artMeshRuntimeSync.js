// @ts-check

/**
 * Persistence helper — write `rigSpec.artMeshes[i]` runtime fields
 * (`bindings + keyforms`) into `project.nodes[i].mesh.runtime`.
 *
 * # Why
 *
 * BUG-NECK_NULL_BBOX's sister bug: arms physics + head over-movement +
 * silently broken eye closure / variant fades / neck-corner offsets
 * after save→load (and immediately post Init Rig, because the auto-fill
 * subscriber in `rigSpecStore.js` overwrites the full rigSpec from
 * `generateCmo3` with the fast `selectRigSpec(project)` rebuild).
 *
 * `selectRigSpec._buildArtMeshes` synthesises a minimal art mesh
 * (single rest keyform, zero bindings). `generateCmo3` produces full
 * art meshes with N keyforms binding to `ParamRotation_<elbow>` /
 * `ParamEyeLOpen` / etc. — the difference is what makes the bone-baked
 * + eye-closure + variant + face-cornering effects work at runtime.
 *
 * This helper closes the gap by mirroring the FULL rigSpec output into
 * `project.nodes[i].mesh.runtime` after every Init Rig (or per-stage
 * refit). `selectRigSpec` then reads from there.
 *
 * # Storage shape
 *
 *   ```
 *   part.mesh.runtime = {
 *     bindings: [{ parameterId, keys, interpolation }, ...],
 *     keyforms: [{ keyTuple, vertexPositions, opacity }, ...],
 *   }
 *   ```
 *
 * The `runtime.parent` cache (was: `{type, id}` pointer to the part's
 * modifier-chain leaf) was retired in RULE-№4 Slice M3.3 (2026-05-23).
 * Live-runtime readers were removed in M3.1 (`selectRigSpec`) and M3.2
 * (`synthesizeModifierStacks` derives the leaf from project topology via
 * `findInnermostBodyWarpId`). M3.3 dropped the last reader (the v44
 * migration's redundant OR-branch) and this writer, and registered v47
 * to strip the field from persisted projects on load.
 *
 * `vertexPositions` are stored as plain `Array<number>` (JSON-friendly).
 * The runtime evaluator (`chainEval` → `evalArtMesh`) accepts either
 * plain Array or Float32Array; copying back to typed-array happens at
 * `selectRigSpec` read time via `coerceFloat32Array`.
 *
 * # Idempotence
 *
 * Re-running `persistArtMeshRuntime` on the same harvest is a no-op:
 * the writes are pure replacements keyed by part id. Parts not in the
 * harvest's artMeshes list have their existing `mesh.runtime` cleared
 * — this matches `seedAllRig`'s `'replace'` mode semantics; rig data
 * for unrigged parts becomes stale otherwise.
 *
 * # User-authored markers
 *
 * v1 of this helper does NOT honour a `mesh.runtime._userAuthored`
 * flag because no UI surface today edits art mesh keyforms directly
 * (V4 keyform editor edits `node.mesh.bakedKeyforms` on deformer
 * nodes, not on art mesh parts). When such a UI lands, this helper
 * gains a `mode: 'merge'` branch that preserves authored entries.
 *
 * @module store/artMeshRuntimeSync
 */

import { getMesh } from './objectDataAccess.js';

/**
 * Coerce a typed-array or plain-array into a JSON-friendly plain
 * `Array<number>`. Used at write time to convert `Float32Array`
 * vertex positions into JSON-serialisable form.
 *
 * @param {ArrayLike<number> | undefined | null} arr
 * @returns {Array<number>}
 */
function _toPlainArray(arr) {
  if (!arr) return [];
  if (Array.isArray(arr)) return arr.slice();
  // Typed array (Float32Array, Float64Array, …): Array.from gives a
  // fresh plain Array of the numeric values.
  return Array.from(arr);
}

/**
 * Walk an art mesh spec's bindings and produce a JSON-friendly copy.
 *
 * @param {Array<{parameterId:string, keys:ArrayLike<number>, interpolation?:string}>} bindings
 * @returns {Array<object>}
 */
function _serialiseBindings(bindings) {
  if (!Array.isArray(bindings)) return [];
  const out = [];
  for (const b of bindings) {
    if (!b || typeof b.parameterId !== 'string') continue;
    out.push({
      parameterId: b.parameterId,
      keys: _toPlainArray(b.keys),
      interpolation: b.interpolation ?? 'LINEAR',
    });
  }
  return out;
}

/**
 * Walk an art mesh spec's keyforms and produce a JSON-friendly copy.
 *
 * @param {Array<{keyTuple:ArrayLike<number>, vertexPositions:ArrayLike<number>, opacity?:number, drawOrder?:number}>} keyforms
 * @returns {Array<object>}
 */
function _serialiseKeyforms(keyforms) {
  if (!Array.isArray(keyforms)) return [];
  const out = [];
  for (const k of keyforms) {
    if (!k) continue;
    /** @type {Record<string, unknown>} */
    const entry = {
      keyTuple: _toPlainArray(k.keyTuple),
      vertexPositions: _toPlainArray(k.vertexPositions),
      opacity: typeof k.opacity === 'number' ? k.opacity : 1,
    };
    if (typeof k.drawOrder === 'number') {
      entry.drawOrder = k.drawOrder;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Persist `rigSpec.artMeshes` runtime data into `project.nodes`.
 * Mutates `project` in place.
 *
 * Mode `'replace'` (default) — every part's `mesh.runtime` is rebuilt
 * from the rigSpec's matching artMesh entry; parts without a matching
 * entry have their `mesh.runtime` cleared.
 *
 * Mode `'merge'` (per-stage refit) — same as replace today; will gain
 * `_userAuthored` preservation when an art-mesh-keyform UI ships.
 *
 * A-1 (R4) — read mesh via `getMesh(node, project)` so post-v18 parts
 * (which delete `node.mesh` and route geometry through a sibling
 * `{type:'meshData', id: node.dataId}` node) actually receive the
 * runtime write. Pre-fix the function was a silent no-op for every part
 * post-v18 because the `if (!node.mesh) continue` guard skipped them
 * all — exactly the failure mode this file's header warns about.
 *
 * @param {object} project - mutated in place
 * @param {{artMeshes?: Array<object>}} rigSpec
 * @param {'replace'|'merge'} [mode='replace']
 */
export function persistArtMeshRuntime(project, rigSpec, mode = 'replace') {
  if (!project || !Array.isArray(project.nodes)) return;
  const artMeshes = Array.isArray(rigSpec?.artMeshes) ? rigSpec.artMeshes : [];

  // Index art meshes by id (= partId) for O(1) part lookup.
  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const am of artMeshes) {
    if (am && typeof am.id === 'string') byId.set(am.id, am);
  }

  for (const node of project.nodes) {
    if (!node || node.type !== 'part') continue;
    const mesh = getMesh(node, project);
    if (!mesh || typeof mesh !== 'object') continue;
    const am = byId.get(node.id);
    if (am) {
      mesh.runtime = {
        bindings: _serialiseBindings(am.bindings),
        keyforms: _serialiseKeyforms(am.keyforms),
      };
    } else if (mode === 'replace') {
      // Part has no matching artMesh — clear stale runtime so it
      // doesn't lie about the current rig shape.
      if (mesh.runtime) delete mesh.runtime;
    }
  }
}
