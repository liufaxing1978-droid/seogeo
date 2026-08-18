import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { createApp } from '../../src/app.js';
import { executeSeoAudit } from '../../src/modules/seo/audit-engine.js';

async function createAuditFixture(
  projectId: string,
  pageId: string,
  suffix: string,
  snapshot: {
    title: string | null;
    metaDescription: string | null;
    h1: string | null;
    h1Count: number;
    responseTimeMs: number;
  }
) {
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com/',
      crawlerVersion: '0.1.0',
      finishedAt: new Date()
    }
  });

  await prisma.pageSnapshot.create({
    data: {
      pageId,
      crawlRunId: crawl.id,
      finalUrl: 'https://example.com/',
      statusCode: 200,
      contentType: 'text/html',
      title: snapshot.title,
      metaDescription: snapshot.metaDescription,
      canonicalUrl: 'https://example.com/',
      h1: snapshot.h1,
      h1Count: snapshot.h1Count,
      wordCount: 500,
      imagesCount: 0,
      imagesWithoutAlt: 0,
      responseTimeMs: snapshot.responseTimeMs,
      htmlSizeBytes: 12000,
      indexable: true,
      parserVersion: `0.1.0-${suffix}`
    }
  });

  await prisma.robotsResult.create({
    data: {
      crawlRunId: crawl.id,
      url: 'https://example.com/robots.txt',
      statusCode: 404
    }
  });

  await prisma.sitemapSource.create({
    data: {
      crawlRunId: crawl.id,
      url: 'https://example.com/sitemap.xml',
      statusCode: 200,
      type: 'URLSET',
      discoveredUrlCount: 1
    }
  });

  const audit = await prisma.seoAuditRun.create({
    data: {
      projectId,
      crawlRunId: crawl.id,
      status: 'QUEUED',
      engineVersion: '0.1.0'
    }
  });

  await executeSeoAudit(audit.id);
  return audit;
}

async function seedThreeAuditComparison() {
  const project = await prisma.project.create({
    data: {
      name: 'SEO Compare Fixture',
      slug: `seo-compare-${Date.now()}-${Math.random()}`,
      primaryDomain: 'example.com'
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

  const auditA = await createAuditFixture(project.id, page.id, 'a', {
    title: null,
    metaDescription: 'Complete description A',
    h1: 'Heading A',
    h1Count: 1,
    responseTimeMs: 200
  });

  const auditB = await createAuditFixture(project.id, page.id, 'b', {
    title: 'Healthy title B',
    metaDescription: 'Complete description B',
    h1: null,
    h1Count: 0,
    responseTimeMs: 4200
  });

  const auditC = await createAuditFixture(project.id, page.id, 'c', {
    title: null,
    metaDescription: null,
    h1: null,
    h1Count: 0,
    responseTimeMs: 200
  });

  return { project, auditA, auditB, auditC };
}

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('SEO audit compare web UI', () => {
  it('renders NEW, PERSISTENT, REGRESSED and FIXED groups from stored audit history', async () => {
    const fixture = await seedThreeAuditComparison();
    const app = createApp();

    const response = await request(app)
      .get(
        `/projects/${fixture.project.id}/seo/compare?current=${fixture.auditC.id}&previous=${fixture.auditB.id}`
      )
      .expect(200);

    expect(response.text).toContain('审计对比');
    expect(response.text).toContain('新增问题');
    expect(response.text).toContain('持续问题');
    expect(response.text).toContain('重新出现');
    expect(response.text).toContain('已修复');

    expect(response.text).toContain('Missing meta description');
    expect(response.text).toContain('Missing H1');
    expect(response.text).toContain('Missing title');
    expect(response.text).toContain('Slow response');

    expect(response.text).toContain(fixture.auditC.id);
    expect(response.text).toContain(fixture.auditB.id);
  });
});
