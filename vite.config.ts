import { defineConfig } from 'vite'

// The add-on's bundle: dist/ is what Ava serves from the add-on's own origin.
// Nothing is inlined as data: (the add-on's CSP allows fonts from 'self'
// only), and fonts come from @fontsource, in the build, never from a CDN.
// Tailwind (for Tailwind boards) is its own chunk, loaded only when a board
// uses it.
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'safari17',
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
  },
})
