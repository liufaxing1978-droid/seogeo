import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testNamePattern: 'freezes one latest completed P6-C snapshot with safe metrics, bounded competitors, compatible deltas, evidence coverage and open alert severity counts'
  }
});
