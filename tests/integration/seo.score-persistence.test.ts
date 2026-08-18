import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { executeSeoAudit } from '../../src/modules/seo/audit-engine.js';
import { calculateAndPersistSeoScore } from '../../src/modules/seo/score-engine.js';

async function createProjectWithPage() {
  const project = await prisma.project.create({
    data: {
      name: 'SEO Score Fixture',
      slug: `seo-score-${Date.now()}-${Math.random()}`,
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

async function runAudit(projectId: string, pageId: string, title: string | null) {
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
      metaDescription: 'A complete and useful meta description for this fixture page.',
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

describe('SEO score persistence', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  it('persists an explainable score from FAIL/PASS eligible results only', async () => {
    const { project, page } = await createProjectWithPage();
    const audit = await runAudit(project.id, page.id, null);

    const score = await prisma.seoScore.findUniqueOrThrow({
      where: { auditRunId: audit.id },
      include: { components: { include: { ruleVersion: { include: { seoRule: true } } } } }
    });

    expect(score.score).toBe(92.5);
    expect(score.previousScore).toBeNull();
    expect(score.change).toBeNull();

    const titleComponent = score.components.find(
      (component) => component.ruleVersion.seoRule.ruleCode === 'TITLE_MISSING'
    );
    expect(titleComponent).toMatchObject({
      affectedPages: 1,
      eligiblePages: 1,
      pageImpactFactor: 1,
      severityMultiplier: 2.5,
      weight: 3,
      importanceFactor: 1,
      penalty: 7.5
    });

    expect(score.components).toHaveLength(1);
  });

  it('stores previous score/change and recalculation is idempotent for the same audit', async () => {
    const { project, page } = await createProjectWithPage();
    const first = await runAudit(project.id, page.id, null);
    const second = await runAudit(project.id, page.id, 'A properly descriptive page title');

    const secondScore = await prisma.seoScore.findUniqueOrThrow({ where: { auditRunId: second.id } });
    expect(secondScore.score).toBe(100);
    expect(secondScore.previousScore).toBe(92.5);
    expect(secondScore.change).toBe(7.5);

    await calculateAndPersistSeoScore(first.id);
    await calculateAndPersistSeoScore(first.id);

    expect(await prisma.seoScore.count({ where: { auditRunId: first.id } })).toBe(1);
    const firstScore = await prisma.seoScore.findUniqueOrThrow({
      where: { auditRunId: first.id },
      include: { components: true }
    });
    expect(firstScore.components).toHaveLength(1);
  });
});
