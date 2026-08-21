import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import {
  PUBLICATION_ARTICLE_GENERATION_PROMPT_ID,
  PUBLICATION_CONTENT_BRIEF_PROMPT_ID,
  buildArticleGenerationTaskInput,
  buildContentBriefTaskInput,
  createArticleGenerationTask,
  createContentBriefTask,
  parseArticleGenerationOutput,
  parseContentBriefOutput
} from '../../src/modules/publication/publication-ai.js';
import { publicationRepository } from '../../src/modules/publication/publication.repository.js';
import { PublicationService } from '../../src/modules/publication/publication.service.js';

const projectIds: string[] = [];

async function createWorkspace(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p8-ai-${suffix}`,
      primaryDomain: `p8-ai-${suffix}.example.com`,
      planLevel: 'ADVANCED',
      industry: 'Traditional Culture',
      defaultLanguage: 'zh-CN',
      targetCountry: 'US'
    }
  });
  projectIds.push(project.id);

  const service = new PublicationService();
  const proposal = await service.createManualProposal(project.id, {
    reason: 'Prepare a source-backed 六壬文化 article from reviewed materials.'
  }, 'editor-ai');
  const draft = await service.createDraftFromProposal(proposal.id, {
    title: '六壬文化初稿',
    slugCandidate: 'liuren-culture',
    body: 'This is the human V1 draft body.',
    excerpt: 'Human V1 excerpt.',
    metaDescription: 'Human V1 meta description.',
    language: 'zh-CN',
    generatedBy: 'HUMAN'
  });
  const source = await service.addSourceReference(draft.id, {
    title: 'Reviewed source fixture',
    author: 'Researcher',
    publisher: 'Archive',
    sourceUrl: 'https://example.org/reviewed-source',
    publishedAt: new Date('2025-01-01T00:00:00.000Z'),
    sourceType: 'USER_REVIEWED_WEB',
    accessedAt: new Date('2026-08-21T00:00:00.000Z'),
    userProvided: true,
    internalRef: false
  });
  return { project, service, proposal, draft, source };
}

function briefContent(sourceRef: string) {
  return JSON.stringify({
    summary: 'Advisory brief grounded only in the supplied draft and reviewed source.',
    thesis: 'Explain the topic conservatively and distinguish sourced facts from uncertainty.',
    outline: [{
      heading: 'Background',
      purpose: 'Frame only supported background.',
      evidenceRefs: [sourceRef]
    }],
    evidenceNeeds: [{
      claim: 'Any historical transmission claim needs a source.',
      status: 'NEEDS_SOURCE',
      sourceRefs: []
    }],
    seo: {
      primaryKeyword: '六壬文化',
      secondaryKeywords: ['民间信仰'],
      titleIdeas: ['六壬文化：资料边界内的介绍'],
      metaDescriptionNotes: 'Keep the description factual and source-bounded.'
    },
    geo: {
      answerTargets: ['What can the supplied source establish?'],
      entityNotes: ['Do not invent lineage entities.'],
      citabilityNotes: ['Keep factual claims traceable to supplied sources.']
    },
    caveats: ['Historical, lineage, date and ritual claims require supplied support.'],
    sourceReferences: [sourceRef]
  });
}

function articleContent(sourceRef: string) {
  return JSON.stringify({
    title: '六壬文化：从可核资料出发的介绍',
    body: 'AI V2 article body grounded in the supplied facts and reviewed source.',
    excerpt: 'A source-bounded introduction to 六壬文化.',
    metaDescription: '从可核资料出发介绍六壬文化，并明确资料边界。',
    schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
    sourceReferences: [sourceRef],
    caveats: ['Unsupported historical or ritual claims remain omitted.']
  });
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.aiTask.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.contentSourceReference.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-A advisory content brief and article generation through P4', () => {
  it('builds bounded P4 task packets and rejects any AI source reference that was not supplied', async () => {
    const { draft, proposal, source } = await createWorkspace('P8 AI packet');
    const sourceRef = `CONTENT_SOURCE_REFERENCE:${source.id}`;

    const briefInput = await buildContentBriefTaskInput(draft.id);
    expect(briefInput).toMatchObject({
      taskType: 'PUBLICATION_CONTENT_BRIEF',
      promptVersion: PUBLICATION_CONTENT_BRIEF_PROMPT_ID
    });
    expect(briefInput.requestKey).toContain(`${draft.id}:1:${draft.currentContentHash}`);
    expect(briefInput.factSnapshot).toMatchObject({
      draft: {
        id: draft.id,
        currentVersion: 1,
        currentContentHash: draft.currentContentHash,
        title: '六壬文化初稿',
        body: 'This is the human V1 draft body.'
      },
      proposal: {
        id: proposal.id,
        sourceType: 'MANUAL',
        reason: 'Prepare a source-backed 六壬文化 article from reviewed materials.'
      }
    });
    expect(JSON.stringify(briefInput.factSnapshot)).toContain(source.id);
    expect(JSON.stringify(briefInput.factSnapshot)).not.toContain('identityPayload');
    expect(JSON.stringify(briefInput.factSnapshot)).not.toContain('sourceProvenance');
    expect(briefInput.sourceReferences).toContainEqual({ type: 'CONTENT_SOURCE_REFERENCE', id: source.id });

    expect(parseContentBriefOutput(briefContent(sourceRef), briefInput.sourceReferences).thesis).toContain('conservatively');
    expect(() => parseContentBriefOutput(
      briefContent(sourceRef).replace(sourceRef, 'CONTENT_SOURCE_REFERENCE:invented'),
      briefInput.sourceReferences
    )).toThrow(/source/i);
  });

  it('routes both tasks through P4 and atomically appends article output as a new draft version without mutating a locked plan', async () => {
    const { project, service, draft, proposal, source } = await createWorkspace('P8 AI worker');
    const sourceRef = `CONTENT_SOURCE_REFERENCE:${source.id}`;
    const queue = { add: vi.fn(async () => undefined) };
    const taskService = new AiTaskService(new AiRepository(), queue);

    const briefTask = await createContentBriefTask(draft.id, taskService);
    expect(briefTask.taskType).toBe('PUBLICATION_CONTENT_BRIEF');
    const briefGateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-reasoner',
        responseId: 'publication-brief-fixture',
        content: briefContent(sourceRef),
        finishReason: 'stop',
        latencyMs: 20,
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80, cacheHitTokens: 0, cacheMissTokens: 50, reasoningTokens: 10 }
      }))
    };
    await executeAiTask(briefTask.id, { repository: new AiRepository(), gateway: briefGateway });

    const completedBrief = await prisma.aiTask.findUniqueOrThrow({
      where: { id: briefTask.id },
      include: { runs: { include: { result: true } } }
    });
    const briefResult = completedBrief.runs[0]?.result;
    expect(briefResult?.resultType).toBe('PUBLICATION_CONTENT_BRIEF');
    expect((await prisma.contentDraft.findUniqueOrThrow({ where: { id: draft.id } })).currentVersion).toBe(1);

    const site = await publicationRepository.createSite({
      projectId: project.id,
      displayName: '兴善堂',
      domain: 'xingshantang.org',
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      baseBranch: 'main',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
      allowedPaths: ['content/culture/']
    });
    const channel = await publicationRepository.createChannel({
      siteId: site.id,
      pathPrefix: '/culture',
      displayName: '六壬文化',
      repositoryPathTemplate: 'content/culture/{slug}.md',
      contentType: 'ARTICLE'
    });
    const lockedPlan = await publicationRepository.createPlan({
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: 'https://xingshantang.org/culture/liuren-culture',
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      targetBlobHashes: {},
      operations: [],
      expectedOutcomes: [],
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    });
    const planBefore = await prisma.publicationPlan.findUniqueOrThrow({ where: { id: lockedPlan.id } });

    const articleInput = await buildArticleGenerationTaskInput(draft.id, briefTask.id, 1);
    expect(articleInput).toMatchObject({
      taskType: 'PUBLICATION_ARTICLE_GENERATION',
      promptVersion: PUBLICATION_ARTICLE_GENERATION_PROMPT_ID
    });
    expect(articleInput.requestKey).toContain(`${draft.id}:1:${briefTask.id}`);
    expect(articleInput.factSnapshot).toMatchObject({
      draft: { id: draft.id, currentVersion: 1 },
      brief: { taskId: briefTask.id, resultId: briefResult?.id }
    });
    expect(JSON.stringify(articleInput.factSnapshot)).toContain('Advisory brief grounded only in the supplied draft');

    expect(parseArticleGenerationOutput(articleContent(sourceRef), articleInput.sourceReferences).title).toContain('六壬文化');
    expect(() => parseArticleGenerationOutput(
      articleContent(sourceRef).replace(sourceRef, 'CONTENT_SOURCE_REFERENCE:invented'),
      articleInput.sourceReferences
    )).toThrow(/source/i);

    const articleTask = await createArticleGenerationTask(draft.id, briefTask.id, 1, taskService);
    expect(queue.add).toHaveBeenCalledTimes(2);
    const articleGateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-chat',
        responseId: 'publication-article-fixture',
        content: articleContent(sourceRef),
        finishReason: 'stop',
        latencyMs: 15,
        usage: { promptTokens: 80, completionTokens: 60, totalTokens: 140, cacheHitTokens: 0, cacheMissTokens: 80, reasoningTokens: 0 }
      }))
    };
    await executeAiTask(articleTask.id, { repository: new AiRepository(), gateway: articleGateway });

    const storedDraft = await prisma.contentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    const versions = await prisma.contentDraftVersion.findMany({
      where: { draftId: draft.id },
      orderBy: { version: 'asc' }
    });
    expect(storedDraft).toMatchObject({
      currentVersion: 2,
      title: '六壬文化：从可核资料出发的介绍',
      body: 'AI V2 article body grounded in the supplied facts and reviewed source.',
      generatedBy: 'DEEPSEEK'
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, body: 'This is the human V1 draft body.', generatedBy: 'HUMAN' });
    expect(versions[1]).toMatchObject({ version: 2, body: 'AI V2 article body grounded in the supplied facts and reviewed source.', generatedBy: 'DEEPSEEK' });
    expect(versions[1]?.contentHash).toMatch(/^[a-f0-9]{64}$/);

    expect(await prisma.publicationPlan.findUniqueOrThrow({ where: { id: lockedPlan.id } })).toEqual(planBefore);
  });

  it('fails closed when the article task was bound to a stale draft version', async () => {
    const { service, draft, source } = await createWorkspace('P8 AI stale');
    const sourceRef = `CONTENT_SOURCE_REFERENCE:${source.id}`;
    const queue = { add: vi.fn(async () => undefined) };
    const taskService = new AiTaskService(new AiRepository(), queue);

    const briefTask = await createContentBriefTask(draft.id, taskService);
    await executeAiTask(briefTask.id, {
      repository: new AiRepository(),
      gateway: {
        complete: vi.fn(async () => ({
          provider: 'DEEPSEEK' as const,
          model: 'deepseek-reasoner',
          responseId: 'publication-stale-brief',
          content: briefContent(sourceRef),
          finishReason: 'stop',
          latencyMs: 10,
          usage: { promptTokens: 20, completionTokens: 20, totalTokens: 40, cacheHitTokens: 0, cacheMissTokens: 20, reasoningTokens: 5 }
        }))
      }
    });
    const articleTask = await createArticleGenerationTask(draft.id, briefTask.id, 1, taskService);

    await service.saveDraftVersion(draft.id, 1, { body: 'Human V2 wins before AI completes.' }, 'HUMAN');

    await expect(executeAiTask(articleTask.id, {
      repository: new AiRepository(),
      gateway: {
        complete: vi.fn(async () => ({
          provider: 'DEEPSEEK' as const,
          model: 'deepseek-chat',
          responseId: 'publication-stale-article',
          content: articleContent(sourceRef),
          finishReason: 'stop',
          latencyMs: 10,
          usage: { promptTokens: 20, completionTokens: 20, totalTokens: 40, cacheHitTokens: 0, cacheMissTokens: 20, reasoningTokens: 0 }
        }))
      }
    })).rejects.toMatchObject({ code: 'DRAFT_VERSION_CONFLICT' });

    const storedDraft = await prisma.contentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    const versions = await prisma.contentDraftVersion.findMany({ where: { draftId: draft.id } });
    expect(storedDraft).toMatchObject({ currentVersion: 2, body: 'Human V2 wins before AI completes.', generatedBy: 'HUMAN' });
    expect(versions).toHaveLength(2);
    expect((await prisma.aiTask.findUniqueOrThrow({ where: { id: articleTask.id } })).status).toBe('FAILED');
  });
});
