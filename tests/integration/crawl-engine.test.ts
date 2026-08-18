import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../src/db/prisma.js';
import type { FetchOptions, FetchResult } from '../../src/modules/crawler/crawl.types.js';
import { executeCrawlRun } from '../../src/modules/crawler/crawl-engine.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml`);
      return;
    }

    if (req.url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(`<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>${baseUrl}/</loc></url>
          <url><loc>${baseUrl}/about</loc></url>
          <url><loc>${baseUrl}/redirect</loc></url>
          <url><loc>${baseUrl}/missing</loc></url>
        </urlset>`);
      return;
    }

    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<html><head><title>Home</title></head><body>
        <h1>Home</h1><p>${'home content '.repeat(30)}</p>
        <a href="/about">About</a>
        <a href="https://external.test/out">External</a>
      </body></html>`);
      return;
    }

    if (req.url === '/about') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<html><head><title>About</title><link rel="canonical" href="/about"></head>
        <body><h1>About</h1><p>${'about content '.repeat(30)}</p></body></html>`);
      return;
    }

    if (req.url === '/redirect') {
      res.writeHead(301, { location: '/about' });
      res.end();
      return;
    }

    if (req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>Missing</title></head><body><h1>Not found</h1></body></html>');
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(async () => {
  await prisma.project.deleteMany();
});

const allowLocalTarget = async () => undefined;

function factualResult(url: string, overrides: Partial<FetchResult>): FetchResult {
  return {
    requestUrl: url,
    finalUrl: url,
    statusCode: 200,
    headers: {},
    body: null,
    contentType: null,
    bytes: 0,
    responseTimeMs: 1,
    redirectChain: [],
    errorCode: null,
    ...overrides
  };
}

describe('executeCrawlRun', () => {
  it('crawls root, sitemap URLs and internal links while persisting factual history', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Fixture Site',
        slug: `fixture-${Date.now()}`,
        primaryDomain: '127.0.0.1'
      }
    });
    const run = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'QUEUED',
        seedUrl: `${baseUrl}/`,
        maxPages: 20,
        crawlerVersion: '0.1.0'
      }
    });

    await executeCrawlRun(run.id, {
      publicTargetGuard: allowLocalTarget,
      browserEnabled: false,
      concurrency: 2
    });

    const completed = await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.pagesDiscovered).toBeGreaterThanOrEqual(4);
    expect(completed.pagesCrawled).toBe(4);
    expect(completed.pagesSucceeded).toBe(4);
    expect(completed.pagesFailed).toBe(0);
    expect(completed.startedAt).not.toBeNull();
    expect(completed.finishedAt).not.toBeNull();

    const pages = await prisma.page.findMany({ where: { projectId: project.id }, orderBy: { normalizedUrl: 'asc' } });
    expect(pages).toHaveLength(4);
    expect(pages.some((page) => page.normalizedUrl.includes('external.test'))).toBe(false);

    const snapshots = await prisma.pageSnapshot.findMany({
      where: { crawlRunId: run.id },
      include: { page: true, httpResult: true }
    });
    expect(snapshots).toHaveLength(4);

    const about = snapshots.find((snapshot) => snapshot.page.path === '/about');
    expect(about?.title).toBe('About');
    expect(about?.canonicalUrl).toBe(`${baseUrl}/about`);
    expect(about?.indexable).toBe(true);

    const redirected = snapshots.find((snapshot) => snapshot.page.path === '/redirect');
    expect(redirected?.finalUrl).toBe(`${baseUrl}/about`);
    expect(redirected?.httpResult?.redirectChain).toEqual([
      { from: `${baseUrl}/redirect`, to: `${baseUrl}/about`, statusCode: 301 }
    ]);

    const missing = snapshots.find((snapshot) => snapshot.page.path === '/missing');
    expect(missing?.statusCode).toBe(404);
    expect(missing?.indexable).toBe(false);

    expect(await prisma.robotsResult.count({ where: { crawlRunId: run.id } })).toBe(1);
    expect(await prisma.sitemapSource.count({ where: { crawlRunId: run.id } })).toBe(1);
    expect(await prisma.sitemapUrl.count()).toBe(4);
  });

  it('persists a transport failure without inventing an HTTP status or indexability fact', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Timeout Site',
        slug: `timeout-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });
    const run = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'QUEUED',
        seedUrl: 'https://example.com/',
        maxPages: 5,
        crawlerVersion: '0.1.0'
      }
    });

    const fetcher = async (url: string, _options?: FetchOptions): Promise<FetchResult> => {
      if (url.endsWith('/robots.txt')) {
        return factualResult(url, {
          statusCode: 404,
          headers: { 'content-type': 'text/plain' },
          contentType: 'text/plain',
          body: 'not found',
          bytes: 9
        });
      }
      if (url.endsWith('/sitemap.xml')) {
        return factualResult(url, { statusCode: 404 });
      }
      return factualResult(url, {
        statusCode: 0,
        errorCode: 'TIMEOUT',
        responseTimeMs: 15000
      });
    };

    await executeCrawlRun(run.id, {
      fetcher,
      publicTargetGuard: async () => undefined,
      browserEnabled: false,
      concurrency: 1
    });

    const completed = await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.pagesCrawled).toBe(1);
    expect(completed.pagesSucceeded).toBe(0);
    expect(completed.pagesFailed).toBe(1);

    const snapshot = await prisma.pageSnapshot.findFirstOrThrow({
      where: { crawlRunId: run.id },
      include: { httpResult: true }
    });
    expect(snapshot.statusCode).toBeNull();
    expect(snapshot.indexable).toBeNull();
    expect(snapshot.httpResult?.statusCode).toBeNull();
    expect(snapshot.httpResult?.fetchError).toBe('TIMEOUT');
  });
});
