import { describe, expect, it, vi } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

const queueModulePath = '../../src/modules/distribution/distribution.queue.js';
const workerModulePath = '../../src/modules/distribution/distribution.worker.js';
const observabilityModulePath = '../../src/modules/distribution/distribution-observability.js';

async function load(path: string, label: string) {
  const module = await import(path).catch(() => null);
  expect(module, `${label} must exist for P8-B Task 20`).not.toBeNull();
  if (!module) throw new Error(`${label} missing`);
  return module as any;
}

describe('P8-B distribution queue, worker, gates and observability', () => {
  it('uses a deterministic distribution-preparation job identity bound to target and exact source version', async () => {
    const queueModule = await load(queueModulePath, 'distribution queue module');
    const add = vi.fn(async (_name: string, _data: unknown, _opts: { jobId: string }) => ({ id: 'job-1' }));
    const queue = new queueModule.DistributionPreparationQueue({ add });

    const first = await queue.enqueue('target-123', 7);
    const second = await queue.enqueue('target-123', 7);
    await queue.enqueue('target-123', 8);

    expect(first).toEqual(second);
    expect(add).toHaveBeenCalledTimes(3);
    expect(add.mock.calls[0][0]).toBe('prepare');
    expect(add.mock.calls[0][1]).toEqual({ targetId: 'target-123', sourceContentVersion: 7 });
    expect(add.mock.calls[0][2].jobId).toBe(add.mock.calls[1][2].jobId);
    expect(add.mock.calls[2][2].jobId).not.toBe(add.mock.calls[0][2].jobId);
    expect(add.mock.calls[0][2].jobId).toMatch(/^distribution-preparation-/);
  });

  it('processes only the bounded preparation job shape through the injected service', async () => {
    const workerModule = await load(workerModulePath, 'distribution worker module');
    const prepareTargetNow = vi.fn(async () => ({ taskId: 'ai-task-1' }));

    await workerModule.processDistributionPreparationJob(
      { name: 'prepare', data: { targetId: 'target-1', sourceContentVersion: 7 } },
      { service: { prepareTargetNow } }
    );

    expect(prepareTargetNow).toHaveBeenCalledWith({ targetId: 'target-1', sourceContentVersion: 7 });
    await expect(workerModule.processDistributionPreparationJob(
      { name: 'prepare', data: { targetId: '', sourceContentVersion: 7 } },
      { service: { prepareTargetNow } }
    )).rejects.toThrow(/targetId/i);
  });

  it('keeps PUBLICATION_DISTRIBUTION Advanced+ and does not use Enterprise governance to bypass adapter capability', () => {
    expect(hasFeature('STANDARD', 'PUBLICATION_DISTRIBUTION')).toBe(false);
    expect(hasFeature('ADVANCED', 'PUBLICATION_DISTRIBUTION')).toBe(true);
    expect(hasFeature('ENTERPRISE', 'PUBLICATION_DISTRIBUTION')).toBe(true);
    expect(hasFeature('ADVANCED', 'PUBLICATION_ENTERPRISE_GOVERNANCE')).toBe(false);
    expect(hasFeature('ENTERPRISE', 'PUBLICATION_ENTERPRISE_GOVERNANCE')).toBe(true);
  });

  it('serializes only safe distribution observability fields', async () => {
    const observability = await load(observabilityModulePath, 'distribution observability module');
    const payload = observability.serializeDistributionEvent('distribution.publish.failed', {
      projectId: 'project-1',
      targetId: 'target-1',
      artifactId: 'artifact-1',
      platform: 'WORDPRESS',
      mode: 'SECONDARY_SITE',
      status: 'FAILED',
      reasonCode: 'DISTRIBUTION_PROVIDER_REJECTED',
      durationMs: 42,
      body: 'secret body',
      prompt: 'secret prompt',
      token: 'secret token',
      providerRaw: { secret: true }
    });

    expect(payload).toEqual({
      event: 'distribution.publish.failed',
      projectId: 'project-1',
      targetId: 'target-1',
      artifactId: 'artifact-1',
      platform: 'WORDPRESS',
      mode: 'SECONDARY_SITE',
      status: 'FAILED',
      reasonCode: 'DISTRIBUTION_PROVIDER_REJECTED',
      durationMs: 42
    });
    expect(JSON.stringify(payload)).not.toContain('secret');
  });
});
