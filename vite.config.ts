import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import wasm from 'vite-plugin-wasm';
import tailwindcss from '@tailwindcss/vite';

// Note on top-level await:
// wasm-pack's `--target web` output uses TLA in its module init. Vite 8's
// default `build.target` is modern enough to emit TLA-supporting JS, and
// the dev server serves modules as-is. The `vite-plugin-top-level-await`
// transform isn't compatible with Vite 8's stripped node_modules surface
// (missing rollup/esbuild as runtime deps), so we rely on the native path.
// If we ever target older browsers, re-evaluate.
export default defineConfig({
  plugins: [vue(), wasm(), tailwindcss()],
  worker: {
    format: 'es',
  },
});
