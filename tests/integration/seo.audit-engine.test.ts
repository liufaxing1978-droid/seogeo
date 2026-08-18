import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { executeSeoAudit } from '../../src/modules/seo/audit-engine.js';
import { seoRepository } from '../../src/modules/seo/seo.repository.js';

async function createFixture() {
  const project = await prisma.project.create({
    data: {
      name: 'SEO Audit Fixture',
      slug: `seo-audit-${Date.now()}-${Math.random()}`,
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
  const home = await prisma.page.create({
    data: {
      projectId: project.id,
      url: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      host: 'example.com',
      path: '/'
    }
  });
  const missing = await prisma.page.create({
    data: {
      projectId: project.id,
      url: 'https://example.com/missing',
      normalizedUrl: 'https://example.com/missing',
      host: 'example.com',
      path: '/missing'
    }
  });

  const homeSnapshot = await prisma.pageSnapshot.create({
    data: {
      pageId: home.id,
      crawlRunId: crawl.id,
      finalUrl: home.normalizedUrl,
      statusCode: 200,
      contentType: 'text/html',
      title: null,
      metaDescription: 'Home description',
      canonicalUrl: home.normalizedUrl,
      h1: 'Home',
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
  await prisma.pageSnapshot.create({
    data: {
      pageId: missing.id,
      crawlRunId: crawl.id,
      finalUrl: missing.normalizedUrl,
      statusCode: 404,
      contentType: 'text/html',
      title: null,
      h1Count: 0,
      wordCount: 0,
      imagesCount: 0,
      imagesWithoutAlt: 0,
      responseTimeMs: 180,
      htmlSizeBytes: 4000,
      indexable: false,
      parserVersion: '0.1.0'
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

  return { project, crawl, home, missing, homeSnapshot, audit };
}

describe('executeSeoAudit', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  it('evaluates the selected crawl into raw deterministic rule results', async () => {
    const fixture = await createFixture();

    await executeSeoAudit(fixture.audit.id);

    const completed = await prisma.seoAuditRun.findUniqueOrThrow({ where: { id: fixture.audit.id } });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.eligiblePages).toBe(2);
    expect(completed.rulesEvaluated).toBeGreaterThan(0);
    expect(completed.startedAt).not.toBeNull();
    expect(completed.finishedAt).not.toBeNull();

    const missingTitle = await prisma.seoRuleResult.findFirstOrThrow({
      where: {
        auditRunId: fixture.audit.id,
        pageId: fixture.home.id,
        ruleVersion: { seoRule: { ruleCode: 'TITLE_MISSING' } }
      }
    });
    expect(missingTitle).toMatchObject({ outcome: 'FAIL' });
    expect(missingTitle.evidence).toEqual({ title: null });

    const titleOn404 = await prisma.seoRuleResult.findFirstOrThrow({
      where: {
        auditRunId: fixture.audit.id,
        pageId: fixture.missing.id,
        ruleVersion: { seoRule: { ruleCode: 'TITLE_MISSING' } }
      }
    });
    expect(titleOn404.outcome).toBe('NOT_APPLICABLE');

    const http404 = await prisma.seoRuleResult.findFirstOrThrow({
      where: {
        auditRunId: fixture.audit.id,
        pageId: fixture.missing.id,
        ruleVersion: { seoRule: { ruleCode: 'HTTP_4XX' } }
      }
    });
    expect(http404).toMatchObject({ outcome: 'FAIL' });
    expect(http404.evidence).toEqual({ statusCode: 404 });

    const snapshotAfterAudit = await prisma.pageSnapshot.findUniqueOrThrow({
      where: { id: fixture.homeSnapshot.id }
    });
    expect(snapshotAfterAudit.title).toBeNull();
  });

  it('marks the audit failed when evaluation cannot load facts and leaves P1 facts untouched', async () => {
    const fixture = await createFixture();
    const failingRepository = {
      ...seoRepository,
      getAuditInput: async () => {
        throw new Error('fixture audit input failure');
      }
    };

    await expect(
      executeSeoAudit(fixture.audit.id, { repository: failingRepository })
    ).rejects.toThrow('fixture audit input failure');

    const failed = await prisma.seoAuditRun.findUniqueOrThrow({ where: { id: fixture.audit.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.errorMessage).toContain('fixture audit input failure');

    const snapshot = await prisma.pageSnapshot.findUniqueOrThrow({ where: { id: fixture.homeSnapshot.id } });
    expect(snapshot.title).toBeNull();
    expect(snapshot.statusCode).toBe(200);
  });
});
