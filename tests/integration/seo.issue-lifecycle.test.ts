import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { executeSeoAudit } from '../../src/modules/seo/audit-engine.js';

async function createProjectWithPage() {
  const project = await prisma.project.create({
    data: {
      name: 'Issue Lifecycle Fixture',
      slug: `issue-life-${Date.now()}-${Math.random()}`,
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
  return { project, page };
}

async function runAudit(
  projectId: string,
  pageId: string,
  title: string | null
) {
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com/',
      crawlerVersion: '0.1.0'
    }
  });
  await prisma.pageSnapshot.create({
    data: {
      pageId,
      crawlRunId: crawl.id,
      finalUrl: 'https://example.com/',
      statusCode: 200,
      contentType: 'text/html',
      title,
      metaDescription: 'A complete description for the fixture page.',
      canonicalUrl: 'https://example.com/',
      h1: 'Fixture heading',
      h1Count: 1,
      wordCount: 500,
      imagesCount: 0,
      imagesWithoutAlt: 0,
      responseTimeMs: 200,
      htmlSizeBytes: 15000,
      indexable: true,
      parserVersion: '0.1.0'
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

describe('SEO issue lifecycle', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  it('moves an issue NEW → RESOLVED → REGRESSED → PERSISTENT across deterministic audits', async () => {
    const { project, page } = await createProjectWithPage();

    const auditA = await runAudit(project.id, page.id, null);
    const issueAfterA = await prisma.seoIssue.findUniqueOrThrow({
      where: { projectId_issueKey: { projectId: project.id, issueKey: 'rule:TITLE_MISSING' } }
    });
    const occurrenceA = await prisma.seoIssueOccurrence.findUniqueOrThrow({
      where: { seoIssueId_auditRunId: { seoIssueId: issueAfterA.id, auditRunId: auditA.id } }
    });
    expect(issueAfterA.status).toBe('OPEN');
    expect(occurrenceA.comparison).toBe('NEW');
    expect(occurrenceA.affectedPagesCount).toBe(1);

    await runAudit(project.id, page.id, 'A properly descriptive page title');
    const issueAfterB = await prisma.seoIssue.findUniqueOrThrow({
      where: { projectId_issueKey: { projectId: project.id, issueKey: 'rule:TITLE_MISSING' } }
    });
    expect(issueAfterB.status).toBe('RESOLVED');
    expect(issueAfterB.resolvedAt).not.toBeNull();

    const auditC = await runAudit(project.id, page.id, null);
    const issueAfterC = await prisma.seoIssue.findUniqueOrThrow({
      where: { projectId_issueKey: { projectId: project.id, issueKey: 'rule:TITLE_MISSING' } }
    });
    const occurrenceC = await prisma.seoIssueOccurrence.findUniqueOrThrow({
      where: { seoIssueId_auditRunId: { seoIssueId: issueAfterC.id, auditRunId: auditC.id } }
    });
    expect(issueAfterC.status).toBe('REGRESSED');
    expect(issueAfterC.resolvedAt).toBeNull();
    expect(occurrenceC.comparison).toBe('REGRESSED');

    const auditD = await runAudit(project.id, page.id, null);
    const issueAfterD = await prisma.seoIssue.findUniqueOrThrow({
      where: { projectId_issueKey: { projectId: project.id, issueKey: 'rule:TITLE_MISSING' } }
    });
    const occurrenceD = await prisma.seoIssueOccurrence.findUniqueOrThrow({
      where: { seoIssueId_auditRunId: { seoIssueId: issueAfterD.id, auditRunId: auditD.id } }
    });
    expect(issueAfterD.id).toBe(issueAfterA.id);
    expect(occurrenceD.comparison).toBe('PERSISTENT');
  });

  it('keeps an ignored issue ignored while the deterministic failure persists', async () => {
    const { project, page } = await createProjectWithPage();
    await runAudit(project.id, page.id, null);

    const issue = await prisma.seoIssue.findUniqueOrThrow({
      where: { projectId_issueKey: { projectId: project.id, issueKey: 'rule:TITLE_MISSING' } }
    });
    await prisma.seoIssue.update({
      where: { id: issue.id },
      data: { status: 'IGNORED', ignoredAt: new Date() }
    });

    const auditB = await runAudit(project.id, page.id, null);
    const after = await prisma.seoIssue.findUniqueOrThrow({ where: { id: issue.id } });
    const occurrence = await prisma.seoIssueOccurrence.findUniqueOrThrow({
      where: { seoIssueId_auditRunId: { seoIssueId: issue.id, auditRunId: auditB.id } }
    });

    expect(after.status).toBe('IGNORED');
    expect(occurrence.comparison).toBe('PERSISTENT');
  });
});
