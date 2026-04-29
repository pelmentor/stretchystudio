import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Phase 4G — manual chunking. The default monolithic bundle was
// ~1.3 MB / 395 KB gzip; splitting it into roughly stable vendor
// groups lets the browser cache react / radix / lucide separately
// from app code and parallelise downloads. The buckets are coarse on
// purpose — finer slicing trades a marginal cache benefit for HTTP
// request fan-out.
function chunkFor(id) {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('/@fontsource/'))                   return 'vendor-fontsource';
  if (id.includes('/onnxruntime-web/'))               return 'vendor-onnxruntime';
  if (id.includes('/@radix-ui/'))                     return 'vendor-radix';
  if (id.includes('/lucide-react/'))                  return 'vendor-lucide';
  if (id.includes('/cmdk/'))                          return 'vendor-cmdk';
  if (id.includes('/zustand/') || id.includes('/immer/')) return 'vendor-state';
  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/'))
    return 'vendor-react';
  return 'vendor';
}

export default defineConfig({
  plugins: [react()],
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
