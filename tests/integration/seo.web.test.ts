import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { createApp } from '../../src/app.js';
import { executeSeoAudit } from '../../src/modules/seo/audit-engine.js';

async function seedSeoAuditFixture() {
  const project = await prisma.project.create({
    data: {
      name: 'SEO Web Fixture',
      slug: `seo-web-${Date.now()}-${Math.random()}`,
      primaryDomain: 'example.com'
    }
  });
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId: project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com/',
      crawlerVersion: '0.1.0',
      finishedAt: new Date()
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
  await prisma.pageSnapshot.create({
    data: {
      pageId: page.id,
      crawlRunId: crawl.id,
      finalUrl: page.normalizedUrl,
      statusCode: 200,
      contentType: 'text/html',
      title: null,
      metaDescription: 'A complete fixture description for the SEO web page.',
      canonicalUrl: page.normalizedUrl,
      h1: 'Fixture heading',
      h1Count: 1,
      wordCount: 500,
      imagesCount: 0,
      imagesWithoutAlt: 0,
      responseTimeMs: 200,
      htmlSizeBytes: 12000,
      indexable: true,
      parserVersion: '0.1.0'
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
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'QUEUED',
      engineVersion: '0.1.0'
    }
  });
  await executeSeoAudit(audit.id);
  const issue = await prisma.seoIssue.findUniqueOrThrow({
    where: {
      projectId_issueKey: {
        projectId: project.id,
        issueKey: 'rule:TITLE_MISSING'
      }
    }
  });
  return { project, audit, issue, page };
}

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('SEO audit web UI', () => {
  it('renders the latest deterministic audit score, severity and top issues', async () => {
    const fixture = await seedSeoAuditFixture();
    const app = createApp();

    const response = await request(app)
      .get(`/projects/${fixture.project.id}/seo`)
      .expect(200);

    expect(response.text).toContain('SEO 审计');
    expect(response.text).toContain('92.5');
    expect(response.text).toContain('Missing title');
    expect(response.text).toContain('HIGH');
    expect(response.text).toContain('7.5');
    expect(response.text).not.toContain('DeepSeek Intelligence');
  });

  it('renders issue center and deterministic issue detail with affected URL', async () => {
    const fixture = await seedSeoAuditFixture();
    const app = createApp();

    const issues = await request(app)
      .get(`/projects/${fixture.project.id}/seo/issues`)
      .expect(200);
    expect(issues.text).toContain('问题中心');
    expect(issues.text).toContain('Missing title');

    const detail = await request(app)
      .get(`/seo/issues/${fixture.issue.id}`)
      .expect(200);
    const occurrence = await prisma.seoIssueOccurrence.findUniqueOrThrow({
      where: {
        seoIssueId_auditRunId: {
          seoIssueId: fixture.issue.id,
          auditRunId: fixture.audit.id,
        },
      },
      include: { ruleVersion: { select: { fixGuide: true } } },
    });
    expect(detail.text).toContain('TITLE_MISSING');
    expect(detail.text).toContain('规则版本 1');
    expect(detail.text).toContain(fixture.page.normalizedUrl);
    expect(detail.text).toContain(occurrence.ruleVersion.fixGuide);
    expect(detail.text).not.toContain('标记为已解决');
  });
});
