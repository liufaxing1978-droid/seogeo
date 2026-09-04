import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { IndexNowSubmissionService } from '../../src/modules/indexnow/indexnow.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(env.SESSION_SECRET, fixture.csrfInput.sessionId, fixture.csrfInput.tokenHash);
}

function appWithSubmissionService() {
  const service = new IndexNowSubmissionService({ enqueue: async () => undefined });
  return createApp({ indexNowSubmissionService: service } as unknown as Parameters<typeof createApp>[0]);
}

describe('P9 IndexNow submission API', () => {
  it('requires authentication before project-scoped reads', async () => {
    const response = await request(createApp())
      .get('/api/projects/00000000-0000-0000-0000-000000000001/indexnow-submissions')
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('allows VIEWER reads but denies batch creation', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE'
    });
    try {
      const app = appWithSubmissionService();
      const read = await request(app)
        .get(`/api/projects/${fixture.project.id}/indexnow-submissions`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);
      expect(read.body.data).toEqual([]);

      const denied = await request(app)
        .post(`/api/projects/${fixture.project.id}/indexnow-submissions`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({ urls: [`https://${fixture.project.primaryDomain}/guide`] })
        .expect(403);
      expect(denied.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    } finally { await fixture.cleanup(); }
  });

  it('requires CSRF and creates only an eligible batch for an OPERATOR project', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE'
    });
    try {
      const url = `https://${fixture.project.primaryDomain}/guide`;
      await prisma.page.create({
        data: {
          projectId: fixture.project.id,
          url,
          normalizedUrl: url,
          host: fixture.project.primaryDomain,
          path: '/guide'
        }
      });
      const app = appWithSubmissionService();
      const endpoint = `/api/projects/${fixture.project.id}/indexnow-submissions`;

      const csrfDenied = await request(app)
        .post(endpoint)
        .set('Cookie', fixture.sessionCookie)
        .send({ urls: [url] })
        .expect(403);
      expect(csrfDenied.body.error.code).toBe('CSRF_INVALID');

      const created = await request(app)
        .post(endpoint)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({ urls: [url] })
        .expect(202);
      expect(created.body.data).toMatchObject({
        projectId: fixture.project.id,
        status: 'QUEUED',
        urls: [expect.objectContaining({ url, status: 'QUEUED' })]
      });

      const listed = await request(app)
        .get(endpoint)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);
      expect(listed.body.data).toEqual([
        expect.objectContaining({ id: created.body.data.id, status: 'QUEUED' })
      ]);
      expect(JSON.stringify(listed.body)).not.toMatch(/INDEXNOW_KEY|keyLocation|authorization/i);
      expect(created.body.data).not.toHaveProperty('createdByUserId');
      expect(created.body.data).not.toHaveProperty('requestFingerprint');
    } finally { await fixture.cleanup(); }
  });

  it('does not expose a foreign project submission history', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE'
    });
    const suffix = randomUUID();
    const foreignProject = await prisma.project.create({
      data: { name: 'P9 foreign', slug: `p9-indexnow-foreign-${suffix}`, primaryDomain: `${suffix}.example.com` }
    });
    try {
      await prisma.indexNowSubmissionBatch.create({
        data: { projectId: foreignProject.id, requestFingerprint: `foreign-${suffix}`, status: 'QUEUED' }
      });
      const response = await request(appWithSubmissionService())
        .get(`/api/projects/${foreignProject.id}/indexnow-submissions`)
        .set('Cookie', fixture.sessionCookie)
        .expect(404);
      expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
    } finally {
      await prisma.project.delete({ where: { id: foreignProject.id } });
      await fixture.cleanup();
    }
  });

  it('returns the latest persisted crawler-health snapshot without starting work', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE'
    });
    try {
      const crawlRun = await prisma.crawlRun.create({
        data: {
          projectId: fixture.project.id,
          runType: 'MANUAL',
          status: 'COMPLETED',
          seedUrl: `https://${fixture.project.primaryDomain}/`,
          crawlerVersion: 'p9-api'
        }
      });
      await prisma.crawlerHealthSnapshot.create({
        data: {
          projectId: fixture.project.id,
          crawlRunId: crawlRun.id,
          status: 'DEGRADED',
          calculationVersion: 'P9_CRAWLER_HEALTH_V1',
          factsSnapshot: { pagesFailed: 1 }
        }
      });

      const response = await request(createApp())
        .get(`/api/projects/${fixture.project.id}/crawler-health/latest`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);
      expect(response.body.data).toMatchObject({
        projectId: fixture.project.id,
        crawlRunId: crawlRun.id,
        status: 'DEGRADED',
        calculationVersion: 'P9_CRAWLER_HEALTH_V1'
      });
      expect(response.body.data).not.toHaveProperty('factsSnapshot');
    } finally { await fixture.cleanup(); }
  });

  it('allows an OPERATOR to retry only a failed project-local batch with CSRF', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE'
    });
    try {
      const batch = await prisma.indexNowSubmissionBatch.create({
        data: {
          projectId: fixture.project.id,
          requestFingerprint: `retry-api-${randomUUID()}`,
          status: 'FAILED',
          attemptCount: 3,
          errorCode: 'INDEXNOW_RETRY_EXHAUSTED',
          urls: { create: { url: `https://${fixture.project.primaryDomain}/guide`, status: 'FAILED' } }
        }
      });
      const response = await request(appWithSubmissionService())
        .post(`/api/projects/${fixture.project.id}/indexnow-submissions/${batch.id}/retry`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .expect(202);

      expect(response.body.data).toMatchObject({
        id: batch.id,
        status: 'QUEUED',
        attemptCount: 3,
        errorCode: null,
        urls: [expect.objectContaining({ status: 'QUEUED' })]
      });
    } finally { await fixture.cleanup(); }
  });
});
