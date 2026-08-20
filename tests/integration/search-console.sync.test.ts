import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  GoogleSearchConsoleTransportError,
  type GoogleSearchConsoleTransport,
  type GoogleTokenPayload,
  type SearchAnalyticsResponse
} from '../../src/modules/search-console/google-search-console.client.js';
import { SearchConsoleRepository } from '../../src/modules/search-console/search-console.repository.js';
import { SearchConsoleObservability } from '../../src/modules/search-console/search-console.observability.js';
import {
  syncSearchConsoleDay,
  type SearchConsoleSyncDependencies
} from '../../src/modules/search-console/search-console.worker.js';

const projectIds: string[] = [];

class FixtureTransport implements GoogleSearchConsoleTransport {
  queryCalls = 0;
  response: SearchAnalyticsResponse = {
    rows: [
      {
        keys: ['Search Console Query', 'https://EXAMPLE.com:443/page#fragment'],
        clicks: 5,
        impressions: 50,
        ctr: 0.1,
        position: 6.5
      }
    ]
  };
  error: Error | null = null;

  async exchangeCode(): Promise<GoogleTokenPayload> { throw new Error('not used'); }
  async refreshToken(): Promise<GoogleTokenPayload> { throw new Error('not used'); }
  async listSites() { return []; }
  async querySearchAnalytics() {
    this.queryCalls += 1;
    if (this.error) throw this.error;
    return this.response;
  }
}

async function createSyncFixture(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `P7-A Sync ${label}`,
      slug: `p7a-sync-${suffix}`,
      primaryDomain: `p7a-sync-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const repository = new SearchConsoleRepository();
  const credential = await repository.createCredentialRecord({
    projectId: project.id,
    provider: 'GOOGLE_SEARCH_CONSOLE',
    ciphertext: Buffer.from('fixture-ciphertext'),
    iv: Buffer.alloc(12, 1),
    authTag: Buffer.alloc(16, 2),
    keyVersion: 'v1'
  });
  const connection = await repository.createConnection({
    projectId: project.id,
    credentialRef: credential.id,
    status: 'CONNECTED'
  });
  const property = await repository.createProperty({
    projectId: project.id,
    connectionId: connection.id,
    propertyUri: 'sc-domain:example.com',
    propertyType: 'DOMAIN',
    permissionState: 'siteOwner',
    isActive: true
  });
  const transport = new FixtureTransport();
  const dependencies: SearchConsoleSyncDependencies = {
    repository,
    transport,
    accessTokenProvider: { getAccessToken: async () => 'integration-access-token' },
    observability: new SearchConsoleObservability(() => undefined),
    now: () => new Date('2026-08-20T00:00:00.000Z')
  };
  return { project, repository, property, transport, dependencies };
}

describe('P7-A Search Console daily sync persistence', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.gscQueryPageFact.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.gscDailySnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.searchConsoleProperty.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.searchConsoleConnection.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.oAuthStateNonce.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.oAuthCredentialRecord.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('persists one immutable COMPLETED daily version with TOP_ROWS_ONLY facts and is idempotent', async () => {
    const { project, repository, property, transport, dependencies } = await createSyncFixture('completed');
    const input = { projectId: project.id, propertyId: property.id, date: '2026-08-10' };

    const first = await syncSearchConsoleDay(input, dependencies);
    const second = await syncSearchConsoleDay(input, dependencies);

    expect(first).toMatchObject({ state: 'COMPLETED', syncVersion: 1, rowCount: 1 });
    expect(second).toMatchObject({ state: 'ALREADY_COMPLETED', syncVersion: 1 });
    expect(transport.queryCalls).toBe(1);

    const snapshots = await prisma.gscDailySnapshot.findMany({
      where: { projectId: project.id, propertyId: property.id, date: new Date('2026-08-10T00:00:00.000Z') },
      orderBy: { syncVersion: 'asc' }
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      status: 'COMPLETED',
      syncVersion: 1,
      rowCount: 1,
      sourceCompletenessState: 'TOP_ROWS_ONLY',
      errorCode: null
    });

    const authoritative = await repository.findAuthoritativeDailySnapshot(
      project.id,
      property.id,
      new Date('2026-08-10T00:00:00.000Z')
    );
    expect(authoritative?.id).toBe(snapshots[0].id);

    const facts = await prisma.gscQueryPageFact.findMany({ where: { snapshotId: snapshots[0].id } });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      query: 'Search Console Query',
      normalizedQuery: 'search console query',
      normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
      page: 'https://EXAMPLE.com:443/page#fragment',
      canonicalPage: 'https://example.com/page',
      clicks: 5,
      impressions: 50,
      ctr: 0.1,
      position: 6.5
    });

    const refreshedProperty = await prisma.searchConsoleProperty.findUniqueOrThrow({ where: { id: property.id } });
    expect(refreshedProperty.lastSyncAt?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
  });

  it('keeps a FAILED source version non-authoritative and retries with the next syncVersion', async () => {
    const { project, repository, property, transport, dependencies } = await createSyncFixture('retry');
    const date = new Date('2026-08-11T00:00:00.000Z');
    const input = { projectId: project.id, propertyId: property.id, date: '2026-08-11' };
    transport.error = new GoogleSearchConsoleTransportError('temporary provider failure', 'FIXTURE', 503);

    await expect(syncSearchConsoleDay(input, dependencies)).rejects.toMatchObject({
      reason: 'TRANSIENT_PROVIDER_ERROR'
    });
    expect(await repository.findAuthoritativeDailySnapshot(project.id, property.id, date)).toBeNull();

    transport.error = null;
    const retried = await syncSearchConsoleDay(input, dependencies);
    expect(retried).toMatchObject({ state: 'COMPLETED', syncVersion: 2 });

    const snapshots = await prisma.gscDailySnapshot.findMany({
      where: { projectId: project.id, propertyId: property.id, date },
      orderBy: { syncVersion: 'asc' }
    });
    expect(snapshots.map((row) => ({ syncVersion: row.syncVersion, status: row.status, errorCode: row.errorCode }))).toEqual([
      { syncVersion: 1, status: 'FAILED', errorCode: 'TRANSIENT_PROVIDER_ERROR' },
      { syncVersion: 2, status: 'COMPLETED', errorCode: null }
    ]);
    const authoritative = await repository.findAuthoritativeDailySnapshot(project.id, property.id, date);
    expect(authoritative).toMatchObject({ id: snapshots[1].id, syncVersion: 2, status: 'COMPLETED' });
  });
});
