import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('P13-A content quality persistence foundation', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let projectId: string;
  let contentDocumentId: string;

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `P13A persistence ${suffix}`,
        slug: `p13a-persistence-${suffix}`,
        primaryDomain: `p13a-${suffix}.example.com`
      }
    });
    projectId = project.id;

    const crawl = await prisma.crawlRun.create({
      data: {
        projectId,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: `https://${project.primaryDomain}/`,
        crawlerVersion: 'test'
      }
    });

    const page = await prisma.page.create({
      data: {
        projectId,
        url: `https://${project.primaryDomain}/guide`,
        normalizedUrl: `https://${project.primaryDomain}/guide`,
        host: project.primaryDomain,
        path: '/guide'
      }
    });

    const snapshot = await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawl.id,
        finalUrl: page.url,
        statusCode: 200,
        contentHash: `content-${suffix}`,
        parserVersion: 'test'
      }
    });

    const document = await prisma.contentDocument.create({
      data: {
        projectId,
        pageId: page.id,
        latestPageSnapshotId: snapshot.id,
        canonicalUrl: page.normalizedUrl,
        schemaTypes: [],
        contentHash: `content-${suffix}`,
        extractedAt: new Date()
      }
    });
    contentDocumentId = document.id;
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('keeps one stable finding per document/rule/version and append-only history', async () => {
    const now = new Date();
    const input = {
      projectId,
      contentDocumentId,
      findingKey: 'CONTENT_INTERNAL_LINK_SUPPORT',
      ruleVersion: 1,
      latestRunId: null,
      category: 'INTERNAL_LINK_SUPPORT' as const,
      priority: 'MEDIUM' as const,
      summary: 'Add relevant owned-site internal-link support after human review.',
      evidence: { status: 'FAIL', source: 'PAGE_SNAPSHOT' },
      firstDetectedAt: now,
      lastDetectedAt: now
    };

    const first = await prisma.contentQualityFinding.upsert({
      where: {
        contentDocumentId_findingKey_ruleVersion: {
          contentDocumentId: input.contentDocumentId,
          findingKey: input.findingKey,
          ruleVersion: input.ruleVersion
        }
      },
      create: input,
      update: input
    });
    const second = await prisma.contentQualityFinding.upsert({
      where: {
        contentDocumentId_findingKey_ruleVersion: {
          contentDocumentId: input.contentDocumentId,
          findingKey: input.findingKey,
          ruleVersion: input.ruleVersion
        }
      },
      create: { ...input, summary: 'new evidence' },
      update: { summary: 'new evidence', evidence: { status: 'FAIL', source: 'LATEST_PAGE_SNAPSHOT' }, lastDetectedAt: new Date() }
    });

    expect(second.id).toBe(first.id);
    expect(second.summary).toBe('new evidence');

    await prisma.contentQualityFindingHistory.create({
      data: {
        findingId: first.id,
        fromStatus: 'OPEN',
        toStatus: 'IN_REVIEW',
        actorId: 'test-operator',
        metadata: { source: 'manual-review' }
      }
    });
    await prisma.contentQualityFindingHistory.create({
      data: {
        findingId: first.id,
        fromStatus: 'IN_REVIEW',
        toStatus: 'DISMISSED',
        actorId: 'test-operator',
        reason: 'No current editorial priority.',
        metadata: { source: 'manual-review' }
      }
    });

    const history = await prisma.contentQualityFindingHistory.findMany({
      where: { findingId: first.id },
      select: { fromStatus: true, toStatus: true },
      orderBy: { createdAt: 'asc' }
    });
    expect(history).toEqual([
      { fromStatus: 'OPEN', toStatus: 'IN_REVIEW' },
      { fromStatus: 'IN_REVIEW', toStatus: 'DISMISSED' }
    ]);
  });
});
