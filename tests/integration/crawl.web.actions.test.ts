import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { CrawlRepository } from '../../src/modules/crawler/crawl.repository.js';
import { CrawlService, type CrawlJobQueue } from '../../src/modules/crawler/crawl.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

class FakeCrawlQueue implements CrawlJobQueue {
  readonly calls: Array<{ data: { crawlRunId: string } }> = [];

  async add(_name: string, data: { crawlRunId: string }) {
    this.calls.push({ data });
    return { id: data.crawlRunId };
  }
}

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];

async function fixture(role: 'OWNER' | 'VIEWER' = 'OWNER') {
  const seeded = await seedAuthenticatedUser({
    role,
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
  fixtures.push(seeded);
  return seeded;
}

function csrfFor(seeded: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(env.SESSION_SECRET, seeded.csrfInput.sessionId, seeded.csrfInput.tokenHash);
}

afterEach(async () => {
  for (const seeded of fixtures.splice(0).reverse()) await seeded.cleanup();
});

describe('crawler web actions', () => {
  it('requires authentication before exposing crawl history', async () => {
    const seeded = await fixture();
    await request(createApp())
      .get(`/projects/${seeded.project.id}/crawls`)
      .expect(401);
  });

  it('renders a CSRF-protected full crawl form for an authorized operator', async () => {
    const seeded = await fixture();
    const response = await request(createApp())
      .get(`/projects/${seeded.project.id}/crawls`)
      .set('Cookie', seeded.sessionCookie)
      .expect(200);

    expect(response.text).toContain(`action="/projects/${seeded.project.id}/crawls"`);
    expect(response.text).toContain('启动全站抓取');
    expect(response.text).toContain(`value="${csrfFor(seeded)}"`);
  });

  it('does not render a crawl mutation form for a viewer', async () => {
    const seeded = await fixture('VIEWER');
    const response = await request(createApp())
      .get(`/projects/${seeded.project.id}/crawls`)
      .set('Cookie', seeded.sessionCookie)
      .expect(200);

    expect(response.text).not.toContain('启动全站抓取');
  });

  it('starts a manual crawl from the web form and redirects to its detail page', async () => {
    const seeded = await fixture();
    const queue = new FakeCrawlQueue();
    const service = new CrawlService(new CrawlRepository(prisma), queue);
    const response = await request(createApp({ crawlService: service }))
      .post(`/projects/${seeded.project.id}/crawls`)
      .set('Cookie', seeded.sessionCookie)
      .type('form')
      .send({ _csrf: csrfFor(seeded) })
      .expect(303);

    const run = await prisma.crawlRun.findFirstOrThrow({ where: { projectId: seeded.project.id } });
    expect(response.headers.location).toBe(`/crawls/${run.id}`);
    expect(run.runType).toBe('MANUAL');
    expect(queue.calls).toEqual([{ data: { crawlRunId: run.id } }]);
  });

  it('rejects viewer crawl starts even with valid CSRF', async () => {
    const seeded = await fixture('VIEWER');
    await request(createApp())
      .post(`/projects/${seeded.project.id}/crawls`)
      .set('Cookie', seeded.sessionCookie)
      .type('form')
      .send({ _csrf: csrfFor(seeded) })
      .expect(403);
  });
});
