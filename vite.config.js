import { defineConfig } from 'vite';

export default defineConfig({
  base: '/document-to-video/',
  optimizeDeps: {
    // piper-plus resolves its WASM assets relative to the package at runtime.
    // Pre-bundling can break that path, so follow the package author's Vite guidance.
    exclude: ['piper-plus'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
