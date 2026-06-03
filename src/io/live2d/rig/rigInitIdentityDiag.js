// @ts-check

/**
 * Post-Init-Rig rest-divergence diagnostic.
 *
 * The user-visible complaint that originally motivated this probe (2026-
 * 05-12 PP2-005b): some parts visibly shift after Init Rig — hair sways/
 * tilts under no params, eyes drop, etc. Run the depgraph (sole viewport
 * engine since the Phase 7 close-out) once at default params and compare
 * each rig-driven art mesh's output vs its stored `verticesCanvas`
 * source. Anything > 1px is real divergence. Logged per-part so the next
 * user repro names the offender.
 *
 * # Why this is a POST-seed function (2026-06-03 fix)
 *
 * Pre-fix this probe lived inside `initRig.js`'s `harvestRigSpec` —
 * which runs BEFORE `seedAllRig` populates `project.nodes[]` with
 * modifier stacks. `evalProjectFrameViaDepgraph` consumes `project.nodes`
 * directly, so the eval returned `frames = []` every Init Rig and the
 * log said `partCount: 0` regardless of any actual divergence. The
 * function silently lied. Per [[no-crutches-rule-one]], a diagnostic
 * that prints "0 parts" for a 19-part rig is worse than no diagnostic.
 *
 * Fix: lift the probe out of harvest and call it from `RigService`
 * after `seedAllRig` returns. Now `project.nodes` carries the seeded
 * modifier stacks and depgraph eval surfaces every part.
 *
 * I-21 (rigInvariantCheck per-part bbox CENTER drift) catches a similar
 * class of bug but with a much looser threshold (`0.25 × canvas` ≈ 448 px
 * on a 1792 canvas) — designed for "renders in wrong place" symptoms.
 * This diagnostic complements it with a 1px per-vertex threshold for
 * subtle drifts the bbox-center bracket can't see.
 *
 * @module io/live2d/rig/rigInitIdentityDiag
 */

import { evalProjectFrameViaDepgraph } from '../../../anim/depgraph/evalProjectFrame.js';
import { logger } from '../../../lib/logger.js';

/**
 * @typedef {Object} RigInitIdentityDiagOpts
 * @property {string[]} [disabledSubsystems] - subsystem keys whose rules
 *   were filtered out during seed (e.g. `['hairRig', 'armPhysics']`).
 *   Logged in the diagnostic message for parity with the V3 subsystems
 *   opt-out UI.
 */

/**
 * Run the rest-divergence probe and emit one `logger.info` line with
 * the smoking-gun fields inlined into the message string (per
 * [[inline-diagnostic-fields]] — user console paste collapses Object
 * payload to `[object Object]`).
 *
 * Non-fatal on throw — instrumentation only. The depgraph eval can
 * legitimately fail on partially-seeded projects; the probe swallows
 * the throw and emits a `logger.warn` so the failure is visible
 * without blocking Init Rig.
 *
 * @param {any} project - post-seed project (`project.nodes` MUST have
 *                        modifier stacks; pre-seed projects skip every
 *                        part and the log says "0 parts").
 * @param {any} rigSpec - the rigSpec returned by `harvestRigSpec`
 *                        (read for `artMeshes[].verticesCanvas` as the
 *                        authored source of truth and for the rigSpec
 *                        the depgraph eval routes through for
 *                        modifier-toggle reprojection).
 * @param {RigInitIdentityDiagOpts} [opts]
 */
export function runRigInitIdentityDiag(project, rigSpec, opts = {}) {
  const disabledSubsystems = Array.isArray(opts.disabledSubsystems)
    ? opts.disabledSubsystems
    : [];
  if (!rigSpec || !Array.isArray(rigSpec.artMeshes) || rigSpec.artMeshes.length === 0) {
    return;
  }
  try {
    // The `rigSpec` option is REQUIRED so `selectRigSpec`'s modifier-
    // toggle reprojection fires; without it the raw `mesh.runtime` cache
    // is in the baked leaf frame and toggled-off modifiers land verts
    // in the wrong space. Default params + no animation → rest pose.
    const frames = evalProjectFrameViaDepgraph(project, {}, { rigSpec });
    /** @type {Map<string, any>} */
    const meshById = new Map();
    for (const m of rigSpec.artMeshes) {
      if (m?.id) meshById.set(m.id, m);
    }
    /** @type {Array<{partId:string, name:string, maxDelta:number}>} */
    const offenders = [];
    let maxOverall = 0;
    for (const f of frames) {
      const meshSpec = meshById.get(f.id);
      const source = meshSpec?.verticesCanvas;
      if (!source || !f.vertexPositions) continue;
      const len = Math.min(source.length, f.vertexPositions.length);
      let partMax = 0;
      for (let i = 0; i < len; i++) {
        const d = Math.abs(source[i] - f.vertexPositions[i]);
        if (d > partMax) partMax = d;
      }
      if (partMax > maxOverall) maxOverall = partMax;
      if (partMax > 1.0) {
        offenders.push({ partId: f.id, name: meshSpec?.name ?? f.id, maxDelta: partMax });
      }
    }
    // Top 10 by delta — keeps the log readable on large rigs.
    offenders.sort((a, b) => b.maxDelta - a.maxDelta);
    const disabledNote = disabledSubsystems.length > 0
      ? ` (subsystems off: ${disabledSubsystems.join(', ')})`
      : '';
    const top10Str = offenders.slice(0, 10)
      .map((o) => `${o.name}=${o.maxDelta.toFixed(1)}px`)
      .join(', ');
    logger.info('rigInitIdentityDiag',
      `Init Rig rest-divergence${disabledNote}: max ${maxOverall.toFixed(2)} px across ${frames.length} parts; ${offenders.length} offenders > 1 px${offenders.length > 0 ? ` | top: ${top10Str}` : ''}`,
      {
        disabledSubsystems: disabledSubsystems.length > 0 ? disabledSubsystems : undefined,
        maxOverallPx: Math.round(maxOverall * 100) / 100,
        partCount: frames.length,
        offenderCount: offenders.length,
        top10Offenders: offenders.slice(0, 10).map((o) => ({
          partId: o.partId, name: o.name, maxDeltaPx: Math.round(o.maxDelta * 100) / 100,
        })),
      });
  } catch (err) {
    logger.warn('rigInitIdentityDiag', 'identity-divergence probe threw', {
      error: /** @type {any} */ (err)?.message ?? String(err),
    });
  }
}
