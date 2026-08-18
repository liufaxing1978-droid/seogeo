import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { executeSeoAudit } from '../../src/modules/seo/audit-engine.js';

describe('crawl-level SEO rule persistence', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  it('persists robots/sitemap failures as project-level issues without fake affected page rows', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Crawl Rule Fixture',
        slug: `crawl-rule-${Date.now()}-${Math.random()}`,
        primaryDomain: 'example.com'
      }
    });
    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: '0.1.0'
      }
    });

    await prisma.robotsResult.create({
      data: {
        crawlRunId: crawl.id,
        url: 'https://example.com/robots.txt',
        statusCode: 503,
        parseError: 'robots unavailable: HTTP 503'
      }
    });
    await prisma.sitemapSource.create({
      data: {
        crawlRunId: crawl.id,
        url: 'https://example.com/sitemap.xml',
        statusCode: 200,
        type: null,
        parseError: 'Invalid XML',
        discoveredUrlCount: 0
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

    const robotsResult = await prisma.seoRuleResult.findFirstOrThrow({
      where: {
        auditRunId: audit.id,
        pageId: null,
        ruleVersion: { seoRule: { ruleCode: 'ROBOTS_SERVER_ERROR' } }
      }
    });
    expect(robotsResult).toMatchObject({
      resultKey: 'crawl:ROBOTS_SERVER_ERROR',
      outcome: 'FAIL'
    });

    const sitemapResult = await prisma.seoRuleResult.findFirstOrThrow({
      where: {
        auditRunId: audit.id,
        pageId: null,
        ruleVersion: { seoRule: { ruleCode: 'SITEMAP_PARSE_ERROR' } }
      }
    });
    expect(sitemapResult.outcome).toBe('FAIL');

    const robotsIssue = await prisma.seoIssue.findUniqueOrThrow({
      where: {
        projectId_issueKey: {
          projectId: project.id,
          issueKey: 'rule:ROBOTS_SERVER_ERROR'
        }
      },
      include: { occurrences: { include: { pages: true } } }
    });
    expect(robotsIssue.occurrences[0]).toMatchObject({ affectedPagesCount: 0, comparison: 'NEW' });
    expect(robotsIssue.occurrences[0]?.pages).toHaveLength(0);
  });

  it('does not create a robots issue for a factual 404 robots.txt response', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Robots 404 Fixture',
        slug: `robots-404-${Date.now()}-${Math.random()}`,
        primaryDomain: 'example.com'
      }
    });
    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: '0.1.0'
      }
    });
    await prisma.robotsResult.create({
      data: {
        crawlRunId: crawl.id,
        url: 'https://example.com/robots.txt',
        statusCode: 404,
        parseError: null
      }
    });
    await prisma.sitemapSource.create({
      data: {
        crawlRunId: crawl.id,
        url: 'https://example.com/sitemap.xml',
        statusCode: 200,
        type: 'URLSET',
        parseError: null,
        discoveredUrlCount: 2
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

    expect(
      await prisma.seoIssue.count({
        where: {
          projectId: project.id,
          issueKey: { in: ['rule:ROBOTS_FETCH_FAILED', 'rule:ROBOTS_SERVER_ERROR'] }
        }
      })
    ).toBe(0);
  });
});
