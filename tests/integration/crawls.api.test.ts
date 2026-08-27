import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { createApp } from '../../src/app.js';
import { CrawlRepository } from '../../src/modules/crawler/crawl.repository.js';
import { CrawlService, type CrawlJobQueue } from '../../src/modules/crawler/crawl.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

class FakeCrawlQueue implements CrawlJobQueue {
  readonly calls: Array<{
    name: string;
    data: { crawlRunId: string };
    options: { jobId: string };
  }> = [];

  async add(name: string, data: { crawlRunId: string }, options: { jobId: string }) {
    this.calls.push({ name, data, options });
    return { id: options.jobId };
  }
}

function testApp(queue = new FakeCrawlQueue()) {
  const service = new CrawlService(new CrawlRepository(prisma), queue);
  return { app: createApp({ crawlService: service }), queue };
}

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];

async function createProject(domain = 'example.com') {
  const fixture = await seedAuthenticatedUser({
    role: 'OWNER',
    planLevel: 'ADVANCED',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
  fixtures.push(fixture);
  const project = await prisma.project.update({
    where: { id: fixture.project.id },
    data: { primaryDomain: domain },
  });
  const csrfToken = deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
  return { project, sessionCookie: fixture.sessionCookie, csrfToken };
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await fixture.cleanup();
});

describe('crawl REST API', () => {
  it('creates a queued crawl and enqueues one idempotent job', async () => {
    const { project, sessionCookie, csrfToken } = await createProject();
    const { app, queue } = testApp();

    const response = await request(app)
      .post(`/api/projects/${project.id}/crawls`)
      .set('Cookie', sessionCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ runType: 'MANUAL', maxPages: 100 })
      .expect(202);

    expect(response.body.status).toBe('QUEUED');
    expect(response.body.id).toEqual(expect.any(String));
    expect(queue.calls).toEqual([
      {
        name: 'crawl',
        data: { crawlRunId: response.body.id },
        options: { jobId: `crawl-${response.body.id}` }
      }
    ]);

    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(run.projectId).toBe(project.id);
    expect(run.seedUrl).toBe('https://example.com/');
    expect(run.maxPages).toBe(100);
  });

  it('rejects an out-of-scope seed URL', async () => {
    const { project, sessionCookie, csrfToken } = await createProject();
    const { app, queue } = testApp();

    const response = await request(app)
      .post(`/api/projects/${project.id}/crawls`)
      .set('Cookie', sessionCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ seedUrl: 'https://evil.example.net/', runType: 'MANUAL' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(queue.calls).toHaveLength(0);
  });

  it('blocks a second active full/manual crawl for the same project', async () => {
    const { project, sessionCookie, csrfToken } = await createProject();
    const { app, queue } = testApp();

    await request(app)
      .post(`/api/projects/${project.id}/crawls`)
      .set('Cookie', sessionCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ runType: 'MANUAL' })
      .expect(202);

    const response = await request(app)
      .post(`/api/projects/${project.id}/crawls`)
      .set('Cookie', sessionCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ runType: 'FULL' })
      .expect(409);

    expect(response.body.error.code).toBe('CRAWL_ALREADY_ACTIVE');
    expect(queue.calls).toHaveLength(1);
  });

  it('lists project crawls with bounded offset pagination', async () => {
    const { project, sessionCookie } = await createProject();
    await prisma.crawlRun.createMany({
      data: [
        {
          projectId: project.id,
          runType: 'MANUAL',
          status: 'COMPLETED',
          seedUrl: 'https://example.com/',
          maxPages: 10,
          crawlerVersion: '0.1.0'
        },
        {
          projectId: project.id,
          runType: 'INCREMENTAL',
          status: 'COMPLETED',
          seedUrl: 'https://example.com/',
          maxPages: 10,
          crawlerVersion: '0.1.0'
        }
      ]
    });
    const { app } = testApp();

    const response = await request(app)
      .get(`/api/projects/${project.id}/crawls?limit=1&offset=0`)
      .set('Cookie', sessionCookie)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toEqual({ limit: 1, offset: 0, total: 2 });

    await request(app)
      .get(`/api/projects/${project.id}/crawls?limit=101`)
      .set('Cookie', sessionCookie)
      .expect(400);
  });

  it('returns crawl detail and page results without raw HTML', async () => {
    const { project, sessionCookie } = await createProject();
    const run = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        maxPages: 10,
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
    await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: run.id,
        finalUrl: page.normalizedUrl,
        statusCode: 200,
        contentType: 'text/html',
        title: 'About',
        h1: 'About',
        indexable: true,
        parserVersion: '0.1.0',
        httpResult: {
          create: {
            requestUrl: page.normalizedUrl,
            finalUrl: page.normalizedUrl,
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            redirectChain: []
          }
        }
      }
    });
    const { app } = testApp();

    const detail = await request(app)
      .get(`/api/crawls/${run.id}`)
      .set('Cookie', sessionCookie)
      .expect(200);
    expect(detail.body.data.id).toBe(run.id);

    const pages = await request(app)
      .get(`/api/crawls/${run.id}/pages`)
      .set('Cookie', sessionCookie)
      .expect(200);
    expect(pages.body.data).toHaveLength(1);
    expect(pages.body.data[0]).toMatchObject({
      pageId: page.id,
      url: page.normalizedUrl,
      statusCode: 200,
      title: 'About',
      indexable: true
    });
    expect(JSON.stringify(pages.body)).not.toContain('<html');
  });

  it('creates a single-page crawl from a known page identity', async () => {
    const { project, sessionCookie, csrfToken } = await createProject();
    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/about',
        normalizedUrl: 'https://example.com/about',
        host: 'example.com',
        path: '/about'
      }
    });
    const { app, queue } = testApp();

    const response = await request(app)
      .post(`/api/pages/${page.id}/crawl`)
      .set('Cookie', sessionCookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(202);

    expect(response.body.status).toBe('QUEUED');
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(run.runType).toBe('SINGLE_PAGE');
    expect(run.maxPages).toBe(1);
    expect(run.seedUrl).toBe(page.normalizedUrl);
    expect(queue.calls.at(-1)?.data.crawlRunId).toBe(run.id);
  });
});
