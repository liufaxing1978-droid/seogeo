import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

const createdProjectIds: string[] = [];

async function createProject(label: string) {
  const project = await prisma.project.create({
    data: {
      name: `P11-02B ${label}`,
      slug: `p11-02b-${label}-${crypto.randomUUID()}`,
      primaryDomain: 'example.com',
    },
  });
  createdProjectIds.push(project.id);
  return project;
}

afterEach(async () => {
  for (const projectId of createdProjectIds.splice(0)) {
    await prisma.keywordDiscoveryCandidate.deleteMany({ where: { projectId } });
    await prisma.searchProviderLaneBinding.deleteMany({ where: { projectId } });
    await prisma.keywordAuditEvent.deleteMany({ where: { projectId } });
    await prisma.keyword.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } });
  }
});

describe('P11-02B persistence and authority contracts', () => {
  it('persists one non-secret provider lane identity and rejects a duplicate identity', async () => {
    const project = await createProject('lane-binding');

    const created = await prisma.searchProviderLaneBinding.create({
      data: {
        projectId: project.id,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        propertyRef: 'sc-domain:xingshantang.org',
        marketCode: 'HK',
        locale: 'zh-Hant',
      },
    });

    expect(created).toMatchObject({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      propertyRef: 'sc-domain:xingshantang.org',
      marketCode: 'HK',
      locale: 'zh-Hant',
      isActive: true,
    });
    expect(Object.keys(created)).not.toEqual(expect.arrayContaining([
      'credentialRef',
      'accessToken',
      'refreshToken',
      'apiKey',
    ]));

    await expect(prisma.searchProviderLaneBinding.create({
      data: {
        projectId: project.id,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        propertyRef: 'sc-domain:xingshantang.org',
        marketCode: 'HK',
        locale: 'zh-Hant',
      },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('persists discovery review state without duplicating provider metrics', async () => {
    const project = await createProject('discovery-candidate');

    const candidate = await prisma.keywordDiscoveryCandidate.create({
      data: {
        projectId: project.id,
        normalizedQuery: '六壬符纸怎么用',
        representativeText: '六壬符纸怎么用',
        firstObservedAt: new Date('2026-08-01T00:00:00.000Z'),
        lastObservedAt: new Date('2026-08-29T00:00:00.000Z'),
      },
    });

    expect(candidate).toMatchObject({
      projectId: project.id,
      normalizedQuery: '六壬符纸怎么用',
      representativeText: '六壬符纸怎么用',
      status: 'PENDING',
      acceptedKeywordId: null,
      decidedAt: null,
      decidedByUserId: null,
    });
    expect(Object.keys(candidate)).not.toEqual(expect.arrayContaining([
      'clicks',
      'impressions',
      'ctr',
      'position',
      'averagePosition',
      'searchVolume',
      'currentRank',
    ]));
  });

  it('stores truthful discovery provenance on an accepted authoritative keyword', async () => {
    const project = await createProject('keyword-source');

    const keyword = await prisma.keyword.create({
      data: {
        projectId: project.id,
        text: '六壬符纸怎么用',
        normalizedText: '六壬符纸怎么用',
        type: 'LONG_TAIL',
        intent: 'UNKNOWN',
        priority: 'MEDIUM',
        status: 'ACTIVE',
        source: 'SEARCH_DISCOVERY_ACCEPTED',
      },
    });

    expect(keyword.source).toBe('SEARCH_DISCOVERY_ACCEPTED');
  });
});
