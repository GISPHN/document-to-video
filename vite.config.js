import { defineConfig } from 'vite';

export default defineConfig({
  base: '/document-to-video/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
