import type { PrismaClient } from '@prisma/client';

type TestDatabaseEnv = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  TEST_DATABASE_RUN_ID?: string;
  TEST_DATABASE_DESTRUCTIVE_CLEANUP?: string;
};
type DestructiveTestClient = Pick<PrismaClient, '$executeRawUnsafe'>;

const TEST_RUN_ID = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$/;

export function assertIsolatedTestDatabase(input: TestDatabaseEnv): void {
  if (input.NODE_ENV !== 'test') {
    throw new Error('Destructive test cleanup requires NODE_ENV=test');
  }

  if (input.TEST_DATABASE_DESTRUCTIVE_CLEANUP !== 'enabled') {
    throw new Error('Destructive test cleanup requires explicit cleanup authorization');
  }

  const runId = input.TEST_DATABASE_RUN_ID;
  if (!runId || !TEST_RUN_ID.test(runId)) {
    throw new Error('Destructive test cleanup requires a safe TEST_DATABASE_RUN_ID');
  }

  if (!input.DATABASE_URL) {
    throw new Error('Destructive test cleanup requires DATABASE_URL');
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(input.DATABASE_URL);
  } catch {
    throw new Error('Destructive test cleanup requires a valid DATABASE_URL');
  }

  if (databaseUrl.protocol !== 'postgresql:' && databaseUrl.protocol !== 'postgres:') {
    throw new Error('Destructive test cleanup requires a PostgreSQL DATABASE_URL');
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('Destructive test cleanup requires a valid DATABASE_URL');
  }

  if (databaseName !== `seogeo_test_run_${runId}`) {
    throw new Error('Destructive test cleanup requires the exact test run database');
  }
}

export async function truncateProjectTestFixtures(
  prismaClient: DestructiveTestClient,
  input: TestDatabaseEnv = process.env,
): Promise<void> {
  assertIsolatedTestDatabase(input);
  await prismaClient.$executeRawUnsafe('TRUNCATE TABLE "Project" CASCADE');
}
