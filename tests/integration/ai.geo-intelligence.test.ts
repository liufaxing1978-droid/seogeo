import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { runGeoAudit } from '../../src/modules/geo/audit-engine.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService, type AiTaskJobQueue } from '../../src/modules/ai/ai.service.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import {
  buildGeoAnalysisTaskInput,
  createGeoAnalysisTask,
  GeoAnalysisSchema
} from '../../src/modules/ai/geo-intelligence.js';

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

async function createGeoFixture() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: { name: 'GEO Intelligence Brand', slug: `geo-ai-${suffix}`, primaryDomain: 'example.com' }
  });
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId: project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com/',
      maxPages: 10,
      crawlerVersion: 'fixture',
      finishedAt: new Date()
    }
  });
  await prisma.robotsResult.create({
    data: {
      crawlRunId: crawl.id,
      url: 'https://example.com/robots.txt',
      statusCode: 200,
      rawText: 'User-agent: GPTBot\nDisallow: /private\nUser-agent: *\nAllow: /'
    }
  });
  const page = await prisma.page.create({
    data: {
      projectId: project.id,
      url: 'https://example.com/?token=not-sent',
      normalizedUrl: 'https://example.com/',
      host: 'example.com',
      path: '/'
    }
  });
  const snapshot = await prisma.pageSnapshot.create({
    data: {
      pageId: page.id,
      crawlRunId: crawl.id,
      finalUrl: 'https://example.com/',
      statusCode: 200,
      contentType: 'text/html',
      title: 'GEO Intelligence Brand Official Guide',
      metaDescription: 'Deterministic GEO fixture.',
      canonicalUrl: 'https://example.com/',
      h1: 'GEO Intelligence Brand',
      h1Count: 1,
      h2Count: 2,
      h3Count: 0,
      wordCount: 500,
      externalLinksCount: 0,
      internalLinksCount: 2,
      schemaCount: 1,
      indexable: true,
      parserVersion: 'fixture'
    }
  });
  await prisma.pageStructuredSignal.create({
    data: {
      pageSnapshotId: snapshot.id,
      openGraphSiteName: 'GEO Intelligence Brand',
      entitySignals: [
        {
          schemaTypes: ['Organization'],
          id: 'https://example.com/#organization',
          name: 'GEO Intelligence Brand',
          alternateNames: ['GIB'],
          url: 'https://example.com/',
          sameAs: [],
          role: 'ROOT',
          sourcePath: '$',
          parentSourcePath: null
        }
      ]
    }
  });
  await prisma.page.create({
    data: {
      projectId: project.id,
      url: 'https://example.com/about',
      normalizedUrl: 'https://example.com/about',
      host: 'example.com',
      path: '/about'
    }
  });
  const audit = await prisma.geoAuditRun.create({
    data: {
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'QUEUED',
      engineVersion: 'geo-readiness-fixture'
    }
  });
  await runGeoAudit(audit.id);
  return { project, audit, page };
}

describe('P4 GEO Intelligence', () => {
  it('builds a bounded fact packet that preserves UNKNOWN/null and never fabricates AI Visibility', async () => {
    const { project, audit } = await createGeoFixture();
    const input = await buildGeoAnalysisTaskInput(project.id, audit.id);
    const serialized = JSON.stringify(input.factSnapshot);

    expect(input).toMatchObject({
      projectId: project.id,
      taskType: 'GEO_READINESS_ANALYSIS',
      requestKey: `geo-audit:${audit.id}:geo-readiness-analysis-v1`,
      promptVersion: 'geo-readiness-analysis-v1'
    });
    expect(input.factSnapshot).toMatchObject({
      audit: {
        id: audit.id,
        status: 'COMPLETED'
      },
      score: {
        scoreType: 'GEO_READINESS_V1',
        formulaVersion: 'GEO_READINESS_V1_NORMALIZED_AVAILABLE'
      }
    });

    const packet = input.factSnapshot as {
      citability: Array<Record<string, unknown>>;
      aiCrawlers: Array<Record<string, unknown>>;
      entities: Array<Record<string, unknown>>;
      ruleOpportunities: Array<Record<string, unknown>>;
    };
    expect(packet.citability).toHaveLength(1);
    expect(packet.citability[0]).toMatchObject({
      answerFirstScore: null,
      factualDensityScore: null,
      definitionClarityScore: null
    });
    expect(packet.aiCrawlers.length).toBeGreaterThan(0);
    expect(packet.aiCrawlers.some((row) => row.status === 'UNKNOWN' || row.status === 'PASS' || row.status === 'FAIL')).toBe(true);
    expect(packet.entities.length).toBeGreaterThan(0);
    expect(packet.ruleOpportunities.every((row) => row.outcome === 'FAIL')).toBe(true);

    expect(serialized).not.toMatch(/aiVisibility|shareOfVoice|\bSOV\b|platformPosition|externalCitationCount/i);
    expect(serialized).not.toContain('token=not-sent');
    expect(input.sourceReferences).toEqual(expect.arrayContaining([{ type: 'GEO_AUDIT', id: audit.id }]));
  });

  it('persists and enqueues one idempotent GEO analysis task', async () => {
    const { project, audit } = await createGeoFixture();
    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);

    const first = await createGeoAnalysisTask(project.id, audit.id, service);
    const second = await createGeoAnalysisTask(project.id, audit.id, service);

    expect(second.id).toBe(first.id);
    expect(first.requestKey).toBe(`geo-audit:${audit.id}:geo-readiness-analysis-v1`);
    expect(queue.calls).toHaveLength(1);
  });

  it('rejects a GEO recommendation that references a fact not supplied to the model', async () => {
    const { project, audit } = await createGeoFixture();
    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);
    const task = await createGeoAnalysisTask(project.id, audit.id, service);
    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-v4-pro',
        responseId: 'fixture-bad-geo-ref',
        content: JSON.stringify({
          summary: 'Summary',
          opportunities: [
            {
              priority: 'HIGH',
              dimension: 'CITABILITY',
              title: 'Invented evidence',
              recommendation: 'Should fail',
              sourceRefs: ['GEO_RULE_RESULT:00000000-0000-0000-0000-000000000000']
            }
          ],
          unavailableFacts: ['AI Visibility was not sampled']
        }),
        finishReason: 'stop',
        latencyMs: 10,
        usage: {
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          cacheHitTokens: 0,
          cacheMissTokens: 10,
          reasoningTokens: 4
        }
      }))
    };

    await expect(executeAiTask(task.id, { repository: new AiRepository(), gateway })).rejects.toMatchObject({
      code: 'INVALID_AI_OUTPUT'
    });
    expect(await prisma.aiAnalysisResult.count({ where: { run: { aiTaskId: task.id } } })).toBe(0);
  });

  it('accepts schema-valid GEO output with a supplied deterministic source ref', async () => {
    const { project, audit } = await createGeoFixture();
    const input = await buildGeoAnalysisTaskInput(project.id, audit.id);
    const firstRef = (input.sourceReferences as Array<{ type: string; id: string }>).find(
      (ref) => ref.type === 'GEO_RULE_RESULT'
    );
    expect(firstRef).toBeDefined();

    const parsed = GeoAnalysisSchema.parse({
      summary: 'Improve the deterministic readiness opportunity.',
      opportunities: [
        {
          priority: 'HIGH',
          dimension: 'CITABILITY',
          title: 'Improve source support',
          recommendation: 'Add explicit source links and rerun the GEO audit.',
          sourceRefs: [`${firstRef!.type}:${firstRef!.id}`]
        }
      ],
      unavailableFacts: ['AI Visibility is unavailable until real platform sampling exists.']
    });
    expect(parsed.opportunities).toHaveLength(1);
  });
});
