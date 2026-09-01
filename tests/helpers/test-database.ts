import type { PrismaClient } from '@prisma/client';

type TestDatabaseEnv = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
};
type DestructiveTestClient = Pick<PrismaClient, '$executeRawUnsafe'>;

const ISOLATED_DATABASE_NAME = /(?:^|[-_])(test|e2e)(?:[-_]|$)/i;

export function assertIsolatedTestDatabase(input: TestDatabaseEnv): void {
  if (input.NODE_ENV !== 'test') {
    throw new Error('Destructive test cleanup requires NODE_ENV=test');
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

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  if (!ISOLATED_DATABASE_NAME.test(databaseName)) {
    throw new Error('Destructive test cleanup requires a dedicated test database name');
  }
}

export async function truncateProjectTestFixtures(
  prismaClient: DestructiveTestClient,
  input: TestDatabaseEnv = process.env,
): Promise<void> {
  assertIsolatedTestDatabase(input);
  await prismaClient.$executeRawUnsafe('TRUNCATE TABLE "Project" CASCADE');
}
