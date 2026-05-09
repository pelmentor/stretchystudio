import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { ThemeProvider } from './contexts/ThemeProvider.jsx'
import { kickIdlePrefetches } from './lib/idlePrefetch.js'

// Fonts are loaded lazily inside ThemeProvider when the user's active
// `fontFamily` changes. Eager bare imports of all 7 families pulled
// every WOFF2 into the boot bundle even though only one is rendered.

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
)

// Phase A2 (2026-05-09) — once React has flushed first paint, queue
// likely-needed lazy chunks via requestIdleCallback so the user's
// first gesture doesn't pay the network round-trip. See
// `lib/idlePrefetch.js` for the queue.
kickIdlePrefetches();
