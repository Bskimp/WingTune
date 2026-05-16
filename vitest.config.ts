import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      globals: false,
      // `include` is broad so the `test:wasm` script's positional filter
      // (`vitest run tests/wasm-binding`) actually matches files. The
      // `test:unit` script excludes the wasm-binding directory so it can
      // run on a fresh checkout without first populating
      // `tests/wasm-binding/pkg/`. See `package.json` scripts.
      include: ['tests/**/*.{test,spec}.ts'],
    },
  }),
);
