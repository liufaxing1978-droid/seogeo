import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  OPTIMIZATION_FEEDBACK_PROJECT_RECONCILE_LIMIT,
  OPTIMIZATION_FEEDBACK_RECONCILE_DAYS,
  processOptimizationFeedbackJob,
  type OptimizationFeedbackWorkerDeps
} from '../../src/modules/optimization-feedback/feedback.worker.js';

describe('P9-E feedback worker', () => {
  it('materializes exactly one durable observation job', async () => {
    const service = {
      materializeObservation: vi.fn().mockResolvedValue({
        kind: 'DEFERRED',
        reasonCode: 'FEEDBACK_TERMINAL_OBSERVATION_PENDING'
      })
    };
    const repository = {
      listFeedbackEnabledProjectIds: vi.fn(),
      listRecentTerminalCandidates: vi.fn()
    };
    const queue = { enqueueObservation: vi.fn() };
    const observability = { emit: vi.fn() };

    await processOptimizationFeedbackJob(
      {
        name: 'materialize-observation',
        data: {
          kind: 'MATERIALIZE_OBSERVATION',
          projectId: 'project-1',
          experimentId: 'experiment-1',
          observationId: 'observation-1'
        }
      },
      { service, repository, queue, observability } as unknown as OptimizationFeedbackWorkerDeps
    );

    expect(service.materializeObservation).toHaveBeenCalledTimes(1);
    expect(service.materializeObservation).toHaveBeenCalledWith({
      projectId: 'project-1',
      experimentId: 'experiment-1',
      observationId: 'observation-1'
    });
    expect(repository.listFeedbackEnabledProjectIds).not.toHaveBeenCalled();
    expect(queue.enqueueObservation).not.toHaveBeenCalled();
  });

  it('reconciles stable project order with exact 90-day cutoff and 100-candidate bound', async () => {
    const now = new Date('2026-08-25T00:00:00.000Z');
    const expectedCutoff = new Date('2026-05-27T00:00:00.000Z');
    const service = { materializeObservation: vi.fn() };
    const repository = {
      listFeedbackEnabledProjectIds: vi.fn().mockResolvedValue(['project-b', 'project-a']),
      listRecentTerminalCandidates: vi.fn()
        .mockResolvedValueOnce([
          { projectId: 'project-a', experimentId: 'experiment-a', observationId: 'observation-a' }
        ])
        .mockResolvedValueOnce([
          { projectId: 'project-b', experimentId: 'experiment-b', observationId: 'observation-b' }
        ])
    };
    const queue = { enqueueObservation: vi.fn().mockResolvedValue(undefined) };
    const observability = { emit: vi.fn() };

    await processOptimizationFeedbackJob(
      { name: 'reconcile-daily', data: { kind: 'RECONCILE_DAILY' } },
      {
        service,
        repository,
        queue,
        observability,
        now: () => now
      } as unknown as OptimizationFeedbackWorkerDeps
    );

    expect(OPTIMIZATION_FEEDBACK_RECONCILE_DAYS).toBe(90);
    expect(OPTIMIZATION_FEEDBACK_PROJECT_RECONCILE_LIMIT).toBe(100);
    expect(repository.listFeedbackEnabledProjectIds).toHaveBeenCalledTimes(1);
    expect(repository.listRecentTerminalCandidates.mock.calls).toEqual([
      [{ projectId: 'project-a', createdAtGte: expectedCutoff, limit: 100 }],
      [{ projectId: 'project-b', createdAtGte: expectedCutoff, limit: 100 }]
    ]);
    expect(queue.enqueueObservation.mock.calls).toEqual([
      ['project-a', 'experiment-a', 'observation-a'],
      ['project-b', 'experiment-b', 'observation-b']
    ]);
    expect(service.materializeObservation).not.toHaveBeenCalled();
    expect(observability.emit.mock.calls).toEqual([
      [{ event: 'optimization.feedback.reconciled', projectId: 'project-a' }],
      [{ event: 'optimization.feedback.reconciled', projectId: 'project-b' }]
    ]);
    expect(queue.enqueueObservation.mock.invocationCallOrder[0])
      .toBeLessThan(observability.emit.mock.invocationCallOrder[0]!);
    expect(queue.enqueueObservation.mock.invocationCallOrder[1])
      .toBeLessThan(observability.emit.mock.invocationCallOrder[1]!);
  });

  it('has no external provider, AI, Git, or publication mutation dependency', () => {
    const source = readFileSync(
      new URL('../../src/modules/optimization-feedback/feedback.worker.ts', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/from ['"][^'"]*\/(?:ai|search-facts|search-providers|visibility|publication)\//);
    expect(source.toLowerCase()).not.toContain('deepseek');
    expect(source.toLowerCase()).not.toContain('github');
  });
});
