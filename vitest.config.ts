import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testNamePattern: 'preserves V1 snapshots and skips restricted P6 reads entirely for Standard'
  }
});
