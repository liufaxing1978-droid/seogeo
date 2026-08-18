import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('P5-A content persistence foundation', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let projectId: string;
  let pageId: string;
  let snapshotId: string;
  let aiTaskId: string;

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `P5A persistence ${suffix}`,
        slug: `p5a-persistence-${suffix}`,
        primaryDomain: `p5a-${suffix}.example.com`
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
    pageId = page.id;

    const snapshot = await prisma.pageSnapshot.create({
      data: {
        pageId,
        crawlRunId: crawl.id,
        finalUrl: page.url,
        statusCode: 200,
        title: 'Guide',
        h1: 'Guide',
        wordCount: 1200,
        contentHash: `content-${suffix}`,
        parserVersion: 'test'
      }
    });
    snapshotId = snapshot.id;

    const aiTask = await prisma.aiTask.create({
      data: {
        projectId,
        taskType: 'SEO_AUDIT_ANALYSIS',
        requestKey: `p5a-fixture-${suffix}`,
        promptVersion: 'seo-audit-analysis-v1',
        factSnapshot: { fixture: true },
        sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: snapshotId }]
      }
    });
    aiTaskId = aiTask.id;
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('persists one project/page content document with versioned signals and opportunities', async () => {
    const document = await prisma.contentDocument.create({
      data: {
        projectId,
        pageId,
        latestPageSnapshotId: snapshotId,
        canonicalUrl: 'https://example.com/guide',
        title: 'Guide',
        h1: 'Guide',
        wordCount: 1200,
        headingCount: 5,
        imageCount: 2,
        internalLinkCount: 4,
        externalLinkCount: 1,
        schemaTypes: ['Article'],
        contentHash: `content-${suffix}`,
        extractedAt: new Date()
      }
    });

    const signal = await prisma.contentSignal.create({
      data: {
        projectId,
        contentDocumentId: document.id,
        ruleKey: 'CONTENT_BODY_SUBSTANTIVE',
        ruleVersion: 1,
        status: 'PASS',
        priority: 'INFO',
        numericValue: 1200,
        sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: snapshotId }]
      }
    });

    const opportunity = await prisma.contentOpportunity.create({
      data: {
        projectId,
        contentDocumentId: document.id,
        opportunityKey: 'CONTENT_INTERNAL_LINK_SUPPORT',
        opportunityVersion: 1,
        category: 'INTERNAL_LINKING',
        priority: 'MEDIUM',
        summary: 'Increase deterministic internal support.',
        sourceReferences: [{ type: 'CONTENT_SIGNAL', id: signal.id }],
        firstDetectedAt: new Date(),
        lastDetectedAt: new Date()
      }
    });

    expect(signal.status).toBe('PASS');
    expect(opportunity.status).toBe('OPEN');

    await expect(
      prisma.contentDocument.create({
        data: {
          projectId,
          pageId,
          latestPageSnapshotId: snapshotId,
          canonicalUrl: 'https://example.com/duplicate',
          schemaTypes: [],
          contentHash: `duplicate-${suffix}`,
          extractedAt: new Date()
        }
      })
    ).rejects.toThrow();
  });

  it('links a validated content brief to the existing P4 AI task without owning provider-call history', async () => {
    const document = await prisma.contentDocument.findUniqueOrThrow({
      where: { projectId_pageId: { projectId, pageId } }
    });

    const brief = await prisma.contentBrief.create({
      data: {
        projectId,
        contentDocumentId: document.id,
        aiTaskId,
        promptVersion: 'content-brief-v1',
        factSnapshotHash: `hash-${suffix}`,
        briefJson: { objective: 'Improve coverage' },
        sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: snapshotId }]
      }
    });

    expect(brief.aiTaskId).toBe(aiTaskId);
    await expect(
      prisma.contentBrief.create({
        data: {
          projectId,
          contentDocumentId: document.id,
          aiTaskId,
          promptVersion: 'content-brief-v1',
          factSnapshotHash: `hash-duplicate-${suffix}`,
          briefJson: { objective: 'Duplicate' },
          sourceReferences: []
        }
      })
    ).rejects.toThrow();
  });

  it('deleting P5-A derived rows leaves P1 and P4 source history intact', async () => {
    await prisma.contentBrief.deleteMany({ where: { projectId } });
    await prisma.contentOpportunity.deleteMany({ where: { projectId } });
    await prisma.contentSignal.deleteMany({ where: { projectId } });
    await prisma.contentDocument.deleteMany({ where: { projectId } });

    expect(await prisma.page.findUnique({ where: { id: pageId } })).not.toBeNull();
    expect(await prisma.pageSnapshot.findUnique({ where: { id: snapshotId } })).not.toBeNull();
    expect(await prisma.aiTask.findUnique({ where: { id: aiTaskId } })).not.toBeNull();
  });
});
