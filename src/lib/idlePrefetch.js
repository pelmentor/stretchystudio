// @ts-check

/**
 * Idle prefetch — kick off lazy chunk fetches after the first paint
 * settles, so the first user gesture (click Save / open Properties /
 * drop a PSD) doesn't pay the network round-trip cost.
 *
 * Phase A2 loading sweep (2026-05-09).
 *
 * Each entry is a `() => import('./path')` thunk. We `Promise.allSettled`
 * on the lot so we can emit `boot:idleDone` when the queue drains —
 * the user-perceived "page is settled, no more JS scheduled" marker
 * (caps the boot window started by `boot:firstPaint` in main.jsx).
 * The settled aggregator runs in the background; React.Suspense at
 * the real boundaries resolves the same chunks instantly because Vite
 * dedupes the in-flight requests.
 *
 * Scheduling: requestIdleCallback when available (~50ms slack-time
 * windows), 1000ms setTimeout fallback for Safari. We never run
 * before first paint — main.jsx calls `kickIdlePrefetches()` AFTER
 * `createRoot(...).render(...)` returns.
 *
 * Order matters loosely: bigger / more-likely-needed chunks first so
 * the warmer is filled before the user clicks. The order below is
 * tuned for the default-workspace boot path (no project loaded yet).
 *
 * @module lib/idlePrefetch
 */

import { logger } from './logger.js';

/** @type {Array<() => Promise<unknown>>} */
const PREFETCH_QUEUE = [
  // Highest probability of being the user's first click on a fresh
  // boot: the wizard (PSD drop) or the load gallery.
  () => import('@/v3/shell/PsdImportWizard.jsx'),
  () => import('@/v3/shell/LoadModal.jsx'),
  () => import('@/v3/shell/SaveModal.jsx'),
  // Properties + Parameters editors render in the default workspace's
  // right pane on most layouts; warming them avoids the click-to-open
  // pause when the user inspects a part.
  () => import('@/v3/editors/properties/PropertiesEditor.jsx'),
  () => import('@/v3/editors/parameters/ParametersEditor.jsx'),
  // Outliner is also in the default workspace; warm it for the click.
  () => import('@/v3/editors/outliner/OutlinerEditor.jsx'),
  // Modal trio — high open-rate after first paint.
  () => import('@/v3/shell/PreferencesModal.jsx'),
  () => import('@/v3/shell/NewProjectDialog.jsx'),
  () => import('@/v3/shell/CommandPalette.jsx'),
  // Export pipeline — only opened after the user has a rig, but it's
  // the heaviest single modal; warming hides the spike when they hit
  // Ctrl+E.
  () => import('@/v3/shell/ExportModal.jsx'),
];

let _kicked = false;

/**
 * Schedule the prefetch queue. Idempotent — subsequent calls are
 * no-ops. Call once from `main.jsx` after the React tree mounts.
 */
export function kickIdlePrefetches() {
  if (_kicked) return;
  _kicked = true;
  const run = () => {
    // Start all imports in parallel, then gather completion via
    // `allSettled` so a single failed chunk doesn't sink the marker.
    // Chunk-fetch rejections still surface at the real Suspense
    // boundary with proper error UX — `allSettled` only collapses
    // them for the idle-bracketing log.
    const pending = PREFETCH_QUEUE.map((loader) => {
      try {
        return loader();
      } catch (err) {
        return Promise.reject(err);
      }
    });
    Promise.allSettled(pending).then((results) => {
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.length - fulfilled;
      logger.info('boot', 'idleDone', {
        msSinceTimeOrigin: Math.round(performance.now()),
        count: results.length,
        fulfilled,
        rejected,
      });
    });
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 1000);
  }
}
