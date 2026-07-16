import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
