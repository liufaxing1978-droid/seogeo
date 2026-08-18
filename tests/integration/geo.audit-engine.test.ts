import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { runGeoAudit } from '../../src/modules/geo/audit-engine.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('runGeoAudit', () => {
  it('runs deterministic P3 dimensions and persists GEO_READINESS_V1 without AI Visibility', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Example Brand',
        slug: `geo-audit-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        maxPages: 10,
        crawlerVersion: 'test'
      }
    });

    await prisma.robotsResult.create({
      data: {
        crawlRunId: crawl.id,
        url: 'https://example.com/robots.txt',
        statusCode: 200,
        rawText: 'User-agent: *\nAllow: /'
      }
    });

    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        host: 'example.com',
        path: '/'
      }
    });

    const snapshot = await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawl.id,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Example Brand Official Guide',
        metaDescription: 'A factual example page used for deterministic GEO readiness testing.',
        canonicalUrl: 'https://example.com/',
        h1: 'Example Brand',
        h1Count: 1,
        h2Count: 2,
        h3Count: 1,
        wordCount: 600,
        externalLinksCount: 2,
        internalLinksCount: 2,
        schemaCount: 1,
        indexable: true,
        parserVersion: 'test'
      }
    });

    await prisma.pageStructuredSignal.create({
      data: {
        pageSnapshotId: snapshot.id,
        openGraphSiteName: 'Example Brand',
        entitySignals: [
          {
            schemaTypes: ['Organization'],
            id: 'https://example.com/#organization',
            name: 'Example Brand',
            alternateNames: [],
            url: 'https://example.com/',
            sameAs: [
              'https://www.facebook.com/example',
              'https://www.instagram.com/example'
            ],
            role: 'ROOT',
            sourcePath: '$',
            parentSourcePath: null
          }
        ]
      }
    });

    await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/about',
        normalizedUrl: 'https://example.com/about',
        host: 'example.com',
        path: '/about'
      }
    });

    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'QUEUED',
        engineVersion: 'geo-readiness-test'
      }
    });

    const result = await runGeoAudit(audit.id);

    expect(result.status).toBe('COMPLETED');
    expect(result.geoScore).not.toBeNull();
    expect(result.geoScore?.scoreType).toBe('GEO_READINESS_V1');

    const persistedAudit = await prisma.geoAuditRun.findUniqueOrThrow({ where: { id: audit.id } });
    expect(persistedAudit.status).toBe('COMPLETED');
    expect(persistedAudit.eligiblePages).toBe(1);
    expect(persistedAudit.rulesEvaluated).toBeGreaterThan(0);
    expect(persistedAudit.finishedAt).not.toBeNull();

    expect(await prisma.citabilityResult.count({ where: { geoAuditRunId: audit.id } })).toBe(1);
    expect(await prisma.entity.count({ where: { projectId: project.id, entityType: 'ORGANIZATION' } })).toBe(1);
    expect(await prisma.aiCrawlerResult.count({ where: { geoAuditRunId: audit.id } })).toBe(6);
    expect(await prisma.brandAuthorityResult.count({ where: { geoAuditRunId: audit.id } })).toBe(1);
    expect(await prisma.geoRuleResult.count({ where: { geoAuditRunId: audit.id } })).toBeGreaterThan(0);

    const score = await prisma.geoScore.findUniqueOrThrow({
      where: { geoAuditRunId: audit.id },
      include: { components: { orderBy: { componentCode: 'asc' } } }
    });
    expect(score.scoreType).toBe('GEO_READINESS_V1');
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(score.components.map((component) => component.componentCode).sort()).toEqual([
      'AI_CRAWLER',
      'BRAND',
      'CITABILITY',
      'CONTENT_GEO',
      'ENTITY'
    ]);
    expect(score.components.some((component) => component.componentCode === 'AI_VISIBILITY')).toBe(false);
  });
});
