import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { ThemeProvider } from './contexts/ThemeProvider.jsx'
import { kickIdlePrefetches } from './lib/idlePrefetch.js'
import { logger } from './lib/logger.js'

// Fonts are loaded lazily inside ThemeProvider when the user's active
// `fontFamily` changes. Eager bare imports of all 7 families pulled
// every WOFF2 into the boot bundle even though only one is rendered.

// Boot timing — emitted as milestones (`msSinceTimeOrigin`) rather
// than time/timeEnd intervals, because each marks a single point on
// the page-navigation-relative timeline, not a duration we can bound
// from inside the module. The full boot window is bracketed by:
//
//   reactRender   — `createRoot().render(...)` returned (React reconciler kicked)
//   firstPaint    — first rAF after React's initial commit (user-perceived "UI is up")
//   idleDone      — `kickIdlePrefetches()` queue drained (page is settled, no more JS scheduled)
//
// Note: "moduleEval" was previously emitted here via `logger.time/timeEnd`
// wrapping the synchronous `render()` call — that's not module evaluation,
// it's the React render dispatch (~2ms). Actual module evaluation finishes
// before line 1 of this file runs (ESM imports are hoisted + awaited by
// the runtime), so it can't be measured from inside the module. The
// honest substitute is `reactRender` as a wall-time milestone.

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
)

logger.info('boot', 'reactRender', { msSinceTimeOrigin: Math.round(performance.now()) });

requestAnimationFrame(() => {
  logger.info('boot', 'firstPaint', { msSinceTimeOrigin: Math.round(performance.now()) });
});

// Phase A2 (2026-05-09) — once React has flushed first paint, queue
// likely-needed lazy chunks via requestIdleCallback so the user's
// first gesture doesn't pay the network round-trip. See
// `lib/idlePrefetch.js` for the queue.
kickIdlePrefetches();
