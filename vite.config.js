import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// Phase 4G — manual chunking for the eagerly-reachable graph only.
//
// After the Phase A loading-perf sweep (2026-05-09) the following
// modules are reachable ONLY via dynamic `import()` and therefore
// MUST NOT be claimed here. Returning `'vendor'` for a dynamic-only
// module pulls it into the static graph (because other static modules
// land in `vendor`), which silently re-eagerises the dependency.
// Returning `undefined` lets Rollup put each module in the chunk that
// matches its dynamic-import boundary:
//
//   - `@fontsource/*`   — lazy-loaded per active font in ThemeProvider
//   - `onnxruntime-web` — lazy-loaded by dwposeService when the PSD
//                         wizard runs DWPose
//   - `ag-psd`          — lazy-loaded by `processPsdFile`
//   - `jszip`, `pako`   — lazy-loaded by save/load/export handlers
//   - `cmdk`            — lazy-loaded with CommandPalette modal
//
// The remaining buckets group always-eager vendor code so the browser
// caches react/radix/lucide separately from app code and parallelises
// downloads. The buckets are coarse on purpose — finer slicing trades
// a marginal cache benefit for HTTP request fan-out.
const LAZY_ONLY_PACKAGES = [
  '/@fontsource/',
  '/onnxruntime-web/',
  '/ag-psd/',
  '/jszip/',
  '/pako/',
  '/cmdk/',
];

function chunkFor(id) {
  if (!id.includes('node_modules')) return undefined;
  for (const pkg of LAZY_ONLY_PACKAGES) {
    if (id.includes(pkg)) return undefined;
  }
  if (id.includes('/@radix-ui/'))                     return 'vendor-radix';
  if (id.includes('/lucide-react/'))                  return 'vendor-lucide';
  if (id.includes('/zustand/') || id.includes('/immer/')) return 'vendor-state';
  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/'))
    return 'vendor-react';
  return 'vendor';
}

// Phase A2 (2026-05-09) — onnxruntime-web ships several `ort-wasm*.wasm`
// binaries that Vite emits into `dist/assets/` (~25 MB total). At
// runtime the app calls `instance.env.wasm.wasmPaths = <CDN URL>` in
// `armatureOrganizer._ensureOrt`, so the runtime fetches WASM from the
// CDN — the local copies are never used. They still bloat deploy
// artifacts. Drop them at the bundle stage.
const dropOrtWasm = {
  name: 'drop-ort-wasm-emit',
  generateBundle(_options, bundle) {
    for (const fileName of Object.keys(bundle)) {
      if (/ort-wasm.*\.(wasm|mjs|js)$/.test(fileName)) {
        delete bundle[fileName];
      }
    }
  },
};

// Phase A2 PWA (2026-05-09). vite-plugin-pwa generates a Workbox-driven
// service worker that precaches the eager boot bundle on first load and
// serves it from cache on subsequent visits — paint becomes near-instant
// regardless of network. Lazy chunks (editors, modals, ag-psd, jszip,
// onnxruntime-web CDN) are runtime-cached per their fetch shape.
//
// `registerType: 'prompt'` — the SW activates only after the user
// accepts an "Update available" toast (wired in `src/lib/swRegister.jsx`).
// Auto-update would otherwise risk swapping assets mid-session and
// breaking long-running sessions like a wizard flow.
//
// The precache list is bounded by `globPatterns` so the heavy
// `ort.bundle.min` (~110 kB gzip) and `initRig` (~66 kB gzip) chunks
// stay out of the precache; they runtime-cache lazily once the user
// triggers DWPose / Init Rig respectively.
const pwa = VitePWA({
  registerType: 'prompt',
  injectRegister: false, // we register manually in src/lib/swRegister.jsx
  manifest: false, // existing public/manifest.webmanifest is canonical
  workbox: {
    // Precache only the eager boot graph: index, vendor chunks, CSS,
    // and the inline shell index.html. Lazy chunks runtime-cache below.
    globPatterns: [
      'index.html',
      'assets/index-*.js',
      'assets/index-*.css',
      'assets/vendor-*.js',
    ],
    // Don't fall back to index.html for asset URLs — Vite's hashed
    // chunks must resolve precisely or fail loudly.
    navigateFallbackDenylist: [/^\/assets\//],
    runtimeCaching: [
      {
        // Lazy app chunks (editors, modals, services). Cache-first with
        // a long TTL since the hashes are immutable.
        urlPattern: /\/assets\/.*\.(js|css)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'app-chunks',
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
      {
        // Fontsource latin WOFF2s + system woffs.
        urlPattern: /\.(?:woff2?|ttf|otf|eot)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'fonts',
          expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
      {
        // CDN-loaded onnxruntime-web wasm (per `wasmPaths` in
        // armatureOrganizer._ensureOrt). Cache-first; the version is
        // pinned in source so the URL is stable.
        urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'onnxruntime-cdn',
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
    cleanupOutdatedCaches: true,
  },
});

export default defineConfig({
  plugins: [react(), dropOrtWasm, pwa],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: chunkFor,
      },
    },
  },
})
