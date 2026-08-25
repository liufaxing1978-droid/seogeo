import type { AiTask } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { executeAiTask, processAiJob } from '../../src/modules/ai/ai.worker.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000010';
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000020';
const PROFILE_ID = '00000000-0000-4000-8000-000000000030';

function v2Task(historicalRankAdjustment: number, taskId: string): AiTask {
  return {
    id: taskId,
    projectId: PROJECT_ID,
    taskType: 'OPTIMIZATION_PLAN_RANKING',
    status: 'QUEUED',
    requestKey: `request-${taskId}`,
    promptVersion: 'optimization-plan-ranking-v1',
    factSnapshot: {
      version: 'OPTIMIZATION_PLAN_RANKING_FACTS_V2',
      planVersion: 'OPTIMIZATION_PLAN_V2',
      authority: 'P9_A_FIRST_PARTY_PLANNER',
      candidates: [{
        candidateId: CANDIDATE_ID,
        candidateKey: 'a'.repeat(64),
        deterministicRank: 1,
        recommendedActionType: 'ON_PAGE_OPTIMIZATION',
        market: {
          marketScopeMode: 'UNCONFIGURED_LEGACY',
          marketCode: null,
          locale: null,
        },
        growth: {
          opportunityType: 'RANKING_UPSIDE',
          score: 90,
          priority: 'HIGH',
          evidenceQuality: 'COMPLETE',
          evidenceCoverage: 1,
        },
        advisoryContext: [],
        sourceFactReferences: [{ type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: SNAPSHOT_ID }],
        feedback: {
          profileId: PROFILE_ID,
          profileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
          inputFingerprint: 'f'.repeat(64),
          sampleCount: 5,
          historicalRankAdjustment,
        },
      }],
    },
    sourceReferences: [{ type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: SNAPSHOT_ID }],
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  } as AiTask;
}

async function executePromptProbe(historicalRankAdjustment: number, suffix: string) {
  const task = v2Task(
    historicalRankAdjustment,
    `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
  );
  const createRun = vi.fn(async (input: { requestHash: string }) => ({
    id: `00000000-0000-4000-8000-${String(Number(suffix) + 100).padStart(12, '0')}`,
    ...input,
  }));
  const completeRun = vi.fn(async () => undefined);
  const repository = {
    getTask: vi.fn(async () => task),
    claimQueuedTask: vi.fn(async () => true),
    countRuns: vi.fn(async () => 0),
    createRun,
    recordProviderSuccess: vi.fn(async () => undefined),
    completeRun,
    failRun: vi.fn(async () => undefined),
    markTaskFailed: vi.fn(async () => undefined),
  };
  const gateway = {
    complete: vi.fn(async (request: { messages: Array<{ role: string; content: string }> }) => ({
      provider: 'DEEPSEEK' as const,
      model: 'deepseek-reasoner',
      responseId: `response-${suffix}`,
      content: JSON.stringify({
        adjustments: [{
          candidateId: CANDIDATE_ID,
          adjustment: 0,
          explanation: 'No AI change.',
          sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_ID}`],
        }],
        sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_ID}`],
      }),
      finishReason: 'stop',
      latencyMs: 10,
      usage: {
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        cacheHitTokens: 0,
        cacheMissTokens: 10,
        reasoningTokens: 5,
      },
    })),
  };

  await executeAiTask(task.id, {
    repository: repository as never,
    gateway,
    observability: { emit: vi.fn() } as never,
  });

  const request = gateway.complete.mock.calls[0]![0];
  const userMessage = request.messages.find((message) => message.role === 'user')!.content;
  const requestHash = createRun.mock.calls[0]![0].requestHash;
  return { userMessage, requestHash };
}

describe('P4 AI BullMQ worker', () => {
  it('requires a taskId', async () => {
    await expect(processAiJob({ data: {} as { taskId: string } }, vi.fn())).rejects.toThrow(/taskId is required/i);
  });

  it('delegates exactly one durable task execution', async () => {
    const execute = vi.fn(async (_taskId: string) => undefined);

    await processAiJob({ data: { taskId: 'task-fixture' } }, execute);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('task-fixture');
  });

  it('keeps frozen V2 feedback in request identity but removes it from the DeepSeek prompt', async () => {
    const negative = await executePromptProbe(-4, '1');
    const positive = await executePromptProbe(4, '2');

    expect(negative.requestHash).not.toBe(positive.requestHash);
    expect(negative.userMessage).toBe(positive.userMessage);
    expect(negative.userMessage).toContain('OPTIMIZATION_PLAN_RANKING_FACTS_V2');
    expect(negative.userMessage).toContain('OPTIMIZATION_PLAN_V2');
    expect(negative.userMessage).not.toContain('"feedback"');
    expect(negative.userMessage).not.toContain(PROFILE_ID);
    expect(negative.userMessage).not.toContain('f'.repeat(64));
    expect(negative.userMessage).not.toContain('historicalRankAdjustment');
    expect(negative.userMessage).not.toContain('sampleCount');
  });
});
