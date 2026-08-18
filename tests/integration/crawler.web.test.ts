import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { createApp } from '../../src/app.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function fixture() {
  const project = await prisma.project.create({
    data: {
      name: 'Crawler UI Project',
      slug: `crawler-ui-${Date.now()}-${Math.random()}`,
      primaryDomain: 'example.com'
    }
  });
  const run = await prisma.crawlRun.create({
    data: {
      projectId: project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com/',
      maxPages: 100,
      pagesDiscovered: 2,
      pagesCrawled: 2,
      pagesSucceeded: 1,
      pagesFailed: 1,
      startedAt: new Date('2026-08-18T01:00:00Z'),
      finishedAt: new Date('2026-08-18T01:01:00Z'),
      crawlerVersion: '0.1.0'
    }
  });
  const page = await prisma.page.create({
    data: {
      projectId: project.id,
      url: 'https://example.com/about',
      normalizedUrl: 'https://example.com/about',
      host: 'example.com',
      path: '/about'
    }
  });
  await prisma.pageSnapshot.createMany({
    data: [
      {
        pageId: page.id,
        crawlRunId: run.id,
        finalUrl: page.normalizedUrl,
        statusCode: 200,
        contentType: 'text/html',
        title: 'About v1',
        h1: 'About',
        wordCount: 20,
        indexable: true,
        parserVersion: '0.1.0',
        capturedAt: new Date('2026-08-18T01:00:30Z')
      },
      {
        pageId: page.id,
        crawlRunId: run.id,
        finalUrl: page.normalizedUrl,
        statusCode: 200,
        contentType: 'text/html',
        title: 'About v2',
        h1: 'About Us',
        wordCount: 30,
        indexable: true,
        parserVersion: '0.1.0',
        capturedAt: new Date('2026-08-18T01:00:50Z')
      }
    ]
  });
  await prisma.robotsResult.create({
    data: {
      crawlRunId: run.id,
      url: 'https://example.com/robots.txt',
      statusCode: 200,
      rawText: 'User-agent: *\nAllow: /'
    }
  });
  const source = await prisma.sitemapSource.create({
    data: {
      crawlRunId: run.id,
      url: 'https://example.com/sitemap.xml',
      statusCode: 200,
      type: 'URLSET',
      discoveredUrlCount: 1
    }
  });
  await prisma.sitemapUrl.create({
    data: { sitemapSourceId: source.id, normalizedUrl: page.normalizedUrl }
  });
  return { project, run, page };
}

describe('crawler web UI', () => {
  it('renders crawl history with factual progress headings', async () => {
    const { project } = await fixture();
    const response = await request(createApp()).get(`/projects/${project.id}/crawls`).expect(200);

    for (const heading of ['状态', '类型', '开始时间', '完成时间', '发现页面', '已抓取', '成功', '失败']) {
      expect(response.text).toContain(heading);
    }
    expect(response.text).toContain('COMPLETED');
    expect(response.text).toContain('/projects/' + project.id + '/pages');
  });

  it('renders crawl detail with robots, sitemap and page results', async () => {
    const { run } = await fixture();
    const response = await request(createApp()).get(`/crawls/${run.id}`).expect(200);

    expect(response.text).toContain('抓取详情');
    expect(response.text).toContain('robots.txt');
    expect(response.text).toContain('sitemap.xml');
    expect(response.text).toContain('About v2');
    expect(response.text).not.toContain('<html><head>');
  });

  it('renders Page Center headings and latest factual snapshot', async () => {
    const { project } = await fixture();
    const response = await request(createApp()).get(`/projects/${project.id}/pages`).expect(200);

    for (const heading of ['URL', 'HTTP', 'Title', 'Indexable', '最近抓取']) {
      expect(response.text).toContain(heading);
    }
    expect(response.text).toContain('About v2');
  });

  it('renders page detail with latest snapshot and historical snapshots but no P2 score', async () => {
    const { page } = await fixture();
    const response = await request(createApp()).get(`/pages/${page.id}`).expect(200);

    expect(response.text).toContain('页面详情');
    expect(response.text).toContain('About v2');
    expect(response.text).toContain('About v1');
    expect(response.text).toContain('快照历史');
    expect(response.text).not.toContain('SEO Score');
    expect(response.text).not.toContain('Critical Issues');
  });
});
