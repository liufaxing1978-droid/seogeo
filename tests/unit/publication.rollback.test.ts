import { describe, expect, it, vi } from 'vitest';
import { PublicationRollbackPlanner } from '../../src/modules/publication/publication-rollback.js';

const ORIGINAL_BASE = '1111111111111111111111111111111111111111';
const CURRENT_BASE = '2222222222222222222222222222222222222222';
const COMMIT_SHA = '3333333333333333333333333333333333333333';
const PLAN_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PREVIEW_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PATH = 'content/culture/rollback-test.md';

function executionContext() {
  return {
    id: 'execution-1',
    projectId: 'project-1',
    status: 'VERIFICATION_FAILED',
    commitSha: COMMIT_SHA,
    branchName: 'seogeo/p8/rollback-test',
    pullRequestNo: 88,
    plan: {
      id: 'plan-1',
      projectId: 'project-1',
      proposalId: 'proposal-1',
      draftId: 'draft-1',
      draftVersion: 1,
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      baseSha: ORIGINAL_BASE,
      targetBlobHashes: { [PATH]: 'old-blob' },
      operations: [{ type: 'UPDATE_CONTENT_PAGE', path: PATH, content: '# approved' }],
      expectedOutcomes: { publicUrl: 'https://xingshantang.org/culture/rollback-test' },
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: PLAN_HASH,
      preview: {
        id: 'preview-1',
        previewHash: PREVIEW_HASH,
        diffPayload: { unifiedDiff: '--- a/file\n+++ b/file\n-old\n+approved' }
      }
    }
  };
}

function deps() {
  const repository = {
    getExecutionRollbackContext: vi.fn(async () => executionContext()),
    getVerificationRepairContext: vi.fn(async () => ({
      id: 'verification-1',
      projectId: 'project-1',
      status: 'FAILED',
      reasonCode: 'NOINDEX_DETECTED',
      execution: executionContext()
    })),
    createRollbackProposal: vi.fn(async (input: Record<string, unknown>) => ({
      id: 'rollback-1',
      status: 'PROPOSED',
      ...input
    }))
  };
  const adapter = {
    capability: 'DRAFT_PR' as const,
    readTargetSnapshot: vi.fn(async () => ({
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      branch: 'main',
      headSha: CURRENT_BASE,
      touchedBlobShas: { [PATH]: 'current-blob' }
    })),
    rollback: vi.fn(async () => ({
      status: 'READY' as const,
      strategy: 'REVERT_COMMIT',
      remoteWritePerformed: false,
      artifactSha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    }))
  };
  return { repository, adapter };
}

describe('P8-A repair and rollback planner', () => {
  it('creates a reviewable rollback proposal bound to the exact execution, commit and original plan', async () => {
    const { repository, adapter } = deps();
    const planner = new PublicationRollbackPlanner({ repository: repository as never, adapter: adapter as never });

    const proposal = await planner.createRollbackProposal('execution-1', 'approver-2');

    expect(adapter.rollback).toHaveBeenCalledTimes(1);
    expect(repository.createRollbackProposal).toHaveBeenCalledTimes(1);
    expect(proposal).toMatchObject({
      executionId: 'execution-1',
      strategy: 'REVERT_COMMIT',
      status: 'PROPOSED',
      proposedBy: 'approver-2'
    });
    expect(proposal.payload).toMatchObject({
      kind: 'ROLLBACK',
      requiresFreshApproval: true,
      remoteWritePerformed: false,
      source: {
        executionId: 'execution-1',
        commitSha: COMMIT_SHA,
        planId: 'plan-1',
        planHash: PLAN_HASH,
        previewHash: PREVIEW_HASH
      },
      plan: {
        baseSha: CURRENT_BASE,
        originalBaseSha: ORIGINAL_BASE,
        forceReset: false,
        autoMerge: false,
        operations: [{
          type: 'REVERT_COMMIT',
          commitSha: COMMIT_SHA
        }]
      }
    });
  });

  it('uses the current repository base after post-publication changes and never force-resets history', async () => {
    const { repository, adapter } = deps();
    const planner = new PublicationRollbackPlanner({ repository: repository as never, adapter: adapter as never });

    const proposal = await planner.createRollbackProposal('execution-1', 'approver-2');
    const payload = proposal.payload as any;

    expect(payload.plan.baseSha).toBe(CURRENT_BASE);
    expect(payload.plan.originalBaseSha).toBe(ORIGINAL_BASE);
    expect(payload.plan.baseSha).not.toBe(payload.plan.originalBaseSha);
    expect(payload.plan.forceReset).toBe(false);
    expect(payload.plan.autoMerge).toBe(false);
    expect(payload.plan.touchedBlobShas).toEqual({ [PATH]: 'current-blob' });
  });

  it('creates a repair proposal without directly invoking adapter rollback', async () => {
    const { repository, adapter } = deps();
    const planner = new PublicationRollbackPlanner({ repository: repository as never, adapter: adapter as never });

    const proposal = await planner.createRepairProposal('verification-1', 'editor-2');

    expect(adapter.rollback).not.toHaveBeenCalled();
    expect(proposal).toMatchObject({
      executionId: 'execution-1',
      strategy: 'REPAIR_VERIFICATION_FAILURE',
      status: 'PROPOSED',
      proposedBy: 'editor-2',
      reasonCode: 'NOINDEX_DETECTED'
    });
    expect(proposal.payload).toMatchObject({
      kind: 'REPAIR',
      verificationId: 'verification-1',
      requiresFreshApproval: true,
      remoteWritePerformed: false,
      plan: {
        baseSha: CURRENT_BASE,
        originalBaseSha: ORIGINAL_BASE,
        forceReset: false,
        autoMerge: false
      }
    });
  });
});
