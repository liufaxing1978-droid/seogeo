import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { calculateCitabilityForAudit } from '../../src/modules/geo/citability.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
  await prisma.geoRuleVersion.deleteMany();
  await prisma.geoRule.deleteMany();
});

describe('Citability audit persistence', () => {
  it('reads the linked P1 crawl facts and persists unknown semantic sub-scores as null', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Citability Fixture',
        slug: `citability-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const crawlRun = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        maxPages: 10,
        crawlerVersion: '0.1.0',
        startedAt: new Date(),
        finishedAt: new Date()
      }
    });

    const article = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/article',
        normalizedUrl: 'https://example.com/article',
        host: 'example.com',
        path: '/article'
      }
    });

    await prisma.pageSnapshot.create({
      data: {
        pageId: article.id,
        crawlRunId: crawlRun.id,
        finalUrl: 'https://example.com/article',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Example Article',
        canonicalUrl: 'https://example.com/article',
        h1: 'Example Article',
        h1Count: 1,
        h2Count: 3,
        h3Count: 1,
        wordCount: 650,
        internalLinksCount: 4,
        externalLinksCount: 2,
        schemaCount: 1,
        indexable: true,
        parserVersion: '0.1.0'
      }
    });

    const pdf = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/file.pdf',
        normalizedUrl: 'https://example.com/file.pdf',
        host: 'example.com',
        path: '/file.pdf'
      }
    });

    await prisma.pageSnapshot.create({
      data: {
        pageId: pdf.id,
        crawlRunId: crawlRun.id,
        finalUrl: 'https://example.com/file.pdf',
        statusCode: 200,
        contentType: 'application/pdf',
        wordCount: 0,
        parserVersion: '0.1.0'
      }
    });

    const geoAudit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'RUNNING',
        engineVersion: 'geo-0.1.0'
      }
    });

    const summary = await calculateCitabilityForAudit(geoAudit.id, 'citability-1');

    expect(summary).toEqual({ eligiblePages: 1, persistedResults: 1 });

    const persisted = await prisma.citabilityResult.findMany({
      where: { geoAuditRunId: geoAudit.id },
      orderBy: { pageId: 'asc' }
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.pageId).toBe(article.id);
    expect(persisted[0]?.answerFirstScore).toBeNull();
    expect(persisted[0]?.factualDensityScore).toBeNull();
    expect(persisted[0]?.definitionClarityScore).toBeNull();
    expect(persisted[0]?.headingStructureScore).toBe(100);
    expect(persisted[0]?.sourceSupportScore).toBe(100);
    expect(persisted[0]?.extractabilityScore).toBe(100);
    expect(persisted[0]?.overallScore).toBe(100);
    expect(persisted[0]?.engineVersion).toBe('citability-1');
  });

  it('is idempotent inside one GEO audit while preserving results from earlier audits', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Citability History',
        slug: `citability-history-${Date.now()}`,
        primaryDomain: 'history.example.com'
      }
    });

    const crawlRun = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://history.example.com/',
        crawlerVersion: '0.1.0'
      }
    });

    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://history.example.com/',
        normalizedUrl: 'https://history.example.com/',
        host: 'history.example.com',
        path: '/'
      }
    });

    await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawlRun.id,
        finalUrl: 'https://history.example.com/',
        statusCode: 200,
        contentType: 'text/html',
        title: 'History',
        canonicalUrl: 'https://history.example.com/',
        h1: 'History',
        h1Count: 1,
        h2Count: 1,
        wordCount: 400,
        externalLinksCount: 1,
        indexable: true,
        parserVersion: '0.1.0'
      }
    });

    const firstAudit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'RUNNING',
        engineVersion: 'geo-0.1.0'
      }
    });
    const secondAudit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'RUNNING',
        engineVersion: 'geo-0.1.0'
      }
    });

    await calculateCitabilityForAudit(firstAudit.id, 'citability-1');
    await calculateCitabilityForAudit(firstAudit.id, 'citability-1');
    await calculateCitabilityForAudit(secondAudit.id, 'citability-1');

    expect(await prisma.citabilityResult.count({ where: { geoAuditRunId: firstAudit.id } })).toBe(1);
    expect(await prisma.citabilityResult.count({ where: { geoAuditRunId: secondAudit.id } })).toBe(1);
    expect(await prisma.citabilityResult.count()).toBe(2);
  });
});
