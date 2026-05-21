import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 70,
      },
      exclude: ['node_modules', '.next', 'tests', '**/*.config.*', 'src/app/layout.tsx'],
    },
    exclude: ['node_modules', '.next', 'tests/e2e/**', 'tests/integration/**', 'tests/load/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
