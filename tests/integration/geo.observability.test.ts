import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { runGeoAudit } from '../../src/modules/geo/audit-engine.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('P3 GEO observability', () => {
  it('emits aggregate lifecycle events without page bodies or rule evidence', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Observability Project',
        slug: `geo-observe-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });
    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: 'test',
        finishedAt: new Date()
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
        title: 'Observability Project',
        metaDescription: 'Deterministic GEO observability fixture.',
        canonicalUrl: 'https://example.com/',
        h1: 'Observability Project',
        h1Count: 1,
        h2Count: 1,
        h3Count: 0,
        wordCount: 400,
        externalLinksCount: 1,
        internalLinksCount: 1,
        schemaCount: 1,
        indexable: true,
        parserVersion: 'test'
      }
    });
    await prisma.pageStructuredSignal.create({
      data: {
        pageSnapshotId: snapshot.id,
        openGraphSiteName: 'Observability Project',
        entitySignals: [
          {
            schemaTypes: ['Organization'],
            id: 'https://example.com/#organization',
            name: 'Observability Project',
            alternateNames: [],
            url: 'https://example.com/',
            sameAs: [],
            role: 'ROOT',
            sourcePath: '$',
            parentSourcePath: null
          }
        ]
      }
    });

    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'QUEUED',
        engineVersion: 'geo-readiness-1'
      }
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runGeoAudit(audit.id);

    const entries = logSpy.mock.calls
      .map(([entry]) => entry)
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null);
    logSpy.mockRestore();

    const events = entries.map((entry) => entry.event);
    expect(events).toContain('geo.audit.started');
    expect(events).toContain('geo.citability.calculated');
    expect(events).toContain('geo.entities.observed');
    expect(events).toContain('geo.ai_crawler.evaluated');
    expect(events).toContain('geo.score.calculated');
    expect(events).toContain('geo.audit.completed');

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('rawHtml');
    expect(serialized).not.toContain('ruleEvidence');
    expect(serialized).not.toContain('Deterministic GEO observability fixture.');
  });
});
