import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>): string {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

function appWithDiscoveryService(input: {
  list?: ReturnType<typeof vi.fn>;
  refresh?: ReturnType<typeof vi.fn>;
  accept?: ReturnType<typeof vi.fn>;
  reject?: ReturnType<typeof vi.fn>;
}) {
  return createApp({
    keywordDiscoveryService: {
      list: input.list ?? vi.fn().mockResolvedValue([]),
      refresh: input.refresh ?? vi.fn().mockResolvedValue({ created: 0, updated: 0, preserved: 0 }),
      accept: input.accept ?? vi.fn().mockResolvedValue({ id: 'keyword-1' }),
      reject: input.reject ?? vi.fn().mockResolvedValue({ id: 'candidate-1', status: 'REJECTED' }),
    },
  } as unknown as Parameters<typeof createApp>[0]);
}

async function createCandidate(projectId: string, query: string) {
  return prisma.keywordDiscoveryCandidate.create({
    data: {
      projectId,
      normalizedQuery: query,
      representativeText: query,
      firstObservedAt: new Date('2026-08-29T00:00:00.000Z'),
      lastObservedAt: new Date('2026-08-29T00:00:00.000Z'),
    },
  });
}

describe('P11-02B keyword discovery API', () => {
  it('requires authentication for discovery reads', async () => {
    const response = await request(createApp())
      .get('/api/v1/projects/00000000-0000-4000-8000-000000000111/keyword-discoveries')
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('lets VIEWER read persisted discoveries without provider/network work or writes', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const list = vi.fn().mockResolvedValue([
      {
        candidateId: 'candidate-1',
        normalizedQuery: '六壬符纸怎么用',
        representativeText: '六壬符纸怎么用',
        trackedKeywordId: null,
        status: 'PENDING',
        firstObservedAt: '2026-08-29',
        lastObservedAt: '2026-08-29',
        providers: [],
      },
    ]);
    const fetchSpy = vi.fn(async () => {
      throw new Error('provider network is forbidden on discovery GET');
    });
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const response = await request(appWithDiscoveryService({ list }))
        .get(`/api/v1/projects/${fixture.project.id}/keyword-discoveries`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ normalizedQuery: '六壬符纸怎么用', status: 'PENDING' }),
      ]));
      expect(list).toHaveBeenCalledWith({ projectId: fixture.project.id });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toMatch(
        /accessToken|refreshToken|apiKey|authorization|rawProviderError/i,
      );
    } finally {
      vi.unstubAllGlobals();
      await fixture.cleanup();
    }
  });

  it('requires CSRF before refresh mutation', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'ADMIN',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const refresh = vi.fn().mockResolvedValue({ created: 1, updated: 0, preserved: 0 });

    try {
      const response = await request(appWithDiscoveryService({ refresh }))
        .post(`/api/v1/projects/${fixture.project.id}/keyword-discoveries/refresh`)
        .set('Cookie', fixture.sessionCookie)
        .send({ dateFrom: '2026-08-29', dateTo: '2026-08-29' })
        .expect(403);

      expect(response.body.error.code).toBe('CSRF_INVALID');
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires CONTENT_WRITE for refresh even when CSRF is valid', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const refresh = vi.fn().mockResolvedValue({ created: 1, updated: 0, preserved: 0 });

    try {
      const response = await request(appWithDiscoveryService({ refresh }))
        .post(`/api/v1/projects/${fixture.project.id}/keyword-discoveries/refresh`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({ dateFrom: '2026-08-29', dateTo: '2026-08-29' })
        .expect(403);

      expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it('passes a bounded refresh command to the injected discovery service', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'ADMIN',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const refresh = vi.fn().mockResolvedValue({ created: 2, updated: 1, preserved: 3 });

    try {
      const response = await request(appWithDiscoveryService({ refresh }))
        .post(`/api/v1/projects/${fixture.project.id}/keyword-discoveries/refresh`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({ dateFrom: '2026-08-28', dateTo: '2026-08-29' })
        .expect(200);

      expect(response.body.data).toEqual({ created: 2, updated: 1, preserved: 3 });
      expect(refresh).toHaveBeenCalledWith({
        projectId: fixture.project.id,
        dateFrom: '2026-08-28',
        dateTo: '2026-08-29',
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires explicit keyword type on accept and CONTENT_WRITE + CSRF', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'ADMIN',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const accept = vi.fn().mockResolvedValue({ id: 'keyword-1', source: 'SEARCH_DISCOVERY_ACCEPTED' });
    const candidate = await createCandidate(fixture.project.id, '六壬符纸怎么用');

    try {
      const missingType = await request(appWithDiscoveryService({ accept }))
        .post(`/api/v1/projects/${fixture.project.id}/keyword-discoveries/${candidate.id}/accept`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({})
        .expect(400);
      expect(missingType.body.error.code).toBe('VALIDATION_ERROR');
      expect(accept).not.toHaveBeenCalled();

      const accepted = await request(appWithDiscoveryService({ accept }))
        .post(`/api/v1/projects/${fixture.project.id}/keyword-discoveries/${candidate.id}/accept`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({
          type: 'LONG_TAIL',
          intent: 'UNKNOWN',
          priority: 'MEDIUM',
          language: 'zh-Hant',
          targetCountry: 'HK',
        })
        .expect(200);

      expect(accepted.body.data).toEqual({ id: 'keyword-1', source: 'SEARCH_DISCOVERY_ACCEPTED' });
      expect(accept).toHaveBeenCalledWith({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        candidateId: candidate.id,
        type: 'LONG_TAIL',
        intent: 'UNKNOWN',
        priority: 'MEDIUM',
        language: 'zh-Hant',
        targetCountry: 'HK',
      });
    } finally {
      await prisma.keywordDiscoveryCandidate.deleteMany({ where: { id: candidate.id } });
      await fixture.cleanup();
    }
  });

  it('accepts and rejects only through CONTENT_WRITE mutation guards', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const candidateId = '00000000-0000-4000-8000-000000000222';
    const accept = vi.fn().mockResolvedValue({ id: 'keyword-1' });
    const reject = vi.fn().mockResolvedValue({ id: candidateId, status: 'REJECTED' });

    try {
      const csrf = csrfFor(fixture);
      const acceptResponse = await request(appWithDiscoveryService({ accept }))
        .post(`/api/v1/projects/${fixture.project.id}/keyword-discoveries/${candidateId}/accept`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ type: 'LONG_TAIL' })
        .expect(403);
      expect(acceptResponse.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
      expect(accept).not.toHaveBeenCalled();

      const rejectResponse = await request(appWithDiscoveryService({ reject }))
        .post(`/api/v1/projects/${fixture.project.id}/keyword-discoveries/${candidateId}/reject`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({})
        .expect(403);
      expect(rejectResponse.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
      expect(reject).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it('passes actor/project/candidate to reject and returns the decision result', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'ADMIN',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const candidateId = '00000000-0000-4000-8000-000000000223';
    const reject = vi.fn().mockResolvedValue({ id: candidateId, status: 'REJECTED' });

    try {
      const response = await request(appWithDiscoveryService({ reject }))
        .post(`/api/v1/projects/${fixture.project.id}/keyword-discoveries/${candidateId}/reject`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({})
        .expect(200);

      expect(response.body.data).toEqual({ id: candidateId, status: 'REJECTED' });
      expect(reject).toHaveBeenCalledWith({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        candidateId,
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
