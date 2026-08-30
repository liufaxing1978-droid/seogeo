import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('P11-02B production Bing sync composition', () => {
  it('uses the configured Bing adapter and source repository from the default app composition', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'ADMIN',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const propertyRef = `https://${fixture.project.primaryDomain}/`;
    const query = '六壬符纸怎么用';
    const sourceDate = '2026-08-29';
    const sourceDateMs = new Date(`${sourceDate}T00:00:00.000Z`).getTime();
    const binding = await prisma.searchProviderLaneBinding.create({
      data: {
        projectId: fixture.project.id,
        provider: 'BING_WEBMASTER',
        propertyRef,
        marketCode: 'HK',
        locale: 'zh-Hant',
      },
    });

    const mutableEnv = env as typeof env & { BING_WEBMASTER_API_KEY?: string };
    const originalApiKey = mutableEnv.BING_WEBMASTER_API_KEY;
    mutableEnv.BING_WEBMASTER_API_KEY = 'test-only-bing-api-key';

    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const rawUrl = input instanceof Request ? input.url : String(input);
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/GetUserSites')) {
        return new Response(JSON.stringify({
          d: [{ IsVerified: true, Url: propertyRef }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname.endsWith('/GetQueryStats')) {
        return new Response(JSON.stringify({
          d: [{
            AvgClickPosition: 6.5,
            AvgImpressionPosition: 7.25,
            Clicks: 3,
            Date: `/Date(${sourceDateMs})/`,
            Impressions: 30,
            Query: query,
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected Bing test request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const response = await request(createApp())
        .post(`/api/v1/projects/${fixture.project.id}/search-sync`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({
          bindingId: binding.id,
          dateFrom: sourceDate,
          dateTo: sourceDate,
        })
        .expect(200);

      expect(response.body.data).toMatchObject({
        provider: 'BING_WEBMASTER',
        state: 'COMPLETED',
        dateFrom: sourceDate,
        dateTo: sourceDate,
        discoveryState: 'REFRESHED',
        reason: null,
      });
      expect(response.body.data.sourceRefs).toHaveLength(1);
      expect(response.body.data.searchFactSnapshotIds).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      expect(await prisma.searchProviderObservationBatch.count({
        where: {
          projectId: fixture.project.id,
          provider: 'BING_WEBMASTER',
          propertyRef,
        },
      })).toBe(1);
      expect(await prisma.searchFactSnapshot.count({
        where: {
          projectId: fixture.project.id,
          provider: 'BING_WEBMASTER',
          propertyRef,
          status: 'COMPLETED',
        },
      })).toBe(1);
      expect(await prisma.keywordDiscoveryCandidate.findFirst({
        where: {
          projectId: fixture.project.id,
          normalizedQuery: query,
          status: 'PENDING',
        },
      })).not.toBeNull();
    } finally {
      if (originalApiKey === undefined) {
        delete mutableEnv.BING_WEBMASTER_API_KEY;
      } else {
        mutableEnv.BING_WEBMASTER_API_KEY = originalApiKey;
      }
      await prisma.keywordDiscoveryCandidate.deleteMany({ where: { projectId: fixture.project.id } });
      await prisma.searchFactSnapshot.deleteMany({ where: { projectId: fixture.project.id } });
      await prisma.searchProviderObservationBatch.deleteMany({ where: { projectId: fixture.project.id } });
      await prisma.searchProviderLaneBinding.deleteMany({ where: { projectId: fixture.project.id } });
      await fixture.cleanup();
    }
  });
});
