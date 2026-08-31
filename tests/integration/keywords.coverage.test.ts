import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const foreignProjectIds: string[] = [];

afterEach(async () => {
  while (foreignProjectIds.length > 0) {
    const id = foreignProjectIds.pop();
    if (id) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  }
});

async function seedStrongCoverage(
  fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>,
) {
  const keyword = await keywordService.createManual({
    actorUserId: fixture.user.id,
    projectId: fixture.project.id,
    text: '符纸',
    type: 'CORE',
    priority: 'HIGH',
  });

  const crawlRun = await prisma.crawlRun.create({
    data: {
      projectId: fixture.project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: `https://${fixture.project.primaryDomain}`,
      crawlerVersion: 'keyword-coverage-test',
    },
  });
  const page = await prisma.page.create({
    data: {
      projectId: fixture.project.id,
      url: `https://${fixture.project.primaryDomain}/culture/fuzhi`,
      normalizedUrl: `https://${fixture.project.primaryDomain}/culture/fuzhi`,
      host: fixture.project.primaryDomain,
      path: '/culture/fuzhi',
    },
  });
  await prisma.pageSnapshot.create({
    data: {
      pageId: page.id,
      crawlRunId: crawlRun.id,
      finalUrl: page.url,
      statusCode: 200,
      title: '符纸：传统用途与文化',
      h1: '符纸文化',
      metaDescription: '介绍符纸的历史来源',
      indexable: true,
      parserVersion: 'keyword-coverage-test',
    },
  });

  return keyword;
}

describe('P11-01 keyword persisted coverage read API', () => {
  it('returns STRONG from persisted page facts without crawl or AI side effects', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const keyword = await seedStrongCoverage(fixture);
      const crawlSpy = vi.fn();
      const aiSpy = vi.fn();
      const app = createApp({
        crawlService: { enqueue: crawlSpy } as never,
        aiTaskService: { createAndEnqueue: aiSpy } as never,
      });

      const response = await request(app)
        .get(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.id}/coverage`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.body.data.status).toBe('STRONG');
      expect(response.body.data.reason).toBe('MATCHED');
      expect(response.body.data.matches[0]).toMatchObject({
        pageId: expect.any(String),
        titleMatch: true,
        score: expect.any(Number),
      });
      expect(crawlSpy).not.toHaveBeenCalled();
      expect(aiSpy).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it('returns UNKNOWN when no usable persisted snapshot exists', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const keyword = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '六壬符纸',
        type: 'LONG_TAIL',
      });
      const page = await prisma.page.create({
        data: {
          projectId: fixture.project.id,
          url: `https://${fixture.project.primaryDomain}/empty`,
          normalizedUrl: `https://${fixture.project.primaryDomain}/empty`,
          host: fixture.project.primaryDomain,
          path: '/empty',
        },
      });
      expect(page.isActive).toBe(true);

      const response = await request(createApp())
        .get(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.id}/coverage`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.body.data).toEqual({
        status: 'UNKNOWN',
        reason: 'NO_USABLE_SNAPSHOT_EVIDENCE',
        matches: [],
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('returns 404 for a keyword that belongs to another project', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const foreignProject = await prisma.project.create({
      data: {
        name: `Foreign coverage project ${suffix}`,
        slug: `foreign-coverage-${suffix}`,
        primaryDomain: `foreign-coverage-${suffix}.example.com`,
        planLevel: 'ENTERPRISE',
      },
    });
    foreignProjectIds.push(foreignProject.id);

    try {
      const foreignKeyword = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: foreignProject.id,
        text: '符纸',
        type: 'CORE',
      });

      const response = await request(createApp())
        .get(`/api/v1/projects/${fixture.project.id}/keywords/${foreignKeyword.id}/coverage`)
        .set('Cookie', fixture.sessionCookie)
        .expect(404);

      expect(response.body.error.code).toBe('KEYWORD_NOT_FOUND');
    } finally {
      await fixture.cleanup();
    }
  });
});
