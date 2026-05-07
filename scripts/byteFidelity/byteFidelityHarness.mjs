// @ts-check

/**
 * Byte-fidelity harness for Stretchy Studio's Live2D export pipeline.
 *
 * Phase 0.4 of the Blender Parity V2 plan. The harness is the GATE for
 * every subsequent V2 phase: each engine refactor must produce
 * byte-identical .cmo3 / .moc3 output against the pre-V2 baseline.
 *
 * # What's pinned
 *
 * - **.cmo3** (Cubism Editor project) — opens cleanly in Cubism Editor;
 *   round-trips through Init Rig → cmo3writer.
 * - **.moc3** (Cubism runtime binary) — section data, parameter list,
 *   keyform tables, art mesh frames.
 *
 * # What's NOT pinned (out of harness scope)
 *
 * - Per-frame physics tick output (depends on RNG seed + timing; pinned
 *   separately by `test_breathFidelity` and `test_cubismPhysicsKernel`).
 * - PNG atlas bytes (depends on browser canvas + texture imports — only
 *   meaningful in browser-runtime tests).
 *
 * # Running the manual gate
 *
 * 1. Open Shelby in Stretchy Studio (PSD → Init Rig → save as `.stretch`).
 * 2. Export the model: `.cmo3` + Live2D runtime ZIP (`.moc3`).
 * 3. Snapshot the three files BEFORE running V2 phase work:
 *      shelby_baseline.stretch
 *      shelby_baseline.cmo3
 *      shelby_baseline.moc3
 *    (Keep them outside the repo — they're large + character-specific.)
 * 4. After every V2 flip:
 *      $env:SHELBY_FIXTURE       = "C:\path\to\shelby_baseline.stretch"
 *      $env:SHELBY_BASELINE_CMO3 = "C:\path\to\shelby_baseline.cmo3"
 *      $env:SHELBY_BASELINE_MOC3 = "C:\path\to\shelby_baseline.moc3"
 *      node scripts/byteFidelity/check_shelby.mjs
 * 5. Diff must be ZERO bytes. Any divergence halts the V2 phase rollout.
 *
 * # Cold/warm physics start (Audit Gap B)
 *
 * The .cmo3 / .moc3 themselves are STATIC — they don't depend on
 * physics state. So this harness produces them once and diffs once.
 * The "warm 60 frames" gate applies only to per-frame eval tests added
 * in Phase D-4 (`test_depgraph_eval_physics`), not here.
 *
 * @module scripts/byteFidelity/byteFidelityHarness
 */

import { generateMoc3 } from '../../src/io/live2d/moc3writer.js';
import { migrateProject } from '../../src/store/projectMigrations.js';

/**
 * Compute a stable hash of an ArrayBuffer for quick diff signaling. Not
 * cryptographic — FNV-1a over the bytes. Sufficient to detect any
 * single-byte divergence with negligible collision probability for
 * file-sized inputs.
 *
 * @param {ArrayBuffer | Uint8Array} buf
 * @returns {string} hex string
 */
export function fnv1aHashBuffer(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Compare two byte buffers and return a structured diff report. Stops
 * counting after `maxOffsets` divergences to keep memory bounded on
 * pathological inputs. The first divergence offset is always reported.
 *
 * @param {ArrayBuffer | Uint8Array} actual
 * @param {ArrayBuffer | Uint8Array} expected
 * @param {{ maxOffsets?: number }} [opts]
 * @returns {{
 *   identical: boolean,
 *   actualLen: number,
 *   expectedLen: number,
 *   firstDivergenceAt: number | null,
 *   divergentByteCount: number,
 *   actualHash: string,
 *   expectedHash: string,
 * }}
 */
export function diffBuffers(actual, expected, opts = {}) {
  const maxOffsets = opts.maxOffsets ?? 4096;
  const a = actual instanceof Uint8Array ? actual : new Uint8Array(actual);
  const b = expected instanceof Uint8Array ? expected : new Uint8Array(expected);
  const aHash = fnv1aHashBuffer(a);
  const bHash = fnv1aHashBuffer(b);
  if (aHash === bHash && a.length === b.length) {
    return {
      identical: true,
      actualLen: a.length,
      expectedLen: b.length,
      firstDivergenceAt: null,
      divergentByteCount: 0,
      actualHash: aHash,
      expectedHash: bHash,
    };
  }
  const minLen = Math.min(a.length, b.length);
  let firstDivergenceAt = null;
  let divergentByteCount = 0;
  for (let i = 0; i < minLen && divergentByteCount < maxOffsets; i++) {
    if (a[i] !== b[i]) {
      if (firstDivergenceAt === null) firstDivergenceAt = i;
      divergentByteCount++;
    }
  }
  if (a.length !== b.length && firstDivergenceAt === null) {
    firstDivergenceAt = minLen;
  }
  return {
    identical: false,
    actualLen: a.length,
    expectedLen: b.length,
    firstDivergenceAt,
    divergentByteCount: divergentByteCount + Math.abs(a.length - b.length),
    actualHash: aHash,
    expectedHash: bHash,
  };
}

/**
 * Generate a .moc3 ArrayBuffer from a project + Moc3Input options.
 * Pure function — no side effects on the project. The caller is
 * responsible for running migrations / Init Rig / etc. before calling.
 *
 * @param {object} project
 * @param {Partial<import('../../src/io/live2d/moc3writer.js').Moc3Input>} extras
 * @returns {ArrayBuffer}
 */
export function exportMoc3Buffer(project, extras = {}) {
  return generateMoc3({
    project,
    regions: extras.regions ?? new Map(),
    atlasSize: extras.atlasSize ?? 2048,
    numAtlases: extras.numAtlases ?? 1,
    generateRig: extras.generateRig ?? true,
    rigSpec: extras.rigSpec ?? null,
    ...extras,
  });
}

/**
 * Migrate a project + run any pre-export steps (no Init Rig — the
 * harness assumes the project is already seeded; pass a project that
 * the user ran Init Rig on once and saved).
 *
 * Phase 0 invariant: pre-V2 vs post-V2 .moc3 bytes are byte-identical
 * for the same input project. This function runs the migration chain
 * (which is now v21-aware), exporting from the migrated state.
 *
 * @param {object} project - parsed `project.json` (will be migrated in place)
 * @returns {object} - the migrated project
 */
export function prepareProject(project) {
  return migrateProject(project);
}

/**
 * Convenience runner — takes a parsed project + (optional) baseline
 * moc3 bytes; returns a structured diff. Used by both the Shelby CLI
 * and the smoke test.
 *
 * @param {object} project
 * @param {ArrayBuffer | Uint8Array | null} baselineMoc3
 * @param {Partial<import('../../src/io/live2d/moc3writer.js').Moc3Input>} [moc3Extras]
 * @returns {{
 *   moc3Diff: ReturnType<typeof diffBuffers> | null,
 *   moc3Bytes: ArrayBuffer,
 *   migratedSchemaVersion: number,
 * }}
 */
export function runByteFidelitySweep(project, baselineMoc3, moc3Extras = {}) {
  const migrated = prepareProject(project);
  const moc3Bytes = exportMoc3Buffer(migrated, moc3Extras);
  const moc3Diff = baselineMoc3 == null
    ? null
    : diffBuffers(moc3Bytes, baselineMoc3);
  return {
    moc3Diff,
    moc3Bytes,
    migratedSchemaVersion: migrated.schemaVersion ?? 0,
  };
}
