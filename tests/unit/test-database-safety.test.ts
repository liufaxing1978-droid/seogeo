import { describe, expect, it } from 'vitest';
import { assertIsolatedTestDatabase } from '../helpers/test-database.js';

describe('test database safety', () => {
  it('accepts an explicitly named isolated test database in test mode', () => {
    expect(() =>
      assertIsolatedTestDatabase({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/seogeo_test_run_123?schema=public',
      }),
    ).not.toThrow();
  });

  it('rejects destructive cleanup outside test mode', () => {
    expect(() =>
      assertIsolatedTestDatabase({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/seogeo_test_run_123?schema=public',
      }),
    ).toThrow(/NODE_ENV=test/);
  });

  it.each([
    'postgresql://postgres:postgres@127.0.0.1:5432/seogeo',
    'postgresql://postgres:postgres@127.0.0.1:5432/production',
    'postgresql://postgres:postgres@127.0.0.1:5432/seogeo_testing',
  ])('rejects a database without a dedicated test or e2e name: %s', (databaseUrl) => {
    expect(() =>
      assertIsolatedTestDatabase({
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow(/dedicated test database/);
  });

  it('rejects a missing or malformed database URL', () => {
    expect(() => assertIsolatedTestDatabase({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
    expect(() =>
      assertIsolatedTestDatabase({ NODE_ENV: 'test', DATABASE_URL: 'not-a-url' }),
    ).toThrow(/DATABASE_URL/);
  });
});
