import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/core/errors.js';
import { KeywordService } from '../../src/modules/keywords/keyword.service.js';
import type {
  KeywordSearchEvidenceResult,
  KeywordSearchEvidenceService,
} from '../../src/modules/keywords/keyword-search-evidence.service.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixedResult: KeywordSearchEvidenceResult = {
  keyword: {
    id: '00000000-0000-0000-0000-000000000111',
    text: '符纸',
    normalizedMatchText: '符纸',
  },
  dateFrom: '2026-08-01',
  dateTo: '2026-08-28',
  evidence: [],
};

function appWithSearchEvidenceService(service: Pick<KeywordSearchEvidenceService, 'evaluateKeyword'>) {
  return createApp({ keywordSearchEvidenceService: service } as unknown as Parameters<typeof createApp>[0]);
}

async function createKeyword(projectId: string, actorUserId: string, text = '符纸') {
  return new KeywordService().createManual({
    actorUserId,
    projectId,
    text,
    type: 'CORE',
  });
}

describe('P11-02A keyword search-evidence JSON API', () => {
  it('lets a VIEWER read without CSRF and passes typed filters to the read service', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const keyword = await createKeyword(fixture.project.id, fixture.user.id);
    const evaluateKeyword = vi.fn(async () => ({
      ...fixedResult,
      keyword: { ...fixedResult.keyword, id: keyword.id },
    }));

    try {
      const response = await request(appWithSearchEvidenceService({ evaluateKeyword }))
        .get(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.id}/search-evidence`)
        .query({
          from: '2026-08-01',
          to: '2026-08-28',
          provider: 'GOOGLE_SEARCH_CONSOLE',
          marketCode: 'GLOBAL',
          locale: 'zh-CN',
          propertyRef: `sc-domain:${fixture.project.primaryDomain}`,
        })
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.body.data).toEqual(expect.objectContaining({
        keyword: expect.objectContaining({ id: keyword.id, text: '符纸' }),
        dateFrom: '2026-08-01',
        dateTo: '2026-08-28',
      }));
      expect(evaluateKeyword).toHaveBeenCalledTimes(1);
      expect(evaluateKeyword).toHaveBeenCalledWith(
        fixture.project.id,
        keyword.id,
        {
          from: '2026-08-01',
          to: '2026-08-28',
          provider: 'GOOGLE_SEARCH_CONSOLE',
          marketCode: 'GLOBAL',
          locale: 'zh-CN',
          propertyRef: `sc-domain:${fixture.project.primaryDomain}`,
        },
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects anonymous reads before invoking the service', async () => {
    const evaluateKeyword = vi.fn(async () => fixedResult);

    const response = await request(appWithSearchEvidenceService({ evaluateKeyword }))
      .get('/api/v1/projects/00000000-0000-0000-0000-000000000001/keywords/00000000-0000-0000-0000-000000000002/search-evidence')
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(evaluateKeyword).not.toHaveBeenCalled();
  });

  it('fails closed for an authenticated non-member before invoking the service', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const foreignProject = await prisma.project.create({
      data: {
        name: `Foreign search evidence ${suffix}`,
        slug: `foreign-search-evidence-${suffix}`,
        primaryDomain: `foreign-search-evidence-${suffix}.example.com`,
        planLevel: 'ENTERPRISE',
      },
    });
    const evaluateKeyword = vi.fn(async () => fixedResult);

    try {
      const response = await request(appWithSearchEvidenceService({ evaluateKeyword }))
        .get(`/api/v1/projects/${foreignProject.id}/keywords/00000000-0000-0000-0000-000000000002/search-evidence`)
        .set('Cookie', fixture.sessionCookie)
        .expect(404);

      expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
      expect(evaluateKeyword).not.toHaveBeenCalled();
    } finally {
      await prisma.project.delete({ where: { id: foreignProject.id } }).catch(() => undefined);
      await fixture.cleanup();
    }
  });

  it('propagates foreign keyword fail-closed semantics as KEYWORD_NOT_FOUND', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const evaluateKeyword = vi.fn(async () => {
      throw new AppError('Keyword not found', 404, 'KEYWORD_NOT_FOUND');
    });

    try {
      const response = await request(appWithSearchEvidenceService({ evaluateKeyword }))
        .get(`/api/v1/projects/${fixture.project.id}/keywords/00000000-0000-0000-0000-000000000999/search-evidence`)
        .set('Cookie', fixture.sessionCookie)
        .expect(404);

      expect(response.body.error.code).toBe('KEYWORD_NOT_FOUND');
      expect(evaluateKeyword).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('returns stable 400 codes for invalid filters and ranges', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const keyword = await createKeyword(fixture.project.id, fixture.user.id);

    try {
      for (const query of [
        { provider: 'NOT_A_PROVIDER' },
        { marketCode: 'NOT_A_MARKET' },
        { locale: '   ' },
        { propertyRef: '   ' },
      ]) {
        const response = await request(createApp())
          .get(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.id}/search-evidence`)
          .query(query)
          .set('Cookie', fixture.sessionCookie)
          .expect(400);
        expect(response.body.error.code).toBe('KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID');
      }

      for (const query of [
        { from: '2026-08-29', to: '2026-08-28' },
        { from: '2026-05-01', to: '2026-08-28' },
        { from: '2026-02-30', to: '2026-08-28' },
      ]) {
        const response = await request(createApp())
          .get(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.id}/search-evidence`)
          .query(query)
          .set('Cookie', fixture.sessionCookie)
          .expect(400);
        expect(response.body.error.code).toBe('KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID');
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
