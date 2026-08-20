import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import {
  VISIBILITY_TREND_PROMPT_ID,
  buildVisibilityTrendAnalysisTaskInput,
  createVisibilityTrendAnalysisTask,
  parseVisibilityTrendAnalysisOutput
} from '../../src/modules/ai/visibility-trend-analysis.js';

const projectIds: string[] = [];

async function createProject(planLevel: 'STANDARD' | 'ADVANCED', label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `Visibility Trend ${label}`,
      slug: `visibility-trend-${suffix}`,
      primaryDomain: `visibility-trend-${suffix}.example.com`,
      planLevel,
      industry: 'Traditional Culture',
      defaultLanguage: 'zh-CN',
      targetCountry: 'US'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function seedTrendFacts(projectId: string) {
  const previous = await prisma.visibilityMetricSnapshot.create({
    data: {
      projectId,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'a'.repeat(64),
      subjectSnapshotJson: { private: 'PRIVATE PREVIOUS SUBJECT ALIAS' },
      windowStart: new Date('2026-07-24T00:00:00.000Z'),
      windowEnd: new Date('2026-07-31T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-07-31T00:00:00.000Z'),
      scopeJson: { private: 'PRIVATE PREVIOUS SCOPE' },
      scopeHash: 'b'.repeat(64),
      inputFingerprint: 'c'.repeat(64),
      candidateObservationCount: 10,
      completedExtractionCount: 9,
      missingExtractionCount: 1,
      failedExtractionCount: 0,
      completedAt: new Date('2026-08-01T00:00:00.000Z')
    }
  });
  const current = await prisma.visibilityMetricSnapshot.create({
    data: {
      projectId,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'a'.repeat(64),
      subjectSnapshotJson: { private: 'PRIVATE CURRENT SUBJECT ALIAS' },
      windowStart: new Date('2026-08-01T00:00:00.000Z'),
      windowEnd: new Date('2026-08-08T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
      scopeJson: { private: 'PRIVATE CURRENT SCOPE' },
      scopeHash: 'b'.repeat(64),
      inputFingerprint: 'd'.repeat(64),
      candidateObservationCount: 10,
      completedExtractionCount: 8,
      missingExtractionCount: 2,
      failedExtractionCount: 0,
      completedAt: new Date('2026-08-09T00:00:00.000Z')
    }
  });

  const rows = [
    { metricType: 'MENTION_RATE' as const, previousStatus: 'CALCULATED' as const, previousNumerator: 2, previousDenominator: 10, currentStatus: 'CALCULATED' as const, currentNumerator: 3, currentDenominator: 10, deltaBasisPoints: 1000 },
    { metricType: 'CITATION_RATE' as const, previousStatus: 'CALCULATED' as const, previousNumerator: 4, previousDenominator: 10, currentStatus: 'UNKNOWN' as const, currentNumerator: 0, currentDenominator: 0, deltaBasisPoints: null },
    { metricType: 'MENTION_SHARE_OF_VOICE' as const, previousStatus: 'CALCULATED' as const, previousNumerator: 1, previousDenominator: 5, currentStatus: 'CALCULATED' as const, currentNumerator: 2, currentDenominator: 5, deltaBasisPoints: 2000 }
  ];

  for (const row of rows) {
    await prisma.visibilityMetricRow.createMany({
      data: [
        {
          visibilityMetricSnapshotId: previous.id,
          projectId,
          metricType: row.metricType,
          metricStatus: row.previousStatus,
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          actorType: 'OWNED_ROLLUP',
          actorKey: 'OWNED_ROLLUP',
          numerator: row.previousNumerator,
          denominator: row.previousDenominator,
          candidateObservationCount: 10,
          eligibleObservationCount: 10,
          notEligibleObservationCount: 0,
          unknownObservationCount: 0
        },
        {
          visibilityMetricSnapshotId: current.id,
          projectId,
          metricType: row.metricType,
          metricStatus: row.currentStatus,
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          actorType: 'OWNED_ROLLUP',
          actorKey: 'OWNED_ROLLUP',
          numerator: row.currentNumerator,
          denominator: row.currentDenominator,
          candidateObservationCount: 10,
          eligibleObservationCount: row.currentStatus === 'CALCULATED' ? 10 : 8,
          notEligibleObservationCount: 0,
          unknownObservationCount: row.currentStatus === 'UNKNOWN' ? 2 : 0
        }
      ]
    });
  }

  const comparison = await prisma.visibilityMetricComparison.create({
    data: {
      projectId,
      comparisonVersion: 'VISIBILITY_COMPARISON_V1',
      currentSnapshotId: current.id,
      previousSnapshotId: previous.id,
      windowDurationMs: 604_800_000n,
      gapDurationMs: 86_400_000n
    }
  });
  await prisma.visibilityMetricDeltaRow.createMany({
    data: rows.map((row) => ({
      visibilityMetricComparisonId: comparison.id,
      projectId,
      metricType: row.metricType,
      dimensionType: 'OVERALL' as const,
      dimensionKey: 'OVERALL',
      actorType: 'OWNED_ROLLUP' as const,
      actorKey: 'OWNED_ROLLUP',
      previousMetricStatus: row.previousStatus,
      currentMetricStatus: row.currentStatus,
      previousNumerator: row.previousNumerator,
      previousDenominator: row.previousDenominator,
      currentNumerator: row.currentNumerator,
      currentDenominator: row.currentDenominator,
      deltaBasisPoints: row.deltaBasisPoints
    }))
  });

  const rule = await prisma.visibilityAlertRule.create({
    data: {
      projectId,
      ruleType: 'OWNED_CITATION_RATE_DROP',
      name: 'Citation became unknown',
      severity: 'WARNING',
      thresholdBasisPoints: 100
    }
  });
  const alert = await prisma.visibilityAlertEvent.create({
    data: {
      projectId,
      alertRuleId: rule.id,
      comparisonId: comparison.id,
      actorKey: 'OWNED_ROLLUP',
      eventFingerprint: `trend-${projectId}`,
      status: 'OPEN',
      severity: 'WARNING',
      reasonCode: 'METRIC_BECAME_UNKNOWN',
      deltaBasisPoints: null,
      previousMetricStatus: 'CALCULATED',
      currentMetricStatus: 'UNKNOWN',
      triggeredAt: new Date('2026-08-09T01:00:00.000Z')
    }
  });

  return { previous, current, comparison, alert };
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.aiTask.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.visibilityAlertEvent.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.visibilityAlertRule.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.visibilityMetricComparison.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.visibilityMetricRow.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.visibilityMetricSnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P6-D VISIBILITY_TREND_ANALYSIS', () => {
  it('builds a bounded safe packet and validates every returned source reference', async () => {
    const project = await createProject('ADVANCED', 'packet');
    const seeded = await seedTrendFacts(project.id);

    const input = await buildVisibilityTrendAnalysisTaskInput(project.id, seeded.comparison.id);
    expect(input.taskType).toBe('VISIBILITY_TREND_ANALYSIS');
    expect(input.promptVersion).toBe(VISIBILITY_TREND_PROMPT_ID);
    const packet = JSON.stringify(input.factSnapshot);
    expect(packet).toContain(seeded.current.id);
    expect(packet).toContain(seeded.previous.id);
    expect(packet).toContain(seeded.comparison.id);
    expect(packet).toContain(seeded.alert.id);
    expect(packet).not.toContain('PRIVATE CURRENT SUBJECT ALIAS');
    expect(packet).not.toContain('PRIVATE PREVIOUS SUBJECT ALIAS');
    expect(packet).not.toContain('PRIVATE CURRENT SCOPE');
    expect(packet).not.toContain('subjectSnapshotJson');
    expect(packet).not.toContain('scopeJson');
    expect(packet).not.toContain('reasoning');
    expect((input.factSnapshot as any).comparison.deltas).toHaveLength(3);
    expect((input.factSnapshot as any).alerts.length).toBeLessThanOrEqual(20);

    const refs = input.sourceReferences as any[];
    const comparisonRef = `VISIBILITY_METRIC_COMPARISON:${seeded.comparison.id}`;
    const currentRef = `VISIBILITY_METRIC_SNAPSHOT:${seeded.current.id}`;
    const valid = JSON.stringify({
      summary: 'Mention rate improved while citation evidence became unavailable.',
      trends: [{ metricType: 'MENTION_RATE', direction: 'IMPROVED', explanation: 'The supplied delta is positive.', sourceRefs: [comparisonRef, currentRef] }],
      priorities: [{ priority: 'HIGH', action: 'Investigate citation evidence coverage.', rationale: 'Citation Rate changed to UNKNOWN.', sourceRefs: [comparisonRef] }],
      caveats: ['UNKNOWN is unavailable evidence, not zero.'],
      sourceReferences: [comparisonRef, currentRef]
    });
    expect(parseVisibilityTrendAnalysisOutput(valid, refs).summary).toContain('Mention rate improved');
    expect(() => parseVisibilityTrendAnalysisOutput(valid.replace(currentRef, 'VISIBILITY_METRIC_SNAPSHOT:invented'), refs)).toThrow();
  });

  it('persists DeepSeek output only as advisory AI result and leaves deterministic P6 facts unchanged', async () => {
    const project = await createProject('ADVANCED', 'worker');
    const seeded = await seedTrendFacts(project.id);
    const input = await buildVisibilityTrendAnalysisTaskInput(project.id, seeded.comparison.id);
    const task = await createVisibilityTrendAnalysisTask(project.id, seeded.comparison.id, {
      createAndEnqueue: async (taskInput: any) => prisma.aiTask.create({ data: taskInput })
    } as any);

    const before = {
      snapshots: await prisma.visibilityMetricSnapshot.count({ where: { projectId: project.id } }),
      rows: await prisma.visibilityMetricRow.count({ where: { projectId: project.id } }),
      comparisons: await prisma.visibilityMetricComparison.count({ where: { projectId: project.id } }),
      alerts: await prisma.visibilityAlertEvent.count({ where: { projectId: project.id } })
    };
    const refs = input.sourceReferences as any[];
    const comparisonRef = `VISIBILITY_METRIC_COMPARISON:${seeded.comparison.id}`;
    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-reasoner',
        responseId: 'visibility-trend-fixture',
        content: JSON.stringify({
          summary: 'Visibility trend explanation grounded in persisted facts.',
          trends: [{ metricType: 'MENTION_RATE', direction: 'IMPROVED', explanation: 'Mention Rate increased.', sourceRefs: [comparisonRef] }],
          priorities: [],
          caveats: ['Citation Rate is UNKNOWN and must not be treated as zero.'],
          sourceReferences: [comparisonRef]
        }),
        finishReason: 'stop',
        latencyMs: 100,
        usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130, cacheHitTokens: 0, cacheMissTokens: 100, reasoningTokens: 20 }
      }))
    };

    await executeAiTask(task.id, { repository: new AiRepository(), gateway });

    const stored = await prisma.aiTask.findUniqueOrThrow({ where: { id: task.id }, include: { runs: { include: { result: true } } } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.taskType).toBe('VISIBILITY_TREND_ANALYSIS');
    expect(stored.runs[0]?.result).toMatchObject({
      resultType: 'VISIBILITY_TREND_ANALYSIS',
      summary: 'Visibility trend explanation grounded in persisted facts.',
      provider: 'DEEPSEEK',
      promptVersion: VISIBILITY_TREND_PROMPT_ID
    });
    expect(await prisma.visibilityMetricSnapshot.count({ where: { projectId: project.id } })).toBe(before.snapshots);
    expect(await prisma.visibilityMetricRow.count({ where: { projectId: project.id } })).toBe(before.rows);
    expect(await prisma.visibilityMetricComparison.count({ where: { projectId: project.id } })).toBe(before.comparisons);
    expect(await prisma.visibilityAlertEvent.count({ where: { projectId: project.id } })).toBe(before.alerts);
    expect(JSON.stringify(stored.runs[0]?.result?.structuredOutput)).not.toContain('PRIVATE CURRENT SUBJECT ALIAS');
    expect(refs.length).toBeGreaterThan(0);
  });

  it('rejects Standard before any trend-analysis comparison read or AI enqueue', async () => {
    const project = await createProject('STANDARD', 'gate');
    const app = createApp();
    await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/history/comparisons/00000000-0000-0000-0000-000000000000/trend-analysis`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));
  });
});
