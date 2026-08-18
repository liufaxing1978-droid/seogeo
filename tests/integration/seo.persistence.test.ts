import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

describe('SEO audit persistence', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  it('stores an audit run tied to one completed crawl without mutating crawl facts', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'SEO Fixture',
        slug: `seo-${Date.now()}`,
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
        crawlerVersion: '0.1.0'
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

    expect(audit.projectId).toBe(project.id);
    expect(audit.crawlRunId).toBe(crawl.id);
    expect(await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawl.id } })).toMatchObject({
      status: 'COMPLETED'
    });
  });

  it('stores a stable issue identity separately from its per-audit occurrence', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Issue Fixture',
        slug: `issue-${Date.now()}`,
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
    const audit = await prisma.seoAuditRun.create({
      data: { projectId: project.id, crawlRunId: crawl.id, status: 'COMPLETED', engineVersion: '0.1.0' }
    });
    const rule = await prisma.seoRule.create({
      data: {
        ruleCode: 'TITLE_MISSING',
        name: 'Missing title',
        category: 'Metadata',
        description: 'Title is missing'
      }
    });
    const version = await prisma.seoRuleVersion.create({
      data: {
        seoRuleId: rule.id,
        version: 1,
        severity: 'HIGH',
        weight: 3,
        detectionType: 'PAGE_FACT',
        seoImpact: 'Search result relevance is weakened.',
        fixGuide: 'Add a unique descriptive title.',
        releasedAt: new Date()
      }
    });
    const issue = await prisma.seoIssue.create({
      data: {
        projectId: project.id,
        ruleId: rule.id,
        issueKey: 'rule:TITLE_MISSING',
        title: 'Missing title',
        category: 'Metadata',
        currentSeverity: 'HIGH',
        status: 'OPEN',
        firstSeenAt: new Date(),
        lastSeenAt: new Date()
      }
    });
    const occurrence = await prisma.seoIssueOccurrence.create({
      data: {
        seoIssueId: issue.id,
        auditRunId: audit.id,
        ruleVersionId: version.id,
        comparison: 'NEW',
        severity: 'HIGH',
        affectedPagesCount: 1
      }
    });

    expect(issue.issueKey).toBe('rule:TITLE_MISSING');
    expect(occurrence.seoIssueId).toBe(issue.id);
  });
});
