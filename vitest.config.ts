import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      globals: false,
      // Force file-per-fork isolation. The default `threads` pool on
      // vitest 4.1.x (Node 24 / Windows) leaks state between test files
      // and crashes every file after the first with
      // `Cannot read properties of undefined (reading 'config')`.
      // Single-file runs work; multi-file runs need forks.
      pool: 'forks',
      // `include` is broad so the `test:wasm` script's positional filter
      // (`vitest run tests/wasm-binding`) actually matches files. The
      // `test:unit` script excludes the wasm-binding directory so it can
      // run on a fresh checkout without first populating
      // `tests/wasm-binding/pkg/`. See `package.json` scripts.
      include: ['tests/**/*.{test,spec}.ts'],
    },
  }),
);
