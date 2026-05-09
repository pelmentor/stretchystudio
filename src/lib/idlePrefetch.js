// @ts-check

/**
 * Idle prefetch — kick off lazy chunk fetches after the first paint
 * settles, so the first user gesture (click Save / open Properties /
 * drop a PSD) doesn't pay the network round-trip cost.
 *
 * Phase A2 loading sweep (2026-05-09).
 *
 * Each entry is a `() => import('./path')` thunk. We never await the
 * promises; the side effect is that Vite/Rollup warms the chunk into
 * the browser's modulepreload + HTTP cache. When the user later
 * triggers the lazy boundary, React.Suspense resolves instantly.
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
    for (const loader of PREFETCH_QUEUE) {
      try {
        // Fire-and-forget; swallow rejections (chunk fetch failures
        // surface again at the real Suspense boundary, with proper
        // error UX). Don't `await` — we want the requests to overlap.
        loader().catch(() => {});
      } catch {
        /* synchronous import throws are equally fire-and-forget */
      }
    }
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 1000);
  }
}
