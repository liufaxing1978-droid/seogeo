import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordDiscoveryRepository } from '../../src/modules/keywords/keyword-discovery.repository.js';
import { KeywordDiscoveryService } from '../../src/modules/keywords/keyword-discovery.service.js';
import { SearchFactRepository } from '../../src/modules/search-facts/search-fact.repository.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');

beforeEach(async () => {
  await prisma.keywordDiscoveryCandidate.deleteMany();
  await prisma.keywordAuditEvent.deleteMany();
  await prisma.keywordGroupMembership.deleteMany();
  await prisma.keywordRelation.deleteMany();
  await prisma.keywordSuggestion.deleteMany();
  await prisma.keyword.deleteMany();
  await prisma.searchFactMetric.deleteMany();
  await prisma.searchFact.deleteMany();
  await prisma.searchFactSnapshot.deleteMany();
  await prisma.aiTaskRun.deleteMany();
  await prisma.aiTask.deleteMany();
  await prisma.project.deleteMany();
});

async function createProject(label: string) {
  return prisma.project.create({
    data: {
      name: label,
      slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${Math.random()}`,
      primaryDomain: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random()}.example`,
    },
  });
}

function service() {
  return new KeywordDiscoveryService({
    repository: new KeywordDiscoveryRepository(prisma),
    now: () => NOW,
  });
}

async function createCandidate(input: {
  projectId: string;
  normalizedQuery: string;
  representativeText?: string;
  status?: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  acceptedKeywordId?: string | null;
}) {
  return prisma.keywordDiscoveryCandidate.create({
    data: {
      projectId: input.projectId,
      normalizedQuery: input.normalizedQuery,
      representativeText: input.representativeText ?? input.normalizedQuery,
      status: input.status ?? 'PENDING',
      acceptedKeywordId: input.acceptedKeywordId ?? null,
      firstObservedAt: new Date('2026-08-28T00:00:00.000Z'),
      lastObservedAt: new Date('2026-08-29T00:00:00.000Z'),
      ...(input.status && input.status !== 'PENDING'
        ? { decidedAt: new Date('2026-08-29T06:00:00.000Z') }
        : {}),
    },
  });
}

async function persistEvidence(projectId: string, query: string) {
  return new SearchFactRepository(prisma).persistCompletedSnapshot(
    {
      projectId,
      provider: 'BING_WEBMASTER',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: 'https://xingshantang.org/',
      propertyType: 'SITE',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: `decision-evidence-${query}`,
      sourceCutoffAt: new Date('2026-08-29T23:59:59.000Z'),
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [{
      factKey: `decision-${query}`,
      factKind: 'QUERY',
      sourceObservationRef: `decision:${query}`,
      sourceDate: new Date('2026-08-29T00:00:00.000Z'),
      query,
      normalizedQuery: query,
      queryNormalizationVersion: 'fixture',
      page: null,
      canonicalPage: null,
      canonicalizationVersion: null,
      metrics: [{
        metricSemantic: 'IMPRESSIONS',
        numericValue: 20,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'impressions',
      }],
    }],
    `decision-evidence-${query}`,
  );
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('KeywordDiscoveryService accept/reject decisions', () => {
  it('fails closed for a cross-project candidate without leaking its existence', async () => {
    const ownProject = await createProject('Discovery Own Project');
    const foreignProject = await createProject('Discovery Foreign Project');
    const foreign = await createCandidate({
      projectId: foreignProject.id,
      normalizedQuery: '外部候选词',
    });

    await expectCode(service().accept({
      actorUserId: '00000000-0000-0000-0000-000000000001',
      projectId: ownProject.id,
      candidateId: foreign.id,
      type: 'LONG_TAIL',
    }), 'KEYWORD_DISCOVERY_NOT_FOUND');

    await expectCode(service().reject({
      actorUserId: '00000000-0000-0000-0000-000000000001',
      projectId: ownProject.id,
      candidateId: foreign.id,
    }), 'KEYWORD_DISCOVERY_NOT_FOUND');

    expect(await prisma.keyword.count({ where: { projectId: ownProject.id } })).toBe(0);
  });

  it('accepts a pending discovery into exactly one authoritative keyword with explicit operator fields and truthful provenance', async () => {
    const project = await createProject('Discovery Accept');
    const candidate = await createCandidate({
      projectId: project.id,
      normalizedQuery: 'liuren guide',
      representativeText: '  Liuren   Guide  ',
    });
    const aiTasksBefore = await prisma.aiTask.count({ where: { projectId: project.id } });

    const keyword = await service().accept({
      actorUserId: '00000000-0000-0000-0000-000000000002',
      projectId: project.id,
      candidateId: candidate.id,
      type: 'LONG_TAIL',
      language: 'zh-Hant',
      targetCountry: 'HK',
    });

    expect(keyword).toMatchObject({
      projectId: project.id,
      text: 'Liuren   Guide',
      normalizedText: 'liuren guide',
      type: 'LONG_TAIL',
      intent: 'UNKNOWN',
      priority: 'MEDIUM',
      status: 'ACTIVE',
      source: 'SEARCH_DISCOVERY_ACCEPTED',
      language: 'zh-Hant',
      targetCountry: 'HK',
      createdByUserId: '00000000-0000-0000-0000-000000000002',
    });
    expect(await prisma.keyword.count({
      where: { projectId: project.id, normalizedText: 'liuren guide' },
    })).toBe(1);

    const decided = await prisma.keywordDiscoveryCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    expect(decided).toMatchObject({
      status: 'ACCEPTED',
      acceptedKeywordId: keyword.id,
      decidedAt: NOW,
      decidedByUserId: '00000000-0000-0000-0000-000000000002',
    });
    expect(await prisma.keywordAuditEvent.findMany({
      where: { projectId: project.id, keywordId: keyword.id },
    })).toEqual([
      expect.objectContaining({
        actorUserId: '00000000-0000-0000-0000-000000000002',
        eventType: 'KEYWORD_DISCOVERY_ACCEPTED',
        metadata: { candidateId: candidate.id, source: 'SEARCH_DISCOVERY_ACCEPTED' },
      }),
    ]);
    expect(await prisma.aiTask.count({ where: { projectId: project.id } })).toBe(aiTasksBefore);
  });

  it('reuses an existing same-project authoritative keyword and acceptance is idempotent', async () => {
    const project = await createProject('Discovery Reuse');
    const existing = await prisma.keyword.create({
      data: {
        projectId: project.id,
        text: '符纸 怎么用',
        normalizedText: '符纸 怎么用',
        type: 'QUESTION',
        intent: 'INFORMATIONAL',
        priority: 'HIGH',
        status: 'ACTIVE',
        source: 'MANUAL',
      },
    });
    const candidate = await createCandidate({
      projectId: project.id,
      normalizedQuery: '符纸 怎么用',
      representativeText: '符纸   怎么用',
    });

    const first = await service().accept({
      actorUserId: '00000000-0000-0000-0000-000000000003',
      projectId: project.id,
      candidateId: candidate.id,
      type: 'LONG_TAIL',
    });
    const second = await service().accept({
      actorUserId: '00000000-0000-0000-0000-000000000004',
      projectId: project.id,
      candidateId: candidate.id,
      type: 'COMMERCIAL',
    });

    expect(first.id).toBe(existing.id);
    expect(second.id).toBe(existing.id);
    expect(await prisma.keyword.count({ where: { projectId: project.id } })).toBe(1);
    expect(await prisma.keywordAuditEvent.count({
      where: {
        projectId: project.id,
        keywordId: existing.id,
        eventType: 'KEYWORD_DISCOVERY_ACCEPTED',
      },
    })).toBe(1);
  });

  it('requires the archived keyword restore contract instead of silently recreating an archived duplicate', async () => {
    const project = await createProject('Discovery Archived');
    await prisma.keyword.create({
      data: {
        projectId: project.id,
        text: '六壬符纸',
        normalizedText: '六壬符纸',
        type: 'LONG_TAIL',
        priority: 'MEDIUM',
        status: 'ARCHIVED',
        source: 'MANUAL',
      },
    });
    const candidate = await createCandidate({
      projectId: project.id,
      normalizedQuery: '六壬符纸',
    });

    await expectCode(service().accept({
      actorUserId: '00000000-0000-0000-0000-000000000005',
      projectId: project.id,
      candidateId: candidate.id,
      type: 'LONG_TAIL',
    }), 'KEYWORD_ARCHIVED_RESTORE_REQUIRED');

    expect(await prisma.keyword.count({ where: { projectId: project.id } })).toBe(1);
    expect(await prisma.keywordDiscoveryCandidate.findUniqueOrThrow({ where: { id: candidate.id } }))
      .toMatchObject({ status: 'PENDING', acceptedKeywordId: null, decidedAt: null });
  });

  it('converges concurrent duplicate accepts to one authoritative keyword', async () => {
    const project = await createProject('Discovery Race');
    const firstCandidate = await createCandidate({
      projectId: project.id,
      normalizedQuery: 'race-one',
      representativeText: 'Liuren Guide',
    });
    const secondCandidate = await createCandidate({
      projectId: project.id,
      normalizedQuery: 'race-two',
      representativeText: 'LIUREN   GUIDE',
    });

    const [first, second] = await Promise.all([
      service().accept({
        actorUserId: '00000000-0000-0000-0000-000000000006',
        projectId: project.id,
        candidateId: firstCandidate.id,
        type: 'LONG_TAIL',
      }),
      service().accept({
        actorUserId: '00000000-0000-0000-0000-000000000007',
        projectId: project.id,
        candidateId: secondCandidate.id,
        type: 'LONG_TAIL',
      }),
    ]);

    expect(first.id).toBe(second.id);
    expect(await prisma.keyword.count({
      where: { projectId: project.id, normalizedText: 'liuren guide' },
    })).toBe(1);
    expect(await prisma.keywordDiscoveryCandidate.count({
      where: { projectId: project.id, status: 'ACCEPTED', acceptedKeywordId: first.id },
    })).toBe(2);
  });

  it('reject is idempotent and mutates only candidate review state, never SearchFact evidence', async () => {
    const project = await createProject('Discovery Reject');
    const candidate = await createCandidate({
      projectId: project.id,
      normalizedQuery: '不要追踪的词',
    });
    await persistEvidence(project.id, '不要追踪的词');
    const factsBefore = await prisma.searchFact.findMany({
      where: { projectId: project.id },
      include: { metrics: true },
      orderBy: { factKey: 'asc' },
    });
    const aiTasksBefore = await prisma.aiTask.count({ where: { projectId: project.id } });

    const first = await service().reject({
      actorUserId: '00000000-0000-0000-0000-000000000008',
      projectId: project.id,
      candidateId: candidate.id,
    });
    const second = await service().reject({
      actorUserId: '00000000-0000-0000-0000-000000000009',
      projectId: project.id,
      candidateId: candidate.id,
    });

    expect(first).toMatchObject({
      id: candidate.id,
      status: 'REJECTED',
      acceptedKeywordId: null,
      decidedAt: NOW,
      decidedByUserId: '00000000-0000-0000-0000-000000000008',
    });
    expect(second).toMatchObject({
      id: candidate.id,
      status: 'REJECTED',
      decidedAt: NOW,
      decidedByUserId: '00000000-0000-0000-0000-000000000008',
    });
    expect(await prisma.searchFact.findMany({
      where: { projectId: project.id },
      include: { metrics: true },
      orderBy: { factKey: 'asc' },
    })).toEqual(factsBefore);
    expect(await prisma.keyword.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.aiTask.count({ where: { projectId: project.id } })).toBe(aiTasksBefore);
  });

  it('does not allow accepted and rejected decisions to be reversed', async () => {
    const project = await createProject('Discovery Decision Lock');
    const acceptedKeyword = await prisma.keyword.create({
      data: {
        projectId: project.id,
        text: '已接受词',
        normalizedText: '已接受词',
        type: 'LONG_TAIL',
        priority: 'MEDIUM',
        status: 'ACTIVE',
        source: 'SEARCH_DISCOVERY_ACCEPTED',
      },
    });
    const accepted = await createCandidate({
      projectId: project.id,
      normalizedQuery: '已接受词',
      status: 'ACCEPTED',
      acceptedKeywordId: acceptedKeyword.id,
    });
    const rejected = await createCandidate({
      projectId: project.id,
      normalizedQuery: '已拒绝词',
      status: 'REJECTED',
    });

    await expectCode(service().reject({
      actorUserId: '00000000-0000-0000-0000-000000000010',
      projectId: project.id,
      candidateId: accepted.id,
    }), 'KEYWORD_DISCOVERY_ALREADY_DECIDED');

    await expectCode(service().accept({
      actorUserId: '00000000-0000-0000-0000-000000000010',
      projectId: project.id,
      candidateId: rejected.id,
      type: 'LONG_TAIL',
    }), 'KEYWORD_DISCOVERY_ALREADY_DECIDED');
  });
});
