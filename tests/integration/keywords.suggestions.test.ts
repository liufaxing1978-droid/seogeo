import { randomUUID } from 'node:crypto';
import type { Keyword, KeywordSuggestion } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordService } from '../../src/modules/keywords/keyword.service.js';

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
