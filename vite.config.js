import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
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

export default defineConfig({
  plugins: [react(), dropOrtWasm],
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
