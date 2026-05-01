// @ts-check

/**
 * Per-mesh fingerprint module — the shared mechanism behind GAP-012's
 * Phase A defence (PSD reimport invalidation detection).
 *
 * # The problem this exists to solve
 *
 * The seeded rig stores (`faceParallax`, `bodyWarp`, `rigWarps`,
 * mesh `boneWeights`) hold per-vertex data **positionally indexed**
 * to `node.mesh.vertices`. If the user re-imports a PSD that re-meshes
 * a layer (different vertex count or different topology with the same
 * count), the indexes still line up structurally but point at wrong
 * vertices. The export pipeline then produces a moc3 that interpolates
 * random vertices toward the original silhouette positions —
 * catastrophic but silent.
 *
 * Detecting this is the goal: capture a fingerprint at seed time,
 * recompute on load + reimport, raise a banner on divergence. Don't
 * auto-clear (lossy); let the user decide via re-Init Rig.
 *
 * # Why a positional UV hash and not "sortedUVHashes"
 *
 * The original [NATIVE_RIG_REFACTOR_PLAN.md → ID stability] sketch
 * suggested `hash(vertexCount, triCount, sortedUVHashes)`. We diverge:
 * **positional**, not sorted. Reordering vertices while keeping the
 * UV set the same IS an invalidating change for our use, because
 * `keyform.positions` is positionally indexed to vertex order. A
 * sorted hash would treat the reordered case as identical and miss
 * the silent corruption.
 *
 * Living-doc note: docs/PROJECT_DATA_LAYER.md hole I-1 records this
 * design decision.
 *
 * # Hash choice
 *
 * 32-bit FNV-1a over canonicalised f32 UV bytes plus the two integer
 * counts. Cheap (no Web Crypto async), deterministic, browser-safe,
 * no deps. Collision risk is mitigated by carrying `vertexCount` and
 * `triCount` as raw fields in the signature record alongside the
 * hash — even on a hash collision, the count fields still flag a
 * mismatch when geometry size changes.
 *
 * @module io/meshSignature
 */

/**
 * @typedef {Object} MeshSignature
 *   Per-mesh fingerprint. Compares with `signaturesEqual`. Stable
 *   across processes (FNV-1a is byte-deterministic and we
 *   canonicalise UVs to f32 before hashing).
 * @property {number} vertexCount    integer; raw count of mesh.vertices
 * @property {number} triCount       integer; raw count of mesh.triangles
 * @property {number} uvHash         u32 FNV-1a over positional f32 UV bytes
 */

/**
 * Hash a sequence of UVs as positional f32 bytes via FNV-1a-32.
 * Canonicalises the input to a fresh Float32Array so caller-side
 * Array vs Float32Array (and incidental f64→f32 rounding) doesn't
 * affect the result.
 *
 * Returns 0 when uvs is missing — caller still has vertexCount +
 * triCount in the signature record so a no-uvs mesh is still
 * distinguishable from an empty one.
 *
 * @param {ArrayLike<number>|null|undefined} uvs
 * @param {number} expectedFloatCount  vertexCount * 2 — clamps the byte
 *   window so a stale-trailing-uvs array doesn't change the hash.
 * @returns {number}
 */
function hashUVs(uvs, expectedFloatCount) {
  if (!uvs || expectedFloatCount <= 0) return 0;
  const f32 = uvs instanceof Float32Array
    ? uvs
    : Float32Array.from(uvs);
  const clampedFloats = Math.min(f32.length, expectedFloatCount);
  const view = new Uint8Array(f32.buffer, f32.byteOffset, clampedFloats * 4);
  let h = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    h ^= view[i];
    // FNV-1a 32 prime = 16777619 = 1<<24 + 1<<8 + 1<<7 + 1<<4 + 1<<1 + 1
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

/**
 * Compute a fingerprint for a single mesh.
 *
 * Returns a record with all-zero counts/hash when mesh is null or
 * lacks vertices/triangles — the signature is still well-formed,
 * just compares unequal to any populated mesh.
 *
 * @param {object|null|undefined} mesh
 *   The `node.mesh` object. Expected shape: `{ vertices: Array, triangles: Array, uvs: Float32Array|Array }`.
 * @returns {MeshSignature}
 */
export function meshSignature(mesh) {
  if (!mesh || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles)) {
    return { vertexCount: 0, triCount: 0, uvHash: 0 };
  }
  const vertexCount = mesh.vertices.length;
  const triCount = mesh.triangles.length;
  const uvHash = hashUVs(mesh.uvs, vertexCount * 2);
  return { vertexCount, triCount, uvHash };
}

/**
 * Compare two signatures for byte-equality. Treats null/undefined as
 * unequal to any signature (including null/undefined) — caller code
 * should fall back to "consider stale" on a missing prior signature.
 *
 * @param {MeshSignature|null|undefined} a
 * @param {MeshSignature|null|undefined} b
 * @returns {boolean}
 */
export function signaturesEqual(a, b) {
  if (!a || !b) return false;
  return a.vertexCount === b.vertexCount
      && a.triCount === b.triCount
      && a.uvHash === b.uvHash;
}

/**
 * Compute signatures for all part-type nodes in the project that
 * carry a mesh. Returns a `{ [partId]: signature }` map; nodes
 * without a mesh are omitted. Pure; doesn't mutate input.
 *
 * @param {object} project
 * @returns {Record<string, MeshSignature>}
 */
export function computeProjectSignatures(project) {
  const out = {};
  if (!project || !Array.isArray(project.nodes)) return out;
  for (const node of project.nodes) {
    if (!node || node.type !== 'part') continue;
    if (!node.mesh) continue;
    out[node.id] = meshSignature(node.mesh);
  }
  return out;
}

/**
 * @typedef {Object} ValidationReport
 * @property {string[]} stale
 *   Part IDs whose current signature differs from the seeded one.
 * @property {string[]} missing
 *   Part IDs that were seeded but no longer exist (mesh removed).
 * @property {string[]} unseededNew
 *   Part IDs that exist now but were not seeded (mesh added since
 *   last seedAllRig). Treat as "uncovered by current rig data".
 * @property {string[]} ok
 *   Part IDs whose signature matches.
 */

/**
 * Validate the project's current mesh state against the signatures
 * captured at seed time (`project.meshSignatures`). Detection-only —
 * caller decides how to surface (`useLogsStore` warn + UI banner).
 *
 * Edge cases:
 * - No prior signatures (`project.meshSignatures` null/empty): all
 *   current part IDs land in `unseededNew`. This is the "fresh project,
 *   no Init Rig run yet" case; caller should ignore the report.
 * - Returns `ok` empty when no signatures stored — that, combined
 *   with all parts in `unseededNew`, signals "no rig seed exists".
 *
 * @param {object} project
 * @returns {ValidationReport}
 */
export function validateProjectSignatures(project) {
  /** @type {ValidationReport} */
  const report = { stale: [], missing: [], unseededNew: [], ok: [] };
  const stored = project?.meshSignatures ?? null;
  const current = computeProjectSignatures(project);

  if (!stored || typeof stored !== 'object' || Object.keys(stored).length === 0) {
    report.unseededNew.push(...Object.keys(current));
    return report;
  }

  for (const [partId, sig] of Object.entries(current)) {
    const prior = stored[partId];
    if (!prior) { report.unseededNew.push(partId); continue; }
    if (signaturesEqual(sig, prior)) { report.ok.push(partId); continue; }
    report.stale.push(partId);
  }
  for (const partId of Object.keys(stored)) {
    if (!current[partId]) report.missing.push(partId);
  }
  return report;
}

/**
 * True when a validation report contains any divergence. Helper for
 * UI banner gating.
 *
 * Note: `unseededNew` doesn't count by itself — fresh part imports
 * before Init Rig is run are normal. Only `stale` (changed
 * geometry) and `missing` (deleted) count as "the rig data is stale".
 *
 * @param {ValidationReport} report
 * @returns {boolean}
 */
export function hasStaleRigData(report) {
  return report.stale.length > 0 || report.missing.length > 0;
}
