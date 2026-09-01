import { describe, expect, it, vi } from 'vitest';
import {
  assertIsolatedTestDatabase,
  truncateProjectTestFixtures,
} from '../helpers/test-database.js';

const RUN_ID = 'local_123_abcd';
const DATABASE_NAME = `seogeo_test_run_${RUN_ID}`;
const authorizedEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:5432/${DATABASE_NAME}?schema=public`,
  TEST_DATABASE_RUN_ID: RUN_ID,
  TEST_DATABASE_DESTRUCTIVE_CLEANUP: 'enabled',
};

describe('test database safety', () => {
  it('accepts only the database uniquely named for the authorized test run', () => {
    expect(() => assertIsolatedTestDatabase(authorizedEnv)).not.toThrow();
  });

  it('rejects destructive cleanup outside test mode or without explicit opt-in', () => {
    expect(() =>
      assertIsolatedTestDatabase({ ...authorizedEnv, NODE_ENV: 'production' }),
    ).toThrow(/NODE_ENV=test/);
    expect(() =>
      assertIsolatedTestDatabase({
        ...authorizedEnv,
        TEST_DATABASE_DESTRUCTIVE_CLEANUP: undefined,
      }),
    ).toThrow(/explicit cleanup authorization/);
  });

  it.each([undefined, '', 'contains space', '../escape', 'a'.repeat(65)])(
    'rejects an absent or unsafe test run id: %s',
    (runId) => {
      expect(() =>
        assertIsolatedTestDatabase({ ...authorizedEnv, TEST_DATABASE_RUN_ID: runId }),
      ).toThrow(/TEST_DATABASE_RUN_ID/);
    },
  );

  it.each([
    'seogeo',
    'production_test',
    'test-production',
    'seogeo_test',
    'seogeo_test_run_other_process',
  ])('rejects every database not exactly owned by this run: %s', (databaseName) => {
    expect(() =>
      assertIsolatedTestDatabase({
        ...authorizedEnv,
        DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:5432/${databaseName}`,
      }),
    ).toThrow(/exact test run database/);
  });

  it('rejects a missing, malformed, non-PostgreSQL, or invalidly encoded URL', () => {
    expect(() =>
      assertIsolatedTestDatabase({ ...authorizedEnv, DATABASE_URL: undefined }),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      assertIsolatedTestDatabase({ ...authorizedEnv, DATABASE_URL: 'not-a-url' }),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      assertIsolatedTestDatabase({ ...authorizedEnv, DATABASE_URL: `mysql://localhost/${DATABASE_NAME}` }),
    ).toThrow(/PostgreSQL/);
    expect(() =>
      assertIsolatedTestDatabase({
        ...authorizedEnv,
        DATABASE_URL: `postgresql://localhost/seogeo_test_run_%E0%A4%A`,
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('does not execute SQL when the guard rejects the target', async () => {
    const execute = vi.fn();
    await expect(
      truncateProjectTestFixtures(
        { $executeRawUnsafe: execute } as never,
        { ...authorizedEnv, DATABASE_URL: 'postgresql://localhost/production_test' },
      ),
    ).rejects.toThrow(/exact test run database/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes exactly one fixed cleanup statement after authorization', async () => {
    const execute = vi.fn().mockResolvedValue(1);
    await truncateProjectTestFixtures(
      { $executeRawUnsafe: execute } as never,
      authorizedEnv,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('TRUNCATE TABLE "Project" CASCADE');
  });
});
