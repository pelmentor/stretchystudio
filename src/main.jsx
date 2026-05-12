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

// Boot timing — `moduleEval` measures from this script's first executable
// line (after import resolution) to `createRoot.render` returning. The
// `firstFrame` rAF marker fires after the browser paints React's first
// commit, which is the user-perceived "app is up" moment. Together they
// bound the boot window.
logger.time('boot', 'moduleEval');

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
)

logger.timeEnd('boot', 'moduleEval');

requestAnimationFrame(() => {
  logger.info('boot', 'first frame painted', { msSinceTimeOrigin: Math.round(performance.now()) });
});

// Phase A2 (2026-05-09) — once React has flushed first paint, queue
// likely-needed lazy chunks via requestIdleCallback so the user's
// first gesture doesn't pay the network round-trip. See
// `lib/idlePrefetch.js` for the queue.
kickIdlePrefetches();
