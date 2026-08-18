import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService, type AiTaskJobQueue } from '../../src/modules/ai/ai.service.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import {
  buildEntityEnrichmentTaskInput,
  createEntityEnrichmentTask,
  EntityEnrichmentSchema
} from '../../src/modules/ai/entity-intelligence.js';

class FakeQueue implements AiTaskJobQueue {
  calls: Array<{ name: string; data: { taskId: string }; options: { jobId: string; attempts: number } }> = [];
  async add(name: string, data: { taskId: string }, options: { jobId: string; attempts: number }) {
    this.calls.push({ name, data, options });
    return undefined;
  }
}

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function createFixture() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: { name: 'Entity Intelligence', slug: `entity-ai-${suffix}`, primaryDomain: 'example.com' }
  });
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId: project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com/',
      crawlerVersion: 'fixture',
      finishedAt: new Date()
    }
  });
  const page = await prisma.page.create({
    data: {
      projectId: project.id,
      url: 'https://example.com/about?secret=do-not-send',
      normalizedUrl: 'https://example.com/about',
      host: 'example.com',
      path: '/about'
    }
  });
  const audit = await prisma.geoAuditRun.create({
    data: {
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'COMPLETED',
      engineVersion: 'geo-readiness-1',
      finishedAt: new Date()
    }
  });
  const organization = await prisma.entity.create({
    data: {
      projectId: project.id,
      entityType: 'ORGANIZATION',
      canonicalName: 'Example Organization',
      normalizedName: 'example organization',
      officialUrl: 'https://example.com/',
      confidence: 1
    }
  });
  const serviceEntity = await prisma.entity.create({
    data: {
      projectId: project.id,
      entityType: 'SERVICE',
      canonicalName: 'Example Service',
      normalizedName: 'example service',
      officialUrl: 'https://example.com/service',
      confidence: 1
    }
  });
  await prisma.entityAlias.create({
    data: { entityId: organization.id, alias: 'Example Org', normalizedAlias: 'example org', sourceType: 'SCHEMA' }
  });
  await prisma.entityObservation.create({
    data: {
      geoAuditRunId: audit.id,
      entityId: organization.id,
      pageId: page.id,
      sourceType: 'SCHEMA',
      property: 'sameAs',
      value: 'https://social.example/example'
    }
  });
  await prisma.entityRelation.create({
    data: {
      projectId: project.id,
      sourceEntityId: serviceEntity.id,
      relationType: 'PROVIDER',
      targetEntityId: organization.id,
      sourcePageId: page.id,
      confidence: 1
    }
  });
  return { project, audit, organization };
}

async function deterministicEntityState(projectId: string) {
  return {
    entities: await prisma.entity.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    aliases: await prisma.entityAlias.findMany({ where: { entity: { projectId } }, orderBy: { id: 'asc' } }),
    observations: await prisma.entityObservation.findMany({ where: { entity: { projectId } }, orderBy: { id: 'asc' } }),
    relations: await prisma.entityRelation.findMany({ where: { projectId }, orderBy: { id: 'asc' } })
  };
}

describe('P4 entity intelligence', () => {
  it('builds a bounded deterministic entity snapshot and one idempotent task', async () => {
    const { project, audit, organization } = await createFixture();
    const input = await buildEntityEnrichmentTaskInput(project.id, audit.id);
    const serialized = JSON.stringify(input.factSnapshot);

    expect(input).toMatchObject({
      projectId: project.id,
      taskType: 'ENTITY_ENRICHMENT',
      requestKey: `geo-audit:${audit.id}:entity-enrichment-v1`,
      promptVersion: 'entity-enrichment-v1'
    });
    expect(input.factSnapshot).toMatchObject({
      audit: { id: audit.id, status: 'COMPLETED' },
      entities: expect.arrayContaining([
        expect.objectContaining({ id: organization.id, canonicalName: 'Example Organization' })
      ])
    });
    expect(serialized).not.toContain('secret=do-not-send');
    expect(serialized).not.toMatch(/rawHtml|pageBody|aiVisibility|shareOfVoice/i);

    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);
    const first = await createEntityEnrichmentTask(project.id, audit.id, service);
    const second = await createEntityEnrichmentTask(project.id, audit.id, service);
    expect(second.id).toBe(first.id);
    expect(queue.calls).toHaveLength(1);
  });

  it('persists suggestions only and leaves deterministic P3 entity tables unchanged', async () => {
    const { project, audit, organization } = await createFixture();
    const before = await deterministicEntityState(project.id);
    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);
    const task = await createEntityEnrichmentTask(project.id, audit.id, service);
    const input = await buildEntityEnrichmentTaskInput(project.id, audit.id);
    const source = (input.sourceReferences as Array<{ type: string; id: string }>).find(
      (ref) => ref.type === 'ENTITY' && ref.id === organization.id
    );
    expect(source).toBeDefined();

    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-v4-pro',
        responseId: 'entity-enrichment-fixture',
        content: JSON.stringify({
          suggestions: [{
            entityId: organization.id,
            suggestedDescription: 'Suggested description only.',
            suggestedAliases: ['Example Co'],
            rationale: 'Uses the supplied deterministic organization identity.',
            sourceRefs: [`ENTITY:${organization.id}`]
          }]
        }),
        finishReason: 'stop',
        latencyMs: 10,
        usage: {
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
          cacheHitTokens: 0,
          cacheMissTokens: 20,
          reasoningTokens: 4
        }
      }))
    };

    await executeAiTask(task.id, { repository: new AiRepository(), gateway });

    const after = await deterministicEntityState(project.id);
    expect(after).toEqual(before);
    const result = await prisma.aiAnalysisResult.findFirstOrThrow({ where: { run: { aiTaskId: task.id } } });
    expect(result.structuredOutput).toMatchObject({
      suggestions: [expect.objectContaining({ entityId: organization.id, suggestedAliases: ['Example Co'] })]
    });
  });

  it('rejects suggestions for an entity or source ref not supplied to the model', async () => {
    const parsed = EntityEnrichmentSchema.safeParse({
      suggestions: [{
        entityId: '00000000-0000-0000-0000-000000000000',
        suggestedDescription: null,
        suggestedAliases: [],
        rationale: 'Invented',
        sourceRefs: ['ENTITY:00000000-0000-0000-0000-000000000000']
      }]
    });
    expect(parsed.success).toBe(true);

    const { project, audit } = await createFixture();
    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);
    const task = await createEntityEnrichmentTask(project.id, audit.id, service);
    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-v4-pro',
        responseId: 'bad-entity-ref',
        content: JSON.stringify(parsed.data),
        finishReason: 'stop',
        latencyMs: 10,
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, cacheHitTokens: 0, cacheMissTokens: 10, reasoningTokens: 2 }
      }))
    };

    await expect(executeAiTask(task.id, { repository: new AiRepository(), gateway })).rejects.toMatchObject({ code: 'INVALID_AI_OUTPUT' });
    expect(await prisma.aiAnalysisResult.count({ where: { run: { aiTaskId: task.id } } })).toBe(0);
  });
});
