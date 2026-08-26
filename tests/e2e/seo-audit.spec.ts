import { expect, test } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';
import { executeSeoAudit } from '../../src/modules/seo/audit-engine.js';

test('drills from SEO audit to deterministic issue detail', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'SEO Browser Fixture',
      slug: `seo-browser-${suffix}`,
      primaryDomain: 'browser-fixture.example'
    }
  });
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId: project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://browser-fixture.example/',
      crawlerVersion: '0.1.0',
      finishedAt: new Date()
    }
  });
  const fixturePage = await prisma.page.create({
    data: {
      projectId: project.id,
      url: 'https://browser-fixture.example/',
      normalizedUrl: 'https://browser-fixture.example/',
      host: 'browser-fixture.example',
      path: '/'
    }
  });
  await prisma.pageSnapshot.create({
    data: {
      pageId: fixturePage.id,
      crawlRunId: crawl.id,
      finalUrl: fixturePage.normalizedUrl,
      statusCode: 200,
      contentType: 'text/html',
      title: null,
      metaDescription: 'Browser fixture meta description with useful content.',
      canonicalUrl: fixturePage.normalizedUrl,
      h1: 'Browser fixture heading',
      h1Count: 1,
      wordCount: 500,
      imagesCount: 0,
      imagesWithoutAlt: 0,
      responseTimeMs: 180,
      htmlSizeBytes: 14000,
      indexable: true,
      parserVersion: '0.1.0'
    }
  });
  await prisma.robotsResult.create({
    data: {
      crawlRunId: crawl.id,
      url: 'https://browser-fixture.example/robots.txt',
      statusCode: 404
    }
  });
  await prisma.sitemapSource.create({
    data: {
      crawlRunId: crawl.id,
      url: 'https://browser-fixture.example/sitemap.xml',
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

  await page.goto(`/projects/${project.id}/seo`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'SEO 审计' })).toBeVisible();
  await expect(main.locator('[data-ui="seo-center"]')).toBeVisible();
  await expect(main.locator('[data-ui="seo-score-summary"]')).toContainText('92.5');
  await expect(main.locator('[data-ui="seo-evidence-table"]')).toBeVisible();
  await expect(main.getByText('92.5', { exact: true }).first()).toBeVisible();
  await expect(main.getByText('关键词排名')).toHaveCount(0);

  await main.getByRole('link', { name: 'Missing title' }).first().click();
  const issueMain = page.getByRole('main');
  await expect(issueMain.getByRole('heading', { level: 1, name: 'Missing title' })).toBeVisible();
  await expect(issueMain.getByText('TITLE_MISSING', { exact: true })).toBeVisible();
  await expect(issueMain.getByText('https://browser-fixture.example/', { exact: true })).toBeVisible();
});
