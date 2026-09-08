import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

type AuthFixture = Awaited<ReturnType<typeof seedAuthenticatedUser>>;

function csrfFor(fixture: AuthFixture): string {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

function appWithQualityService(enqueueRun = vi.fn()) {
  return {
    app: createApp({ contentQualityService: { enqueueRun } }),
    enqueueRun,
  };
}

async function createFinding(projectId: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: `https://quality-${suffix}.example.com/`,
      crawlerVersion: 'test',
    },
  });
  const page = await prisma.page.create({
    data: {
      projectId,
      url: `https://quality-${suffix}.example.com/page`,
      normalizedUrl: `https://quality-${suffix}.example.com/page`,
      host: `quality-${suffix}.example.com`,
      path: '/page',
    },
  });
  const snapshot = await prisma.pageSnapshot.create({
    data: {
      pageId: page.id,
      crawlRunId: crawl.id,
      finalUrl: page.url,
      statusCode: 200,
      contentHash: `quality-${suffix}`,
      parserVersion: 'test',
    },
  });
  const document = await prisma.contentDocument.create({
    data: {
      projectId,
      pageId: page.id,
      latestPageSnapshotId: snapshot.id,
      canonicalUrl: page.normalizedUrl,
      schemaTypes: [],
      contentHash: `quality-${suffix}`,
      extractedAt: new Date(),
    },
  });
  return prisma.contentQualityFinding.create({
    data: {
      projectId,
      contentDocumentId: document.id,
      findingKey: 'CONTENT_INTERNAL_LINK_SUPPORT',
      ruleVersion: 1,
      category: 'INTERNAL_LINK_SUPPORT',
      priority: 'MEDIUM',
      summary: 'Add owned-site internal-link support after review.',
      evidence: { status: 'FAIL', sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: snapshot.id }] },
      firstDetectedAt: new Date(),
      lastDetectedAt: new Date(),
    },
  });
}

describe('P13-A content quality API', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('requires authentication before manual analysis service invocation', async () => {
    const { app, enqueueRun } = appWithQualityService();

    const response = await request(app)
      .post('/api/v1/projects/00000000-0000-4000-8000-000000000001/content-quality/runs')
      .send({})
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it('checks CSRF before project membership or manual analysis service invocation', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'REVOKED',
    });
    cleanups.push(fixture.cleanup);
    const { app, enqueueRun } = appWithQualityService();

    const response = await request(app)
      .post(`/api/v1/projects/${fixture.project.id}/content-quality/runs`)
      .set('Cookie', fixture.sessionCookie)
      .send({})
      .expect(403);

    expect(response.body.error.code).toBe('CSRF_INVALID');
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it('requires CONTENT_WRITE and rejects a viewer before calling manual analysis', async () => {
    const operator = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const viewer = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanups.push(operator.cleanup, viewer.cleanup);
    await prisma.projectMembership.create({
      data: {
        projectId: operator.project.id,
        userId: viewer.user.id,
        role: 'VIEWER',
        status: 'ACTIVE',
      },
    });
    const { app, enqueueRun } = appWithQualityService();

    const response = await request(app)
      .post(`/api/v1/projects/${operator.project.id}/content-quality/runs`)
      .set('Cookie', viewer.sessionCookie)
      .set('X-CSRF-Token', csrfFor(viewer))
      .send({})
      .expect(403);

    expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it('passes only the authenticated actor and project to the manual analysis service', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanups.push(fixture.cleanup);
    const enqueueRun = vi.fn().mockResolvedValue({
      jobId: 'content-quality-project',
      runId: '00000000-0000-4000-8000-000000000111',
      deduplicated: false,
    });
    const { app } = appWithQualityService(enqueueRun);

    const response = await request(app)
      .post(`/api/v1/projects/${fixture.project.id}/content-quality/runs`)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrfFor(fixture))
      .send({})
      .expect(202);

    expect(response.body.data).toEqual({
      jobId: 'content-quality-project',
      runId: '00000000-0000-4000-8000-000000000111',
      deduplicated: false,
    });
    expect(enqueueRun).toHaveBeenCalledWith(fixture.project.id, fixture.user.id);
  });

  it('strictly validates mutation bodies before manual analysis service invocation', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanups.push(fixture.cleanup);
    const { app, enqueueRun } = appWithQualityService();

    const response = await request(app)
      .post(`/api/v1/projects/${fixture.project.id}/content-quality/runs`)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrfFor(fixture))
      .send({ actorId: 'forged-user-id' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it('lets a viewer list project-scoped findings through PROJECT_READ', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanups.push(fixture.cleanup);
    const finding = await createFinding(fixture.project.id);

    const response = await request(createApp())
      .get(`/api/v1/projects/${fixture.project.id}/content-quality/findings?status=OPEN`)
      .set('Cookie', fixture.sessionCookie)
      .expect(200);

    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: finding.id, status: 'OPEN' }),
    ]));
  });

  it('returns 404 when a finding belongs to a different project', async () => {
    const operator = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const foreign = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanups.push(operator.cleanup, foreign.cleanup);
    const finding = await createFinding(foreign.project.id);

    const response = await request(createApp())
      .post(`/api/v1/projects/${operator.project.id}/content-quality/findings/${finding.id}/accept`)
      .set('Cookie', operator.sessionCookie)
      .set('X-CSRF-Token', csrfFor(operator))
      .send({})
      .expect(404);

    expect(response.body.error.code).toBe('CONTENT_QUALITY_FINDING_NOT_FOUND');
    expect(await prisma.publicationProposal.count({ where: { p13aFindingHandoffKey: finding.id } })).toBe(0);
  });

  it('strictly validates transition status and reason before changing a finding', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanups.push(fixture.cleanup);
    const finding = await createFinding(fixture.project.id);

    const response = await request(createApp())
      .post(`/api/v1/projects/${fixture.project.id}/content-quality/findings/${finding.id}/transition`)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrfFor(fixture))
      .send({ status: 'ACCEPTED', reason: 'forged workflow transition' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect((await prisma.contentQualityFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe('OPEN');
  });

  it('transitions a finding with the authenticated actor and auditable reason', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanups.push(fixture.cleanup);
    const finding = await createFinding(fixture.project.id);

    const response = await request(createApp())
      .post(`/api/v1/projects/${fixture.project.id}/content-quality/findings/${finding.id}/transition`)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrfFor(fixture))
      .send({ status: 'IN_REVIEW', reason: 'Editorial review is scheduled.' })
      .expect(200);

    expect(response.body.data).toMatchObject({ id: finding.id, status: 'IN_REVIEW' });
    expect(await prisma.contentQualityFindingHistory.findFirst({
      where: { findingId: finding.id, toStatus: 'IN_REVIEW', actorId: fixture.user.id },
    })).toMatchObject({ reason: 'Editorial review is scheduled.' });
  });

  it('accepts idempotently and returns only a proposal reference', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanups.push(fixture.cleanup);
    const finding = await createFinding(fixture.project.id);
    const api = `/api/v1/projects/${fixture.project.id}/content-quality/findings/${finding.id}/accept`;

    await request(createApp())
      .post(api)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrfFor(fixture))
      .send({})
      .expect(409);

    await request(createApp())
      .post(`/api/v1/projects/${fixture.project.id}/content-quality/findings/${finding.id}/transition`)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrfFor(fixture))
      .send({ status: 'IN_REVIEW', reason: 'Reviewed before proposal handoff.' })
      .expect(200);

    const first = await request(createApp())
      .post(api)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrfFor(fixture))
      .send({})
      .expect(201);
    const second = await request(createApp())
      .post(api)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrfFor(fixture))
      .send({})
      .expect(201);

    expect(first.body.data).toMatchObject({ proposalId: expect.any(String) });
    expect(Object.keys(first.body.data)).toEqual(['proposalId']);
    expect(second.body.data).toEqual(first.body.data);
    expect(await prisma.publicationProposal.count({ where: { p13aFindingHandoffKey: finding.id } })).toBe(1);
  });
});
