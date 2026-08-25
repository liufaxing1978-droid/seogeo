import { describe, expect, it, vi } from 'vitest';
import {
  processPublicationVerificationJob,
  type PublicationVerificationWorkerDeps
} from '../../src/modules/publication/publication-verification.worker.js';

const EXECUTION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const URL = 'https://xingshantang.org/news/p9-d-handoff';

function verifiedDeps(overrides: Partial<PublicationVerificationWorkerDeps> = {}) {
  return {
    loadContext: vi.fn().mockResolvedValue({
      execution: {
        id: EXECUTION_ID,
        projectId: PROJECT_ID,
        status: 'DEPLOYED'
      },
      expectation: {
        url: URL,
        title: null,
        metaDescription: null,
        canonical: null,
        h1: null,
        indexable: true,
        schemaTypes: [],
        contentFingerprint: null
      }
    }),
    fetchTarget: vi.fn().mockResolvedValue({
      status: 200,
      url: URL,
      body: '<html><head><title>Published</title></head><body><main><p>Verified.</p></main></body></html>'
    }),
    transition: vi.fn().mockResolvedValue(true),
    persistFinal: vi.fn().mockResolvedValue(true),
    persistObservation: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-08-24T12:00:00.000Z'),
    emit: vi.fn(),
    ...overrides
  } satisfies PublicationVerificationWorkerDeps;
}

describe('P8 -> P9-D post-VERIFIED handoff boundary', () => {
  it('calls onVerified only after the durable VERIFIED transition succeeds', async () => {
    const onVerified = vi.fn().mockResolvedValue(undefined);
    const persistFinal = vi.fn().mockResolvedValue(true);
    const deps = verifiedDeps({ persistFinal, onVerified });

    await processPublicationVerificationJob(
      { name: 'verify', data: { executionId: EXECUTION_ID } },
      deps
    );

    expect(persistFinal).toHaveBeenCalledTimes(1);
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onVerified).toHaveBeenCalledWith({
      executionId: EXECUTION_ID,
      projectId: PROJECT_ID
    });
    expect(persistFinal.mock.invocationCallOrder[0]).toBeLessThan(onVerified.mock.invocationCallOrder[0]!);
  });

  it('does not hand off when the durable VERIFIED transition loses the state race', async () => {
    const onVerified = vi.fn().mockResolvedValue(undefined);
    const deps = verifiedDeps({
      persistFinal: vi.fn().mockResolvedValue(false),
      onVerified
    });

    await processPublicationVerificationJob(
      { name: 'verify', data: { executionId: EXECUTION_ID } },
      deps
    );

    expect(onVerified).not.toHaveBeenCalled();
  });

  it('swallows a P9-D handoff failure after VERIFIED and emits a bounded failure event', async () => {
    const emit = vi.fn();
    const deps = verifiedDeps({
      onVerified: vi.fn().mockRejectedValue(new Error('redis unavailable secret=do-not-log')),
      emit
    });

    await expect(processPublicationVerificationJob(
      { name: 'verify', data: { executionId: EXECUTION_ID } },
      deps
    )).resolves.toBeUndefined();

    expect(emit).toHaveBeenCalledWith({
      event: 'optimization.experiment.handoff.failed',
      executionId: EXECUTION_ID,
      projectId: PROJECT_ID
    });
    expect(JSON.stringify(emit.mock.calls)).not.toContain('redis unavailable');
    expect(JSON.stringify(emit.mock.calls)).not.toContain('do-not-log');
  });
});
