import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { SearchConsoleRepository } from '../../src/modules/search-console/search-console.repository.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p7a-search-console-${suffix}`,
      primaryDomain: `p7a-search-console-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createConnectionFixture(repository: SearchConsoleRepository, projectId: string) {
  const credential = await repository.createCredentialRecord({
    projectId,
    provider: 'GOOGLE_SEARCH_CONSOLE',
    ciphertext: Buffer.from('ciphertext'),
    iv: Buffer.alloc(12, 1),
    authTag: Buffer.alloc(16, 2),
    keyVersion: 'v1'
  });
  const connection = await repository.createConnection({
    projectId,
    credentialRef: credential.id,
    googleAccountRef: 'google-account-fixture',
    status: 'CONNECTED'
  });
  const property = await repository.createProperty({
    projectId,
    connectionId: connection.id,
    propertyUri: 'sc-domain:example.com',
    propertyType: 'DOMAIN',
    permissionState: 'SITE_OWNER',
    isActive: true
  });
  return { credential, connection, property };
}

describe('P7-A Search Console persistence foundation', () => {
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

  it('selects the highest COMPLETED syncVersion and never selects FAILED versions', async () => {
    const repository = new SearchConsoleRepository();
    const project = await createProject('P7-A source version selection');
    const { property } = await createConnectionFixture(repository, project.id);
    const date = new Date('2026-08-01T00:00:00.000Z');

    const v1 = await repository.createDailySnapshot({
      projectId: project.id,
      propertyId: property.id,
      date,
      syncVersion: 1,
      status: 'RUNNING'
    });
    await repository.completeDailySnapshot(v1.id, {
      rowCount: 1,
      sourceCompletenessState: 'TOP_ROWS_ONLY',
      sourceFreshness: new Date('2026-08-04T00:00:00.000Z')
    });

    const v2 = await repository.createDailySnapshot({
      projectId: project.id,
      propertyId: property.id,
      date,
      syncVersion: 2,
      status: 'RUNNING'
    });
    await repository.completeDailySnapshot(v2.id, {
      rowCount: 2,
      sourceCompletenessState: 'TOP_ROWS_ONLY',
      sourceFreshness: new Date('2026-08-05T00:00:00.000Z')
    });

    const v3 = await repository.createDailySnapshot({
      projectId: project.id,
      propertyId: property.id,
      date,
      syncVersion: 3,
      status: 'RUNNING'
    });
    await repository.failDailySnapshot(v3.id, 'INVALID_RESPONSE');

    const selected = await repository.findAuthoritativeDailySnapshot(project.id, property.id, date);
    expect(selected).toMatchObject({ id: v2.id, syncVersion: 2, status: 'COMPLETED' });
  });

  it('rejects snapshot-state mutation and fact writes after COMPLETED', async () => {
    const repository = new SearchConsoleRepository();
    const project = await createProject('P7-A immutable completed day');
    const { property } = await createConnectionFixture(repository, project.id);
    const date = new Date('2026-08-02T00:00:00.000Z');

    const snapshot = await repository.createDailySnapshot({
      projectId: project.id,
      propertyId: property.id,
      date,
      syncVersion: 1,
      status: 'RUNNING'
    });
    await repository.replaceDailyFacts(snapshot.id, [
      {
        projectId: project.id,
        date,
        factKey: 'fact-1',
        query: '六壬',
        normalizedQuery: '六壬',
        normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
        page: 'https://example.com/liuren',
        canonicalPage: 'https://example.com/liuren',
        clicks: 4,
        impressions: 100,
        ctr: 0.04,
        position: 8.2
      }
    ]);
    await repository.completeDailySnapshot(snapshot.id, {
      rowCount: 1,
      sourceCompletenessState: 'TOP_ROWS_ONLY',
      sourceFreshness: new Date('2026-08-05T00:00:00.000Z')
    });

    await expect(repository.failDailySnapshot(snapshot.id, 'SHOULD_NOT_MUTATE')).rejects.toThrow(/immutable/i);
    await expect(repository.replaceDailyFacts(snapshot.id, [])).rejects.toThrow(/immutable/i);

    const facts = await prisma.gscQueryPageFact.findMany({ where: { snapshotId: snapshot.id } });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ query: '六壬', impressions: 100, clicks: 4 });
  });

  it('enforces daily version identity and fact identity uniqueness', async () => {
    const repository = new SearchConsoleRepository();
    const project = await createProject('P7-A daily uniqueness');
    const { property } = await createConnectionFixture(repository, project.id);
    const date = new Date('2026-08-03T00:00:00.000Z');

    await prisma.gscDailySnapshot.create({
      data: {
        projectId: project.id,
        propertyId: property.id,
        date,
        syncVersion: 1,
        status: 'RUNNING'
      }
    });
    await expect(
      prisma.gscDailySnapshot.create({
        data: {
          projectId: project.id,
          propertyId: property.id,
          date,
          syncVersion: 1,
          status: 'RUNNING'
        }
      })
    ).rejects.toBeTruthy();

    const snapshot = await prisma.gscDailySnapshot.findFirstOrThrow({
      where: { projectId: project.id, propertyId: property.id, date, syncVersion: 1 }
    });
    const fact = {
      snapshotId: snapshot.id,
      projectId: project.id,
      date,
      factKey: 'stable-fact-key',
      query: 'seo',
      normalizedQuery: 'seo',
      normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
      page: 'https://example.com/seo',
      canonicalPage: 'https://example.com/seo',
      clicks: 1,
      impressions: 10,
      ctr: 0.1,
      position: 4.5
    };
    await prisma.gscQueryPageFact.create({ data: fact });
    await expect(prisma.gscQueryPageFact.create({ data: fact })).rejects.toBeTruthy();
  });
});
