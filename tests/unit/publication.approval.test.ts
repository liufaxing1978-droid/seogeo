import { describe, expect, it } from 'vitest';
import {
  approvePublicationPlan,
  assertApprovalCurrent,
  type ApprovalRepository,
  type ApprovalPlanRecord,
  type ApprovalPreviewRecord,
  type ApprovalRecord,
  type ApprovalLiveTarget
} from '../../src/modules/publication/publication-approval.js';

const CONTENT_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function plan(overrides: Partial<ApprovalPlanRecord> = {}): ApprovalPlanRecord {
  return {
    id: 'plan-1',
    projectId: 'project-1',
    proposalId: 'proposal-1',
    draftId: 'draft-1',
    draftVersion: 2,
    version: 3,
    planHash: 'plan-hash-1',
    baseSha: '1111111111111111111111111111111111111111',
    targetRepository: 'liufaxing1978-droid/xingshantang',
    targetBranch: 'main',
    targetBlobHashes: { 'content/culture/a.md': 'blob-a' },
    operations: [{
      type: 'UPDATE_CONTENT_PAGE',
      path: 'content/culture/a.md',
      contentHash: CONTENT_HASH
    }],
    riskClass: 'LOW',
    ...overrides
  };
}

function preview(overrides: Partial<ApprovalPreviewRecord> = {}): ApprovalPreviewRecord {
  return {
    id: 'preview-1',
    planId: 'plan-1',
    projectId: 'project-1',
    previewHash: 'preview-hash-1',
    validationResult: {
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      findings: [],
      blockingCodes: [],
      warningCodes: [],
      infoCodes: [],
      unconfirmedWarningCodes: [],
      canCreatePlan: true
    },
    ...overrides
  };
}

function approval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: 'approval-1',
    projectId: 'project-1',
    planId: 'plan-1',
    planVersion: 3,
    planHash: 'plan-hash-1',
    contentVersion: 2,
    contentHash: CONTENT_HASH,
    previewHash: 'preview-hash-1',
    baseSha: '1111111111111111111111111111111111111111',
    targetRepository: 'liufaxing1978-droid/xingshantang',
    targetBranch: 'main',
    targetBlobHashes: { 'content/culture/a.md': 'blob-a' },
    approverActorId: 'approver-1',
    approvedRiskClass: 'LOW',
    confirmedWarningCodes: [],
    expiresAt: null,
    ...overrides
  };
}

function liveTarget(overrides: Partial<ApprovalLiveTarget> = {}): ApprovalLiveTarget {
  return {
    repositoryIdentity: 'liufaxing1978-droid/xingshantang',
    branch: 'main',
    headSha: '1111111111111111111111111111111111111111',
    files: { 'content/culture/a.md': 'blob-a' },
    ...overrides
  };
}

function expectCode(fn: () => unknown, code: string) {
  expect(fn).toThrow(expect.objectContaining({ code }));
}

describe('P8-A hash-bound approval stale protection', () => {
  it('accepts only an exact plan/content/preview/repository/risk/live-target binding', () => {
    expect(() => assertApprovalCurrent(
      plan(),
      preview(),
      approval(),
      liveTarget(),
      new Date('2026-08-21T10:00:00.000Z')
    )).not.toThrow();
  });

  it('returns APPROVAL_STALE when any approved immutable binding changes', () => {
    const mutations: Array<[ApprovalPlanRecord, ApprovalPreviewRecord, ApprovalRecord]> = [
      [plan({ planHash: 'plan-hash-2' }), preview(), approval()],
      [plan({ operations: [{ type: 'UPDATE_CONTENT_PAGE', path: 'content/culture/a.md', contentHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] }), preview(), approval()],
      [plan(), preview({ previewHash: 'preview-hash-2' }), approval()],
      [plan({ baseSha: '2222222222222222222222222222222222222222' }), preview(), approval()],
      [plan({ targetRepository: 'liufaxing1978-droid/other' }), preview(), approval()],
      [plan({ targetBranch: 'release' }), preview(), approval()],
      [plan({ targetBlobHashes: { 'content/culture/a.md': 'blob-b' } }), preview(), approval()],
      [plan({ riskClass: 'MEDIUM' }), preview(), approval()]
    ];

    for (const [candidatePlan, candidatePreview, candidateApproval] of mutations) {
      expectCode(() => assertApprovalCurrent(
        candidatePlan,
        candidatePreview,
        candidateApproval,
        liveTarget(),
        new Date('2026-08-21T10:00:00.000Z')
      ), 'APPROVAL_STALE');
    }
  });

  it('returns TARGET_REVISION_CHANGED for live repository, branch, head or touched blob drift', () => {
    for (const target of [
      liveTarget({ repositoryIdentity: 'liufaxing1978-droid/other' }),
      liveTarget({ branch: 'release' }),
      liveTarget({ headSha: '2222222222222222222222222222222222222222' }),
      liveTarget({ files: { 'content/culture/a.md': 'blob-b' } })
    ]) {
      expectCode(() => assertApprovalCurrent(
        plan(),
        preview(),
        approval(),
        target,
        new Date('2026-08-21T10:00:00.000Z')
      ), 'TARGET_REVISION_CHANGED');
    }
  });

  it('treats an expired approval as APPROVAL_STALE', () => {
    expectCode(() => assertApprovalCurrent(
      plan(),
      preview(),
      approval({ expiresAt: new Date('2026-08-21T09:59:59.000Z') }),
      liveTarget(),
      new Date('2026-08-21T10:00:00.000Z')
    ), 'APPROVAL_STALE');
  });
});

describe('P8-A human approval creation policy', () => {
  function repositoryFor(riskClass: 'LOW' | 'MEDIUM' | 'HIGH', warningCodes: string[] = []) {
    const created: Array<Record<string, unknown>> = [];
    const repository: ApprovalRepository = {
      async getPlanForApproval() {
        return plan({ riskClass });
      },
      async getPreviewForPlan() {
        return preview({
          validationResult: {
            validatorVersion: 'PUBLICATION_VALIDATOR_V1',
            findings: warningCodes.map((code) => ({ severity: 'WARNING', code, message: code })),
            blockingCodes: [],
            warningCodes,
            infoCodes: [],
            unconfirmedWarningCodes: [],
            canCreatePlan: true
          }
        });
      },
      async getDraftVersion() {
        return { contentHash: CONTENT_HASH };
      },
      async createApproval(input) {
        created.push(input as unknown as Record<string, unknown>);
        return approval({
          approvedRiskClass: riskClass,
          approverActorId: input.approverActorId,
          confirmedWarningCodes: Array.isArray(input.confirmedWarningCodes)
            ? input.confirmedWarningCodes as string[]
            : []
        });
      }
    };
    return { repository, created };
  }

  it('allows LOW without a separate risk acknowledgement and binds the authenticated actor', async () => {
    const { repository, created } = repositoryFor('LOW');
    const result = await approvePublicationPlan({
      projectId: 'project-1',
      planId: 'plan-1',
      expectedPlanHash: 'plan-hash-1',
      expectedContentHash: CONTENT_HASH,
      expectedPreviewHash: 'preview-hash-1'
    }, { actorId: 'auth-approver' }, repository);

    expect(result.approverActorId).toBe('auth-approver');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      planHash: 'plan-hash-1',
      contentHash: CONTENT_HASH,
      previewHash: 'preview-hash-1',
      baseSha: '1111111111111111111111111111111111111111',
      approverActorId: 'auth-approver',
      approvedRiskClass: 'LOW'
    });
  });

  it('requires MEDIUM explicit risk acknowledgement and all warning codes', async () => {
    const { repository } = repositoryFor('MEDIUM', ['SOURCE_GAP']);

    await expect(approvePublicationPlan({
      projectId: 'project-1',
      planId: 'plan-1',
      expectedPlanHash: 'plan-hash-1',
      expectedContentHash: CONTENT_HASH,
      expectedPreviewHash: 'preview-hash-1',
      confirmedWarningCodes: ['SOURCE_GAP']
    }, { actorId: 'approver-1' }, repository)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    await expect(approvePublicationPlan({
      projectId: 'project-1',
      planId: 'plan-1',
      expectedPlanHash: 'plan-hash-1',
      expectedContentHash: CONTENT_HASH,
      expectedPreviewHash: 'preview-hash-1',
      confirmedRisk: 'MEDIUM',
      confirmedWarningCodes: []
    }, { actorId: 'approver-1' }, repository)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    await expect(approvePublicationPlan({
      projectId: 'project-1',
      planId: 'plan-1',
      expectedPlanHash: 'plan-hash-1',
      expectedContentHash: CONTENT_HASH,
      expectedPreviewHash: 'preview-hash-1',
      confirmedRisk: 'MEDIUM',
      confirmedWarningCodes: ['SOURCE_GAP']
    }, { actorId: 'approver-1' }, repository)).resolves.toMatchObject({ approvedRiskClass: 'MEDIUM' });
  });

  it('always rejects HIGH risk approval', async () => {
    const { repository } = repositoryFor('HIGH');
    await expect(approvePublicationPlan({
      projectId: 'project-1',
      planId: 'plan-1',
      expectedPlanHash: 'plan-hash-1',
      expectedContentHash: CONTENT_HASH,
      expectedPreviewHash: 'preview-hash-1',
      confirmedRisk: 'HIGH'
    }, { actorId: 'approver-1' }, repository)).rejects.toMatchObject({ code: 'OPERATION_NOT_ALLOWED' });
  });

  it('fails stale review hashes before writing an approval', async () => {
    const { repository, created } = repositoryFor('LOW');
    await expect(approvePublicationPlan({
      projectId: 'project-1',
      planId: 'plan-1',
      expectedPlanHash: 'stale-plan-hash',
      expectedContentHash: CONTENT_HASH,
      expectedPreviewHash: 'preview-hash-1'
    }, { actorId: 'approver-1' }, repository)).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    expect(created).toHaveLength(0);
  });
});
