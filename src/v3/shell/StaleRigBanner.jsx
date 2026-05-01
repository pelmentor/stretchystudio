/**
 * Stale-rig banner (GAP-012 step 2 / closes Hole I-10 detection).
 *
 * Detects when the project's per-mesh fingerprints (captured at the
 * last `seedAllRig`) diverge from the current geometry — the
 * "user re-imported PSD with re-meshed layer; warp keyforms now point
 * at wrong vertices" silent-corruption case. Surfaces a warning row
 * under the Topbar; offers Re-Init Rig (destructive, but the only
 * non-lossy fix) and Dismiss (stays gone for this session).
 *
 * Detection-only by design — auto-clearing the seeded rig data on
 * divergence would lose user customisations. The banner sits in the
 * loop between detection (`validateProjectSignatures`) and
 * remediation (the user clicking re-init).
 *
 * # Why a session-only dismissal
 *
 * The fingerprint state is what's "stale" — until a re-init happens,
 * the divergence is genuine and reappears on every mount. Persisting
 * dismissal across reloads would let the user permanently silence a
 * real problem. Session-only dismissal is the right tradeoff: it
 * stays out of the way during a single editing session but reappears
 * on next launch as a reminder.
 *
 * @module v3/shell/StaleRigBanner
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '../../components/ui/button.jsx';
import { useProjectStore } from '../../store/projectStore.js';
import {
  validateProjectSignatures,
  hasStaleRigData,
} from '../../io/meshSignature.js';
import { logger } from '../../lib/logger.js';
import { initializeRig } from '../../services/RigService.js';

export function StaleRigBanner() {
  const project = useProjectStore((s) => s.project);
  const [dismissed, setDismissed] = useState(false);

  // Recompute on every project change. Cheap relative to React's render
  // budget — FNV-1a over Float32Array bytes for a few hundred meshes
  // takes <1ms in profile. We deliberately don't add staleness caching
  // because false-stale (banner hangs around after a fix) is worse than
  // the recompute cost.
  const report = useMemo(
    () => validateProjectSignatures(project),
    [project]
  );

  const stale = hasStaleRigData(report);
  const staleCount = report.stale.length;
  const missingCount = report.missing.length;

  // Re-show the banner whenever a new divergence appears (load, reimport).
  // Tracked by the count so dismissal of N=2 doesn't permanently silence
  // a later N=5.
  useEffect(() => {
    setDismissed(false);
  }, [staleCount, missingCount]);

  // Emit one structured warn per project change with a divergence —
  // the Logs panel becomes the per-mesh detail surface.
  useEffect(() => {
    if (!stale) return;
    logger.warn('staleRig',
      `${staleCount} mesh(es) changed since last Init Rig` +
      (missingCount ? `; ${missingCount} removed` : ''),
      { stale: report.stale, missing: report.missing }
    );
  }, [stale, staleCount, missingCount, report.stale, report.missing]);

  if (!stale || dismissed) return null;

  const summary =
    staleCount > 0 && missingCount > 0
      ? `${staleCount} mesh${staleCount === 1 ? '' : 'es'} changed, ${missingCount} removed`
      : staleCount > 0
        ? `${staleCount} mesh${staleCount === 1 ? '' : 'es'} changed since last Init Rig`
        : `${missingCount} seeded mesh${missingCount === 1 ? '' : 'es'} removed since last Init Rig`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-1.5 border-b bg-amber-500/10 text-amber-900 dark:text-amber-100 text-xs shrink-0"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">
        <strong className="font-semibold">PSD changes detected.</strong>{' '}
        {summary} — rig keyforms may deform wrong vertices. See Logs panel for per-mesh detail.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-[11px] border-amber-500/40 hover:bg-amber-500/20"
        onClick={() => {
          // Re-Init Rig is currently the destructive remediation. Future:
          // a "preserve customisations" mode (Phase B) that re-derives
          // only changed meshes, leaving unchanged-mesh seeds intact.
          initializeRig().catch((err) => {
            logger.error('staleRig', `Re-Init Rig failed: ${err?.message ?? err}`);
          });
        }}
      >
        Re-Init Rig
      </Button>
      <button
        type="button"
        aria-label="Dismiss for this session"
        className="p-1 rounded hover:bg-amber-500/20"
        onClick={() => setDismissed(true)}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
