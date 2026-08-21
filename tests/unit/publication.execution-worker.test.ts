import { describe, expect, it } from 'vitest';
import {
  PUBLICATION_EXECUTION_MAX_ATTEMPTS,
  PUBLICATION_EXECUTION_QUEUE_NAME,
  buildPublicationExecutionJobId,
  buildPublicationExecutionJobOptions
} from '../../src/modules/publication/publication-execution.queue.js';
import {
  PUBLICATION_EXECUTION_WORKER_CONCURRENCY,
  classifyPublicationExecutionError,
  processPublicationExecutionJob,
  type PublicationExecutionContext,
  type PublicationExecutionTransition,
  type PublicationExecutionWorkerDeps
} from '../../src/modules/publication/publication-execution.worker.js';
import type {
  MutationAdapter,
  MutationApplyResult,
  MutationPreview,
  TargetRef,
  TargetSnapshot
} from '../../src/modules/publication/mutation-adapter.js';

const BASE_SHA = '1111111111111111111111111111111111111111';
const CONTENT_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const PLAN_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PREVIEW_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PATH = 'content/culture/liuren.md';

function context(overrides: Partial<PublicationExecutionContext> = {}): PublicationExecutionContext {
  return {
    execution: {
      id: 'execution-1',
      projectId: 'project-1',
      executionKey: 'execution-key-1',
      status: 'APPROVED',
      branchName: null,
      commitSha: null,
      pullRequestNo: null,
      pullRequestUrl: null
    },
    planLevel: 'ADVANCED',
    site: {
      id: 'site-1',
      enabled: true,
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR'
    },
    plan: {
      id: 'plan-1',
      projectId: 'project-1',
      draftId: 'draft-1',
      draftVersion: 1,
      version: 1,
      planHash: PLAN_HASH,
      baseSha: BASE_SHA,
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      targetBlobHashes: { [PATH]: 'blob-a' },
      operations: [{
        type: 'UPDATE_CONTENT_PAGE',
        path: PATH,
        targetUrl: 'https://xingshantang.org/culture/liuren',
        contentHash: CONTENT_HASH,
        content: '# 六壬文化\n\nnew body'
      }],
      riskClass: 'LOW'
    },
    preview: {
      id: 'preview-1',
      planId: 'plan-1',
      projectId: 'project-1',
      previewHash: PREVIEW_HASH,
      validationResult: {
        canCreatePlan: true,
        warningCodes: [],
        blockingCodes: [],
        unconfirmedWarningCodes: []
      },
      diffPayload: {
        unifiedDiff: `--- a/${PATH}\n+++ b/${PATH}\n-old\n+new`
      }
    },
    approval: {
      id: 'approval-1',
      projectId: 'project-1',
      planId: 'plan-1',
      planVersion: 1,
      planHash: PLAN_HASH,
      contentVersion: 1,
      contentHash: CONTENT_HASH,
      previewHash: PREVIEW_HASH,
      baseSha: BASE_SHA,
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      targetBlobHashes: { [PATH]: 'blob-a' },
      approverActorId: 'approver-1',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: [],
      expiresAt: null
    },
    approvedPlan: {
      publicationId: 'execution-1',
      planId: 'plan-1',
      planHash: PLAN_HASH,
      previewHash: PREVIEW_HASH,
      contentHash: CONTENT_HASH,
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      branch: 'main',
      baseSha: BASE_SHA,
      touchedBlobShas: { [PATH]: 'blob-a' },
      riskClass: 'LOW',
      operations: [{
        type: 'UPDATE_CONTENT_PAGE',
        path: PATH,
        targetUrl: 'https://xingshantang.org/culture/liuren',
        contentHash: CONTENT_HASH,
        content: '# 六壬文化\n\nnew body'
      }],
      unifiedDiff: `--- a/${PATH}\n+++ b/${PATH}\n-old\n+new`
    },
    ...overrides
  };
}

class FakeAdapter implements MutationAdapter {
  readonly capability = 'DRAFT_PR' as const;
  reads = 0;
  applies = 0;
  snapshot: TargetSnapshot = {
    repositoryIdentity: 'liufaxing1978-droid/xingshantang',
    branch: 'main',
    headSha: BASE_SHA,
    touchedBlobShas: { [PATH]: 'blob-a' }
  };
  result: MutationApplyResult = {
    capability: 'DRAFT_PR',
    status: 'APPLIED',
    remoteWritePerformed: true,
    branchName: 'seogeo/p8/execution-1-aaaaaaaaaaaa',
    commitSha: '2222222222222222222222222222222222222222',
    pullRequestNo: 42,
    pullRequestUrl: 'https://github.com/liufaxing1978-droid/xingshantang/pull/42'
  };

  async readTargetSnapshot(_input: TargetRef) {
    this.reads += 1;
    return this.snapshot;
  }

  async preview(): Promise<MutationPreview> {
    throw new Error('preview is not part of worker execution');
  }

  async apply() {
    this.applies += 1;
    return this.result;
  }

  async readExecutionState() {
    return { status: 'PENDING' as const, remoteStateKnown: false };
  }

  async rollback() {
    return { status: 'READY' as const, strategy: 'REVERT_COMMIT', remoteWritePerformed: false };
  }
}

function depsFor(
  workerContext: PublicationExecutionContext,
  adapter: FakeAdapter | null
) {
  const transitions: PublicationExecutionTransition[] = [];
  const deps: PublicationExecutionWorkerDeps = {
    loadContext: async () => workerContext,
    resolveAdapter: () => adapter,
    transition: async (transition) => {
      transitions.push(transition);
      workerContext.execution.status = transition.toStatus;
      if (transition.patch?.branchName !== undefined) workerContext.execution.branchName = transition.patch.branchName;
      if (transition.patch?.commitSha !== undefined) workerContext.execution.commitSha = transition.patch.commitSha;
      if (transition.patch?.pullRequestNo !== undefined) workerContext.execution.pullRequestNo = transition.patch.pullRequestNo;
      if (transition.patch?.pullRequestUrl !== undefined) workerContext.execution.pullRequestUrl = transition.patch.pullRequestUrl;
      return true;
    },
    emit: () => undefined
  };
  return { deps, transitions };
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ code });
}

describe('P8-A execution queue contract', () => {
  it('uses deterministic queue name, worker concurrency and job identity', () => {
    expect(PUBLICATION_EXECUTION_QUEUE_NAME).toBe('site-mutation-execution');
    expect(PUBLICATION_EXECUTION_WORKER_CONCURRENCY).toBe(2);
    expect(PUBLICATION_EXECUTION_MAX_ATTEMPTS).toBe(2);
    expect(buildPublicationExecutionJobId('execution-key-1')).toBe(
      'site-mutation-execution-execution-key-1'
    );
    expect(buildPublicationExecutionJobOptions('execution-key-1')).toMatchObject({
      jobId: 'site-mutation-execution-execution-key-1',
      attempts: 2
    });
  });

  it('retries only explicitly transient provider failures', () => {
    expect(classifyPublicationExecutionError('PROVIDER_RATE_LIMITED')).toBe('RETRYABLE');
    expect(classifyPublicationExecutionError('PROVIDER_TRANSIENT_ERROR')).toBe('RETRYABLE');
    for (const code of [
      'FEATURE_NOT_AVAILABLE',
      'MUTATION_NOT_CONFIGURED',
      'APPROVAL_STALE',
      'TARGET_REVISION_CHANGED',
      'VALIDATION_FAILED',
      'WRITE_PERMISSION_DENIED'
    ]) {
      expect(classifyPublicationExecutionError(code)).toBe('NON_RETRYABLE');
    }
  });
});

describe('P8-A execution worker fail-before-side-effect', () => {
  it('rejects unavailable plan feature before adapter read or write', async () => {
    const adapter = new FakeAdapter();
    const workerContext = context({ planLevel: 'STANDARD' });
    const { deps, transitions } = depsFor(workerContext, adapter);

    await expectCode(
      processPublicationExecutionJob({ name: 'execute', data: { executionId: 'execution-1' } }, deps),
      'FEATURE_NOT_AVAILABLE'
    );
    expect(adapter.reads).toBe(0);
    expect(adapter.applies).toBe(0);
    expect(transitions.at(-1)).toMatchObject({ toStatus: 'FAILED', reasonCode: 'FEATURE_NOT_AVAILABLE' });
  });

  it('rejects stale stored approval before resolving target state', async () => {
    const adapter = new FakeAdapter();
    const workerContext = context();
    workerContext.approval.planHash = 'stale-plan-hash';
    const { deps, transitions } = depsFor(workerContext, adapter);

    await expectCode(
      processPublicationExecutionJob({ name: 'execute', data: { executionId: 'execution-1' } }, deps),
      'APPROVAL_STALE'
    );
    expect(adapter.reads).toBe(0);
    expect(adapter.applies).toBe(0);
    expect(transitions.at(-1)).toMatchObject({ toStatus: 'APPROVAL_STALE', reasonCode: 'APPROVAL_STALE' });
  });

  it('rejects missing adapter before any remote side effect', async () => {
    const workerContext = context();
    const { deps, transitions } = depsFor(workerContext, null);

    await expectCode(
      processPublicationExecutionJob({ name: 'execute', data: { executionId: 'execution-1' } }, deps),
      'MUTATION_NOT_CONFIGURED'
    );
    expect(transitions.at(-1)).toMatchObject({ toStatus: 'FAILED', reasonCode: 'MUTATION_NOT_CONFIGURED' });
  });

  it('maps live target drift to TARGET_REVISION_CHANGED before apply', async () => {
    const adapter = new FakeAdapter();
    adapter.snapshot = { ...adapter.snapshot, headSha: '9999999999999999999999999999999999999999' };
    const workerContext = context();
    const { deps, transitions } = depsFor(workerContext, adapter);

    await expectCode(
      processPublicationExecutionJob({ name: 'execute', data: { executionId: 'execution-1' } }, deps),
      'TARGET_REVISION_CHANGED'
    );
    expect(adapter.reads).toBe(1);
    expect(adapter.applies).toBe(0);
    expect(transitions.at(-1)).toMatchObject({
      toStatus: 'TARGET_REVISION_CHANGED',
      reasonCode: 'TARGET_REVISION_CHANGED'
    });
  });

  it('advances APPROVED -> QUEUED -> EXECUTING -> PR_CREATED with append-only transition intents', async () => {
    const adapter = new FakeAdapter();
    const workerContext = context();
    const { deps, transitions } = depsFor(workerContext, adapter);

    await expect(
      processPublicationExecutionJob({ name: 'execute', data: { executionId: 'execution-1' } }, deps)
    ).resolves.toBeUndefined();

    expect(adapter.reads).toBe(1);
    expect(adapter.applies).toBe(1);
    expect(transitions.map((entry) => [entry.fromStatus, entry.toStatus, entry.eventType])).toEqual([
      ['APPROVED', 'QUEUED', 'QUEUED'],
      ['QUEUED', 'EXECUTING', 'STARTED'],
      ['EXECUTING', 'PR_CREATED', 'PR_CREATED']
    ]);
    expect(transitions[2]?.patch).toMatchObject({
      branchName: 'seogeo/p8/execution-1-aaaaaaaaaaaa',
      commitSha: '2222222222222222222222222222222222222222',
      pullRequestNo: 42
    });
  });

  it('does nothing for a duplicate delivery already at PR_CREATED', async () => {
    const adapter = new FakeAdapter();
    const workerContext = context({
      execution: {
        id: 'execution-1',
        projectId: 'project-1',
        executionKey: 'execution-key-1',
        status: 'PR_CREATED',
        branchName: 'seogeo/p8/execution-1-aaaaaaaaaaaa',
        commitSha: '2222222222222222222222222222222222222222',
        pullRequestNo: 42,
        pullRequestUrl: 'https://github.com/liufaxing1978-droid/xingshantang/pull/42'
      }
    });
    const { deps, transitions } = depsFor(workerContext, adapter);

    await expect(
      processPublicationExecutionJob({ name: 'execute', data: { executionId: 'execution-1' } }, deps)
    ).resolves.toBeUndefined();
    expect(adapter.reads).toBe(0);
    expect(adapter.applies).toBe(0);
    expect(transitions).toHaveLength(0);
  });
});
