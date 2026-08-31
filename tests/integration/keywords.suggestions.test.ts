import { randomUUID } from 'node:crypto';
import type { Keyword, KeywordSuggestion } from '@prisma/client';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import type { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { KeywordService } from '../../src/modules/keywords/keyword.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const projectIds: string[] = [];
const actorUserId = randomUUID();

type SuggestionService = KeywordService & {
  acceptSuggestion(input: {
    actorUserId: string;
    projectId: string;
    suggestionId: string;
    editedText?: string;
  }): Promise<Keyword>;
  rejectSuggestion(input: {
    actorUserId: string;
    projectId: string;
    suggestionId: string;
  }): Promise<KeywordSuggestion>;
};

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>): string {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

async function createProject(label: string) {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `Keyword suggestion ${label}`,
      slug: `keyword-suggestion-${label}-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
    },
  });
  projectIds.push(project.id);
  return project;
}

async function seedSuggestion(
  service: KeywordService,
  projectId: string,
  options: {
    text?: string;
    status?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  } = {},
) {
  const seed = await service.createManual({
    actorUserId,
    projectId,
    text: `符纸-${randomUUID()}`,
    type: 'CORE',
    intent: 'INFORMATIONAL',
  });
  const task = await prisma.aiTask.create({
    data: {
      projectId,
      taskType: 'KEYWORD_EXPANSION',
      requestKey: `keyword-suggestion-test:${randomUUID()}`,
      promptVersion: 'keyword-expansion-v1',
      factSnapshot: { seedKeyword: { id: seed.id, text: seed.text } },
      sourceReferences: [{ type: 'KEYWORD', id: seed.id }],
    },
  });
  const suggestion = await prisma.keywordSuggestion.create({
    data: {
      projectId,
      seedKeywordId: seed.id,
      suggestedText: options.text ?? `六壬符纸-${randomUUID()}`,
      normalizedText: (options.text ?? `六壬符纸-${randomUUID()}`).normalize('NFKC').trim().toLocaleLowerCase('und'),
      suggestedType: 'LONG_TAIL',
      suggestedIntent: 'INFORMATIONAL',
      rationale: '更窄的相关主题',
      status: options.status ?? 'PENDING',
      provider: 'DEEPSEEK',
      model: 'fixture-model',
      aiTaskId: task.id,
    },
  });
  return { seed, task, suggestion };
}

async function seedAuthenticatedSuggestion(
  fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>,
  text = '六壬符纸',
) {
  const service = new KeywordService();
  const seed = await service.createManual({
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
      requestKey: `keyword-api-suggestion:${randomUUID()}`,
      promptVersion: 'keyword-expansion-v1',
      factSnapshot: { seedKeyword: { id: seed.id, text: seed.text } },
      sourceReferences: [{ type: 'KEYWORD', id: seed.id }],
    },
  });
  const suggestion = await prisma.keywordSuggestion.create({
    data: {
      projectId: fixture.project.id,
      seedKeywordId: seed.id,
      suggestedText: text,
      normalizedText: text.normalize('NFKC').trim().toLocaleLowerCase('und'),
      suggestedType: 'LONG_TAIL',
      suggestedIntent: 'INFORMATIONAL',
      rationale: '更窄的相关主题',
      provider: 'DEEPSEEK',
      model: 'fixture-model',
      aiTaskId: task.id,
    },
  });
  return { seed, task, suggestion };
}

afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
});

describe('KeywordService suggestion decision semantics', () => {
  it('accepts a pending suggestion idempotently and creates one AI_ACCEPTED child', async () => {
    const project = await createProject('accept-idempotent');
    const service = new KeywordService() as SuggestionService;
    const { seed, suggestion } = await seedSuggestion(service, project.id, { text: '六壬符纸' });

    const first = await service.acceptSuggestion({
      actorUserId,
      projectId: project.id,
      suggestionId: suggestion.id,
    });
    const second = await service.acceptSuggestion({
      actorUserId,
      projectId: project.id,
      suggestionId: suggestion.id,
    });

    expect(second.id).toBe(first.id);
    expect(first.source).toBe('AI_ACCEPTED');
    expect(first.normalizedText).toBe('六壬符纸');
    expect(await prisma.keyword.count({
      where: { projectId: project.id, normalizedText: '六壬符纸' },
    })).toBe(1);
    expect((await prisma.keywordRelation.findUnique({ where: { childKeywordId: first.id } }))?.parentKeywordId)
      .toBe(seed.id);
    expect(await prisma.keywordSuggestion.findUnique({ where: { id: suggestion.id } }))
      .toMatchObject({ status: 'ACCEPTED', acceptedKeywordId: first.id, decidedByUserId: actorUserId });
  });

  it.each(['REJECTED', 'EXPIRED'] as const)('does not accept a %s suggestion', async (status) => {
    const project = await createProject(`decided-${status.toLowerCase()}`);
    const service = new KeywordService() as SuggestionService;
    const { suggestion } = await seedSuggestion(service, project.id, { status });

    await expect(service.acceptSuggestion({
      actorUserId,
      projectId: project.id,
      suggestionId: suggestion.id,
    })).rejects.toMatchObject({ code: 'KEYWORD_SUGGESTION_ALREADY_DECIDED' });

    expect(await prisma.keyword.count({ where: { projectId: project.id, source: 'AI_ACCEPTED' } })).toBe(0);
  });

  it('links an existing active keyword instead of duplicating it', async () => {
    const project = await createProject('existing-active');
    const service = new KeywordService() as SuggestionService;
    const existing = await service.createManual({
      actorUserId,
      projectId: project.id,
      text: '六壬符纸',
      type: 'LONG_TAIL',
    });
    const { seed, suggestion } = await seedSuggestion(service, project.id, { text: '六壬符纸' });

    const accepted = await service.acceptSuggestion({
      actorUserId,
      projectId: project.id,
      suggestionId: suggestion.id,
    });

    expect(accepted.id).toBe(existing.id);
    expect(accepted.source).toBe('MANUAL');
    expect(await prisma.keyword.count({ where: { projectId: project.id, normalizedText: '六壬符纸' } })).toBe(1);
    expect((await prisma.keywordRelation.findUnique({ where: { childKeywordId: existing.id } }))?.parentKeywordId)
      .toBe(seed.id);
  });

  it('links an existing disabled keyword instead of duplicating it', async () => {
    const project = await createProject('existing-disabled');
    const service = new KeywordService() as SuggestionService;
    const existing = await service.createManual({
      actorUserId,
      projectId: project.id,
      text: '六壬符纸',
      type: 'LONG_TAIL',
    });
    await service.updateManual({
      actorUserId,
      projectId: project.id,
      keywordId: existing.id,
      status: 'DISABLED',
    });
    const { suggestion } = await seedSuggestion(service, project.id, { text: '六壬符纸' });

    const accepted = await service.acceptSuggestion({
      actorUserId,
      projectId: project.id,
      suggestionId: suggestion.id,
    });

    expect(accepted.id).toBe(existing.id);
    expect(accepted.status).toBe('DISABLED');
    expect(await prisma.keyword.count({ where: { projectId: project.id, normalizedText: '六壬符纸' } })).toBe(1);
  });

  it('requires explicit restore when the normalized keyword is archived', async () => {
    const project = await createProject('archived');
    const service = new KeywordService() as SuggestionService;
    const existing = await service.createManual({
      actorUserId,
      projectId: project.id,
      text: '六壬符纸',
      type: 'LONG_TAIL',
    });
    await service.archive({ actorUserId, projectId: project.id, keywordId: existing.id });
    const { suggestion } = await seedSuggestion(service, project.id, { text: '六壬符纸' });

    await expect(service.acceptSuggestion({
      actorUserId,
      projectId: project.id,
      suggestionId: suggestion.id,
    })).rejects.toMatchObject({ code: 'KEYWORD_ARCHIVED_RESTORE_REQUIRED' });

    expect(await prisma.keywordSuggestion.findUnique({ where: { id: suggestion.id } }))
      .toMatchObject({ status: 'PENDING', acceptedKeywordId: null });
  });

  it('re-normalizes edited acceptance text before creating the authoritative keyword', async () => {
    const project = await createProject('edited');
    const service = new KeywordService() as SuggestionService;
    const { suggestion } = await seedSuggestion(service, project.id);

    const accepted = await service.acceptSuggestion({
      actorUserId,
      projectId: project.id,
      suggestionId: suggestion.id,
      editedText: '  Ｆｏｏ   符紙  ',
    });

    expect(accepted.text).toBe('Ｆｏｏ   符紙');
    expect(accepted.normalizedText).toBe('foo 符紙');
  });

  it('rejects a pending suggestion atomically without creating a keyword', async () => {
    const project = await createProject('reject');
    const service = new KeywordService() as SuggestionService;
    const { suggestion } = await seedSuggestion(service, project.id);

    const rejected = await service.rejectSuggestion({
      actorUserId,
      projectId: project.id,
      suggestionId: suggestion.id,
    });

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.decidedByUserId).toBe(actorUserId);
    expect(rejected.decidedAt).not.toBeNull();
    expect(await prisma.keyword.count({ where: { projectId: project.id, source: 'AI_ACCEPTED' } })).toBe(0);
  });

  it('fails closed for a foreign suggestion identifier', async () => {
    const local = await createProject('local');
    const foreign = await createProject('foreign');
    const service = new KeywordService() as SuggestionService;
    const { suggestion } = await seedSuggestion(service, foreign.id);

    await expect(service.acceptSuggestion({
      actorUserId,
      projectId: local.id,
      suggestionId: suggestion.id,
    })).rejects.toMatchObject({ code: 'KEYWORD_SUGGESTION_NOT_FOUND' });
  });
});

describe('Keyword suggestion API authorization and commands', () => {
  it('requires AI_RUN to generate keyword suggestions', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { seed } = await seedAuthenticatedSuggestion(fixture);
      const response = await request(createApp())
        .post(`/api/v1/projects/${fixture.project.id}/keywords/${seed.id}/suggestions/generate`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .expect(403);

      expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires CSRF for keyword suggestion generation', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { seed } = await seedAuthenticatedSuggestion(fixture);
      const response = await request(createApp())
        .post(`/api/v1/projects/${fixture.project.id}/keywords/${seed.id}/suggestions/generate`)
        .set('Cookie', fixture.sessionCookie)
        .expect(403);

      expect(response.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });

  it('queues generation through the injected AI task service and returns 202', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { seed } = await seedAuthenticatedSuggestion(fixture);
      const taskId = randomUUID();
      const createAndEnqueue = vi.fn(async () => ({ id: taskId }));
      const aiTaskService = { createAndEnqueue } as unknown as AiTaskService;
      const response = await request(createApp({ aiTaskService }))
        .post(`/api/v1/projects/${fixture.project.id}/keywords/${seed.id}/suggestions/generate`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .expect(202);

      expect(response.body.data).toEqual({ aiTaskId: taskId });
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

  it('requires CONTENT_WRITE to accept a suggestion', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedAuthenticatedSuggestion(fixture);
      const response = await request(createApp())
        .post(`/api/v1/projects/${fixture.project.id}/keyword-suggestions/${suggestion.id}/accept`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({ editedText: '六壬符纸' })
        .expect(403);

      expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires CSRF to reject a suggestion', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedAuthenticatedSuggestion(fixture);
      const response = await request(createApp())
        .post(`/api/v1/projects/${fixture.project.id}/keyword-suggestions/${suggestion.id}/reject`)
        .set('Cookie', fixture.sessionCookie)
        .expect(403);

      expect(response.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });

  it('lets an OPERATOR accept and reject pending suggestions', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const first = await seedAuthenticatedSuggestion(fixture, '六壬符纸');
      const second = await seedAuthenticatedSuggestion(fixture, '符纸怎么用');
      const app = createApp();
      const csrf = csrfFor(fixture);

      const accepted = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keyword-suggestions/${first.suggestion.id}/accept`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ editedText: '六壬符纸' })
        .expect(200);
      expect(accepted.body.data).toMatchObject({
        text: '六壬符纸',
        source: 'AI_ACCEPTED',
      });

      const rejected = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keyword-suggestions/${second.suggestion.id}/reject`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .expect(200);
      expect(rejected.body.data).toMatchObject({
        id: second.suggestion.id,
        status: 'REJECTED',
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('fails closed for a foreign suggestion identifier', async () => {
    const local = await seedAuthenticatedUser({
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

    try {
      const { suggestion } = await seedAuthenticatedSuggestion(foreign);
      const response = await request(createApp())
        .post(`/api/v1/projects/${local.project.id}/keyword-suggestions/${suggestion.id}/accept`)
        .set('Cookie', local.sessionCookie)
        .set('X-CSRF-Token', csrfFor(local))
        .expect(404);

      expect(response.body.error.code).toBe('KEYWORD_SUGGESTION_NOT_FOUND');
    } finally {
      await foreign.cleanup();
      await local.cleanup();
    }
  });
});
