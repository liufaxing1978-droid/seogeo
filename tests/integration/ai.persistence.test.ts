import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('P4 AI persistence foundation', () => {
  it('persists task, run, provider usage and validated analysis while preserving deterministic history', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'AI Persistence Fixture',
        slug: `ai-persistence-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: 'p4-test',
        finishedAt: new Date()
      }
    });

    const seoAudit = await prisma.seoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'COMPLETED',
        engineVersion: 'p2-test',
        finishedAt: new Date()
      }
    });

    const geoAudit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'COMPLETED',
        engineVersion: 'p3-test',
        finishedAt: new Date()
      }
    });

    const task = await prisma.aiTask.create({
      data: {
        projectId: project.id,
        taskType: 'SEO_AUDIT_ANALYSIS',
        status: 'QUEUED',
        requestKey: `seo:${seoAudit.id}:v1`,
        promptVersion: 'seo-audit-analysis-v1',
        factSnapshot: { auditId: seoAudit.id, score: 78 },
        sourceReferences: [{ type: 'SEO_AUDIT', id: seoAudit.id }]
      }
    });

    const run = await prisma.aiTaskRun.create({
      data: {
        aiTaskId: task.id,
        attemptNo: 1,
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-flash',
        mode: 'FAST',
        responseFormat: 'JSON',
        status: 'RUNNING',
        promptVersion: task.promptVersion,
        requestHash: 'fixture-request-hash'
      }
    });

    await prisma.aiProviderCall.create({
      data: {
        aiTaskRunId: run.id,
        attemptNo: 1,
        httpStatus: 200,
        providerResponseId: 'ds-fixture-1',
        latencyMs: 420,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cacheHitTokens: 70,
        cacheMissTokens: 30,
        reasoningTokens: 0,
        finishReason: 'stop'
      }
    });

    await prisma.aiAnalysisResult.create({
      data: {
        aiTaskRunId: run.id,
        resultType: 'SEO_AUDIT_ANALYSIS',
        summary: 'Deterministic SEO facts were analyzed.',
        structuredOutput: {
          summary: 'Deterministic SEO facts were analyzed.',
          priorities: []
        },
        sourceReferences: [{ type: 'SEO_AUDIT', id: seoAudit.id }],
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-flash',
        promptVersion: task.promptVersion
      }
    });

    const stored = await prisma.aiTask.findUniqueOrThrow({
      where: { id: task.id },
      include: {
        runs: {
          include: { calls: true, result: true }
        }
      }
    });

    expect(stored.runs).toHaveLength(1);
    expect(stored.runs[0]?.calls[0]).toMatchObject({
      providerResponseId: 'ds-fixture-1',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheHitTokens: 70,
      cacheMissTokens: 30
    });
    expect(stored.runs[0]?.result?.summary).toBe('Deterministic SEO facts were analyzed.');

    await expect(
      prisma.aiTask.create({
        data: {
          projectId: project.id,
          taskType: 'SEO_AUDIT_ANALYSIS',
          requestKey: `seo:${seoAudit.id}:v1`,
          promptVersion: 'seo-audit-analysis-v1',
          factSnapshot: {},
          sourceReferences: []
        }
      })
    ).rejects.toThrow();

    await expect(
      prisma.aiTaskRun.create({
        data: {
          aiTaskId: task.id,
          attemptNo: 1,
          provider: 'DEEPSEEK',
          model: 'deepseek-v4-pro',
          mode: 'REASONING',
          responseFormat: 'JSON',
          status: 'RUNNING',
          promptVersion: task.promptVersion,
          requestHash: 'duplicate-attempt'
        }
      })
    ).rejects.toThrow();

    await prisma.aiTask.delete({ where: { id: task.id } });

    expect(await prisma.aiTaskRun.count()).toBe(0);
    expect(await prisma.aiProviderCall.count()).toBe(0);
    expect(await prisma.aiAnalysisResult.count()).toBe(0);
    expect(await prisma.crawlRun.count({ where: { id: crawl.id } })).toBe(1);
    expect(await prisma.seoAuditRun.count({ where: { id: seoAudit.id } })).toBe(1);
    expect(await prisma.geoAuditRun.count({ where: { id: geoAudit.id } })).toBe(1);
  });
});
