import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import type { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

async function seedPendingSuggestion(
  fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>,
  suggestedText = '六壬符纸',
) {
  const seed = await keywordService.createManual({
    actorUserId: fixture.user.id,
    projectId: fixture.project.id,
    text: `符纸-${randomUUID()}`,
    type: 'CORE',
    intent: 'INFORMATIONAL',
  });
  const task = await prisma.aiTask.create({
    data: {
      projectId: fixture.project.id,
      taskType: 'KEYWORD_EXPANSION',
      requestKey: `keyword-web-suggestion:${randomUUID()}`,
      promptVersion: 'keyword-expansion-v1',
      factSnapshot: { seedKeyword: { id: seed.id, text: seed.text } },
      sourceReferences: [{ type: 'KEYWORD', id: seed.id }],
    },
  });
  const suggestion = await prisma.keywordSuggestion.create({
    data: {
      projectId: fixture.project.id,
      seedKeywordId: seed.id,
      suggestedText,
      normalizedText: suggestedText.normalize('NFKC').trim().toLocaleLowerCase('und'),
      suggestedType: 'LONG_TAIL',
      suggestedIntent: 'INFORMATIONAL',
      rationale: '更窄的相关主题，只能由人工决定是否加入词库',
      status: 'PENDING',
      provider: 'DEEPSEEK',
      model: 'fixture-model',
      aiTaskId: task.id,
    },
  });
  return { seed, task, suggestion };
}

describe('P11-01 keyword center web UI', () => {
  it('renders keyword facts without fabricated ranking', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
        priority: 'HIGH',
        locked: true,
      });

      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('关键词中心');
      expect(response.text).toContain('符纸');
      expect(response.text).toContain('站内内容覆盖');
      expect(response.text).toContain('排名数据：未接入');
      expect(response.text).not.toContain('Google 排名：1');
      expect(response.text).toContain('data-ui="keyword-center"');
    } finally {
      await fixture.cleanup();
    }
  });

  it('renders the advisory review panel and explicitly denies AI authority', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('data-ui="keyword-advisory-panel"');
      expect(response.text).toContain('AI 长尾建议');
      expect(response.text).toContain('Advisory');
      expect(response.text).toContain('不会自动写入关键词库');
      expect(response.text).toContain(suggestion.suggestedText);
      expect(response.text).toContain('更窄的相关主题，只能由人工决定是否加入词库');
      expect(response.text).toContain('data-ui="keyword-suggestion-generate"');
      expect(response.text).toContain('data-ui="keyword-suggestion-accept"');
      expect(response.text).toContain('data-ui="keyword-suggestion-reject"');
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires authentication', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .expect(401);
    } finally {
      await fixture.cleanup();
    }
  });

  it('hides project existence from a non-member', async () => {
    const member = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const foreign = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await request(createApp())
        .get(`/projects/${foreign.project.id}/keywords`)
        .set('Cookie', member.sessionCookie)
        .expect(404);
    } finally {
      await member.cleanup();
      await foreign.cleanup();
    }
  });

  it('allows VIEWER read access but does not render mutation or AI-run controls', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain(suggestion.suggestedText);
      expect(response.text).not.toContain('data-ui="keyword-create-form"');
      expect(response.text).not.toContain('data-ui="keyword-suggestion-generate"');
      expect(response.text).not.toContain('data-ui="keyword-suggestion-accept"');
      expect(response.text).not.toContain('data-ui="keyword-suggestion-reject"');
    } finally {
      await fixture.cleanup();
    }
  });

  it('denies VIEWER mutation even with a valid CSRF token', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({
          _csrf: csrfFor(fixture),
          text: '符纸文化',
          type: 'CORE',
        })
        .expect(403);
    } finally {
      await fixture.cleanup();
    }
  });

  it('denies VIEWER advisory generation even with valid CSRF', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { seed } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords/${seed.id}/suggestions/generate`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture) })
        .expect(403);

      expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects keyword mutations with invalid CSRF', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: 'invalid-token', text: '符纸文化', type: 'CORE' })
        .expect(403);

      expect(response.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects advisory generation with invalid CSRF', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { seed } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords/${seed.id}/suggestions/generate`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: 'invalid-token' })
        .expect(403);

      expect(response.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });

  it('queues advisory generation through the injected AI task service then redirects', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const seed = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
        intent: 'INFORMATIONAL',
      });
      const createAndEnqueue = vi.fn(async () => ({ id: randomUUID() }));
      const aiTaskService = { createAndEnqueue } as unknown as AiTaskService;
      const response = await request(createApp({ aiTaskService }))
        .post(`/projects/${fixture.project.id}/keywords/${seed.id}/suggestions/generate`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture) })
        .expect(303);

      expect(response.headers.location).toBe(`/projects/${fixture.project.id}/keywords`);
      expect(createAndEnqueue).toHaveBeenCalledTimes(1);
      expect(createAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({
        projectId: fixture.project.id,
        taskType: 'KEYWORD_EXPANSION',
        promptVersion: 'keyword-expansion-v1',
      }));
    } finally {
      await fixture.cleanup();
    }
  });

  it('accepts a pending suggestion through the web form and redirects', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keyword-suggestions/${suggestion.id}/accept`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture), editedText: '六壬符纸专题' })
        .expect(303);

      expect(response.headers.location).toBe(`/projects/${fixture.project.id}/keywords`);
      expect(await prisma.keywordSuggestion.findUnique({ where: { id: suggestion.id } }))
        .toMatchObject({ status: 'ACCEPTED' });
      expect(await prisma.keyword.findUnique({
        where: {
          projectId_normalizedText: {
            projectId: fixture.project.id,
            normalizedText: '六壬符纸专题',
          },
        },
      })).toMatchObject({ source: 'AI_ACCEPTED', text: '六壬符纸专题' });
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects a pending suggestion through the web form and redirects without creating a keyword', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedPendingSuggestion(fixture, '符纸怎么用');
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keyword-suggestions/${suggestion.id}/reject`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture) })
        .expect(303);

      expect(response.headers.location).toBe(`/projects/${fixture.project.id}/keywords`);
      expect(await prisma.keywordSuggestion.findUnique({ where: { id: suggestion.id } }))
        .toMatchObject({ status: 'REJECTED', acceptedKeywordId: null });
      expect(await prisma.keyword.count({
        where: { projectId: fixture.project.id, source: 'AI_ACCEPTED' },
      })).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
