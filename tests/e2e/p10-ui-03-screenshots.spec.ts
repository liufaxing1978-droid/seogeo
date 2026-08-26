import { expect, test, type Page } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';
import { executeSeoAudit } from '../../src/modules/seo/audit-engine.js';
import { authenticateE2e } from './e2e-auth.js';

async function prepareViewport(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

async function expectNoPageOverflow(page: Page, width: number) {
  await prepareViewport(page, width);
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(Math.max(widths.document, widths.body)).toBeLessThanOrEqual(widths.viewport + 1);
}

async function captureDesktop(page: Page, path: string) {
  await expectNoPageOverflow(page, 1440);
  await page.screenshot({ path, fullPage: false });
  await expectNoPageOverflow(page, 820);
}

async function renameAcceptanceProject(projectId: string, name: string, primaryDomain: string) {
  return prisma.project.update({
    where: { id: projectId },
    data: { name, primaryDomain },
  });
}

test('captures deterministic SEO Center acceptance at desktop and validates tablet overflow', async ({ page, context }) => {
  const fixture = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'STANDARD',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
  const project = await renameAcceptanceProject(
    fixture.project.id,
    'SEO Center Acceptance',
    'seo-acceptance.example.com',
  );

  const crawl = await prisma.crawlRun.create({
    data: {
      projectId: project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://seo-acceptance.example.com/',
      crawlerVersion: '0.1.0',
      finishedAt: new Date('2026-08-26T08:00:00.000Z'),
    },
  });
  const pageFact = await prisma.page.create({
    data: {
      projectId: project.id,
      url: 'https://seo-acceptance.example.com/',
      normalizedUrl: 'https://seo-acceptance.example.com/',
      host: 'seo-acceptance.example.com',
      path: '/',
    },
  });
  await prisma.pageSnapshot.create({
    data: {
      pageId: pageFact.id,
      crawlRunId: crawl.id,
      finalUrl: pageFact.normalizedUrl,
      statusCode: 200,
      contentType: 'text/html',
      title: null,
      metaDescription: 'Deterministic SEO acceptance fixture with a useful meta description.',
      canonicalUrl: pageFact.normalizedUrl,
      h1: 'SEO acceptance heading',
      h1Count: 1,
      wordCount: 500,
      imagesCount: 0,
      imagesWithoutAlt: 0,
      responseTimeMs: 180,
      htmlSizeBytes: 14000,
      indexable: true,
      parserVersion: '0.1.0',
    },
  });
  await prisma.robotsResult.create({
    data: {
      crawlRunId: crawl.id,
      url: 'https://seo-acceptance.example.com/robots.txt',
      statusCode: 404,
    },
  });
  await prisma.sitemapSource.create({
    data: {
      crawlRunId: crawl.id,
      url: 'https://seo-acceptance.example.com/sitemap.xml',
      statusCode: 200,
      type: 'URLSET',
      discoveredUrlCount: 1,
    },
  });
  const audit = await prisma.seoAuditRun.create({
    data: {
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'QUEUED',
      engineVersion: '0.1.0',
    },
  });
  await executeSeoAudit(audit.id);

  await prepareViewport(page, 1440);
  await page.goto(`/projects/${project.id}/seo`);
  const main = page.getByRole('main');
  await expect(main.locator('[data-ui="seo-center"]')).toBeVisible();
  await expect(main.locator('[data-ui="seo-score-summary"]')).toContainText('92.5');
  await expect(main.getByText('关键词排名')).toHaveCount(0);
  await captureDesktop(page, 'p10-ui-03-seo.png');
});

test('captures deterministic AI Visibility acceptance at desktop and validates tablet overflow', async ({ page, context }) => {
  const fixture = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ADVANCED',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
  const project = await renameAcceptanceProject(
    fixture.project.id,
    'AI Visibility Acceptance',
    'visibility-acceptance.example.com',
  );

  const snapshot = await prisma.visibilityMetricSnapshot.create({
    data: {
      projectId: project.id,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'a'.repeat(64),
      subjectSnapshotJson: { source: 'deterministic-browser-acceptance' },
      windowStart: new Date('2026-08-01T00:00:00.000Z'),
      windowEnd: new Date('2026-08-08T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-08-08T12:00:00.000Z'),
      scopeJson: { providers: [], promptSetIds: [] },
      scopeHash: 'b'.repeat(64),
      inputFingerprint: 'c'.repeat(64),
      candidateObservationCount: 10,
      completedExtractionCount: 9,
      missingExtractionCount: 1,
      failedExtractionCount: 0,
      completedAt: new Date('2026-08-09T00:00:00.000Z'),
    },
  });

  const shared = {
    visibilityMetricSnapshotId: snapshot.id,
    projectId: project.id,
    candidateObservationCount: 10,
    notEligibleObservationCount: 0,
  } as const;
  await prisma.visibilityMetricRow.createMany({
    data: [
      {
        ...shared,
        metricType: 'MENTION_RATE',
        metricStatus: 'CALCULATED',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP',
        numerator: 6,
        denominator: 10,
        eligibleObservationCount: 10,
        unknownObservationCount: 0,
      },
      {
        ...shared,
        metricType: 'CITATION_RATE',
        metricStatus: 'CALCULATED',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP',
        numerator: 3,
        denominator: 10,
        eligibleObservationCount: 10,
        unknownObservationCount: 0,
      },
      {
        ...shared,
        metricType: 'MENTION_SHARE_OF_VOICE',
        metricStatus: 'CALCULATED',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP',
        numerator: 4,
        denominator: 10,
        eligibleObservationCount: 10,
        unknownObservationCount: 0,
      },
    ],
  });

  await prepareViewport(page, 1440);
  await page.goto(`/projects/${project.id}/visibility`);
  const main = page.getByRole('main');
  await expect(main.locator('[data-ui="visibility-center"]')).toBeVisible();
  await expect(main.locator('[data-ui="visibility-metrics-summary"]')).toContainText('60.0%');
  await expect(main.locator('[data-ui="visibility-metrics-summary"]')).toContainText('30.0%');
  await expect(main.locator('[data-ui="visibility-metrics-summary"]')).toContainText('40.0%');
  await expect(main.getByText('ChatGPT 网页端排名')).toHaveCount(0);
  await captureDesktop(page, 'p10-ui-03-visibility.png');
});

test('captures truthful Standard AI Analysis empty state at desktop and validates tablet overflow', async ({ page, context }) => {
  const fixture = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'STANDARD',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
  const project = await renameAcceptanceProject(
    fixture.project.id,
    'AI Analysis Acceptance',
    'ai-analysis-acceptance.example.com',
  );

  await prepareViewport(page, 1440);
  await page.goto(`/projects/${project.id}/ai`);
  const main = page.getByRole('main');
  await expect(main.locator('[data-ui="ai-analysis-center"]')).toBeVisible();
  await expect(main.locator('[data-ui="ai-advisory-boundary"]')).toContainText('AI 只分析已保存事实');
  await expect(main.locator('[data-ui="ai-task-history"]')).toContainText('尚无 AI 分析任务');
  await expect(main.getByText(/P6 高级版/)).toBeVisible();
  await captureDesktop(page, 'p10-ui-03-ai.png');
});
