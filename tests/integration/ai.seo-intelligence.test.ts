import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService, type AiTaskJobQueue } from '../../src/modules/ai/ai.service.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import {
  buildSeoAnalysisTaskInput,
  createSeoAnalysisTask,
  SeoAnalysisSchema
} from '../../src/modules/ai/seo-intelligence.js';

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

async function createSeoFixture() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: { name: 'SEO Intelligence', slug: `seo-ai-${suffix}`, primaryDomain: 'example.com' }
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
      url: 'https://example.com/important?secret=not-sent',
      normalizedUrl: 'https://example.com/important',
      host: 'example.com',
      path: '/important'
    }
  });
  const audit = await prisma.seoAuditRun.create({
    data: {
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'COMPLETED',
      engineVersion: 'p2-fixture',
      eligiblePages: 1,
      rulesEvaluated: 20,
      finishedAt: new Date()
    }
  });
  const rule = await prisma.seoRule.create({
    data: {
      ruleCode: `TITLE_MISSING_${suffix}`,
      name: 'Missing title',
      category: 'On-page',
      description: 'Fixture deterministic title rule'
    }
  });
  const version = await prisma.seoRuleVersion.create({
    data: {
      seoRuleId: rule.id,
      version: 1,
      severity: 'HIGH',
      weight: 2,
      detectionType: 'PAGE_FACT',
      seoImpact: 'Weak search understanding',
      fixGuide: 'Add a descriptive title',
      releasedAt: new Date()
    }
  });
  const ruleResult = await prisma.seoRuleResult.create({
    data: {
      auditRunId: audit.id,
      pageId: page.id,
      ruleVersionId: version.id,
      resultKey: `page:${page.id}`,
      outcome: 'FAIL',
      evidence: {
        rawHtml: '<html>must never enter AI fact packet</html>',
        authorization: 'Bearer must-never-enter-ai'
      }
    }
  });
  const issue = await prisma.seoIssue.create({
    data: {
      projectId: project.id,
      ruleId: rule.id,
      issueKey: `title-missing:${suffix}`,
      title: 'Missing title',
      category: 'On-page',
      currentSeverity: 'HIGH',
      status: 'OPEN',
      firstSeenAt: new Date(),
      lastSeenAt: new Date()
    }
  });
  const occurrence = await prisma.seoIssueOccurrence.create({
    data: {
      seoIssueId: issue.id,
      auditRunId: audit.id,
      ruleVersionId: version.id,
      comparison: 'NEW',
      severity: 'HIGH',
      affectedPagesCount: 1,
      evidenceSummary: { internalOnly: 'must not be forwarded verbatim' }
    }
  });
  await prisma.seoIssuePage.create({
    data: {
      issueOccurrenceId: occurrence.id,
      pageId: page.id,
      ruleResultId: ruleResult.id,
      evidence: { rawSecret: 'must not be forwarded' }
    }
  });
  const score = await prisma.seoScore.create({
    data: {
      auditRunId: audit.id,
      projectId: project.id,
      score: 78,
      previousScore: 74,
      change: 4,
      engineVersion: 'p2-fixture'
    }
  });
  await prisma.seoScoreComponent.create({
    data: {
      seoScoreId: score.id,
      componentCode: rule.ruleCode,
      componentName: rule.name,
      affectedPages: 1,
      eligiblePages: 1,
      pageImpactFactor: 1,
      severityMultiplier: 2.5,
      weight: 2,
      importanceFactor: 1,
      penalty: 5,
      ruleVersionId: version.id
    }
  });

  return { project, audit, issue, page, score, rule };
}

describe('P4 SEO Intelligence', () => {
  it('builds a bounded task packet from persisted P2 facts only', async () => {
    const { project, audit, issue, page, score, rule } = await createSeoFixture();

    const input = await buildSeoAnalysisTaskInput(project.id, audit.id);
    const serialized = JSON.stringify(input.factSnapshot);

    expect(input).toMatchObject({
      projectId: project.id,
      taskType: 'SEO_AUDIT_ANALYSIS',
      requestKey: `seo-audit:${audit.id}:seo-audit-analysis-v1`,
      promptVersion: 'seo-audit-analysis-v1'
    });
    expect(input.factSnapshot).toMatchObject({
      audit: {
        id: audit.id,
        status: 'COMPLETED',
        score: 78,
        previousScore: 74,
        change: 4,
        eligiblePages: 1,
        rulesEvaluated: 20
      },
      scoreComponents: [
        expect.objectContaining({
          sourceRef: `SEO_SCORE:${score.id}`,
          ruleCode: rule.ruleCode,
          penalty: 5
        })
      ],
      issues: [
        expect.objectContaining({
          sourceRef: `SEO_ISSUE:${issue.id}`,
          title: 'Missing title',
          severity: 'HIGH',
          status: 'OPEN',
          comparison: 'NEW',
          affectedPagesCount: 1,
          affectedPages: [{ sourceRef: `PAGE:${page.id}`, url: 'https://example.com/important' }]
        })
      ]
    });
    expect(input.sourceReferences).toEqual(
      expect.arrayContaining([
        { type: 'SEO_AUDIT', id: audit.id },
        { type: 'SEO_SCORE', id: score.id },
        { type: 'SEO_ISSUE', id: issue.id },
        { type: 'PAGE', id: page.id }
      ])
    );
    expect(serialized).not.toContain('rawHtml');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('rawSecret');
    expect(serialized).not.toContain('internalOnly');
    expect(serialized).not.toContain('secret=not-sent');
    expect(serialized).not.toMatch(/traffic|ranking|cookies?/i);
  });

  it('persists and enqueues one idempotent SEO analysis task', async () => {
    const { project, audit } = await createSeoFixture();
    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);

    const first = await createSeoAnalysisTask(project.id, audit.id, service);
    const second = await createSeoAnalysisTask(project.id, audit.id, service);

    expect(second.id).toBe(first.id);
    expect(first.requestKey).toBe(`seo-audit:${audit.id}:seo-audit-analysis-v1`);
    expect(queue.calls).toHaveLength(1);
  });

  it('rejects a source reference invented by the model before persistence', async () => {
    const { project, audit } = await createSeoFixture();
    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);
    const task = await createSeoAnalysisTask(project.id, audit.id, service);
    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-v4-flash',
        responseId: 'fixture-bad-ref',
        content: JSON.stringify({
          summary: 'Summary',
          priorities: [
            {
              priority: 'HIGH',
              title: 'Invented source',
              reason: 'Should fail validation',
              sourceRefs: ['SEO_ISSUE:00000000-0000-0000-0000-000000000000']
            }
          ],
          recommendations: []
        }),
        finishReason: 'stop',
        latencyMs: 10,
        usage: {
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          cacheHitTokens: 0,
          cacheMissTokens: 10,
          reasoningTokens: null
        }
      }))
    };

    await expect(executeAiTask(task.id, { repository: new AiRepository(), gateway })).rejects.toMatchObject({
      code: 'INVALID_AI_OUTPUT'
    });
    expect(await prisma.aiAnalysisResult.count({ where: { run: { aiTaskId: task.id } } })).toBe(0);
  });

  it('accepts a schema-valid output only when every source ref was supplied', async () => {
    const { project, audit, issue } = await createSeoFixture();
    const input = await buildSeoAnalysisTaskInput(project.id, audit.id);
    const parsed = SeoAnalysisSchema.parse({
      summary: 'Focus on the deterministic title issue.',
      priorities: [
        {
          priority: 'HIGH',
          title: 'Fix the missing title',
          reason: 'The persisted audit reports it.',
          sourceRefs: [`SEO_ISSUE:${issue.id}`]
        }
      ],
      recommendations: [
        {
          title: 'Add a descriptive title',
          action: 'Update the affected page and recrawl to verify.',
          sourceRefs: [`SEO_ISSUE:${issue.id}`]
        }
      ]
    });

    expect(parsed.priorities[0]?.sourceRefs[0]).toBe(`SEO_ISSUE:${issue.id}`);
    expect(input.sourceReferences).toContainEqual({ type: 'SEO_ISSUE', id: issue.id });
  });
});
