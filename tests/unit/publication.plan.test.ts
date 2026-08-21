import { describe, expect, it } from 'vitest';
import {
  buildPublicationPlan,
  createPublicationPreview,
  type BuildPublicationPlanInput,
  type PublicationTargetSnapshot
} from '../../src/modules/publication/publication-plan.js';

function input(overrides: Partial<BuildPublicationPlanInput> = {}): BuildPublicationPlanInput {
  return {
    projectId: '00000000-0000-0000-0000-000000000001',
    proposalId: '00000000-0000-0000-0000-000000000002',
    planVersion: 1,
    draftVersion: {
      draftId: '00000000-0000-0000-0000-000000000003',
      version: 1,
      title: '六壬文化：从可核资料出发的介绍',
      slugCandidate: 'liuren-culture',
      body: '# 六壬文化\n\nV1 immutable body.',
      excerpt: 'V1 excerpt',
      metaTitle: '六壬文化',
      metaDescription: '从可核资料出发介绍六壬文化。',
      canonicalCandidate: 'https://xingshantang.org/culture/liuren-culture',
      schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
      author: '兴善堂',
      language: 'zh-CN',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    },
    site: {
      id: '00000000-0000-0000-0000-000000000004',
      domain: 'xingshantang.org',
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      baseBranch: 'main'
    },
    channel: {
      id: '00000000-0000-0000-0000-000000000005',
      pathPrefix: '/culture',
      repositoryPathTemplate: 'content/culture/{slug}.md'
    },
    intent: 'CREATE',
    validatorVersion: 'PUBLICATION_VALIDATOR_V1',
    validationResult: {
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      findings: [],
      blockingCodes: [],
      warningCodes: [],
      infoCodes: [],
      unconfirmedWarningCodes: [],
      canCreatePlan: true
    },
    expectedOutcomes: {
      publicUrl: 'https://xingshantang.org/culture/liuren-culture',
      indexable: true
    },
    riskClass: 'LOW',
    rollbackStrategy: 'REVERT_COMMIT',
    ...overrides
  };
}

function snapshot(overrides: Partial<PublicationTargetSnapshot> = {}): PublicationTargetSnapshot {
  return {
    repositoryIdentity: 'liufaxing1978-droid/xingshantang',
    branch: 'main',
    headSha: '1111111111111111111111111111111111111111',
    publicUrlExists: false,
    files: {},
    ...overrides
  };
}

describe('P8-A immutable publication plan builder', () => {
  it('maps a configured channel and path template to deterministic public and repository targets', () => {
    const plan = buildPublicationPlan(input(), snapshot());

    expect(plan).toMatchObject({
      projectId: input().projectId,
      proposalId: input().proposalId,
      draftId: input().draftVersion.draftId,
      draftVersion: 1,
      siteId: input().site.id,
      channelId: input().channel.id,
      version: 1,
      targetPublicUrl: 'https://xingshantang.org/culture/liuren-culture',
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      baseSha: '1111111111111111111111111111111111111111',
      targetBlobHashes: {},
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT'
    });
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      type: 'CREATE_CONTENT_PAGE',
      path: 'content/culture/liuren-culture.md',
      contentHash: input().draftVersion.contentHash
    });
    expect(plan.operations[0]?.content).toContain('V1 immutable body.');
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed with URL_CONFLICT when CREATE points at an existing URL or target file', () => {
    expect(() => buildPublicationPlan(input(), snapshot({ publicUrlExists: true })))
      .toThrow(expect.objectContaining({ code: 'URL_CONFLICT' }));

    expect(() => buildPublicationPlan(input(), snapshot({
      files: {
        'content/culture/liuren-culture.md': 'blob-existing'
      }
    }))).toThrow(expect.objectContaining({ code: 'URL_CONFLICT' }));
  });

  it('requires explicit UPDATE intent for an existing target and locks the existing blob SHA', () => {
    const updateInput = input({ intent: 'UPDATE', riskClass: 'MEDIUM' });
    const target = snapshot({
      publicUrlExists: true,
      files: { 'content/culture/liuren-culture.md': 'blob-a' }
    });
    const plan = buildPublicationPlan(updateInput, target);

    expect(plan.operations[0]).toMatchObject({
      type: 'UPDATE_CONTENT_PAGE',
      path: 'content/culture/liuren-culture.md'
    });
    expect(plan.targetBlobHashes).toEqual({
      'content/culture/liuren-culture.md': 'blob-a'
    });
    expect(plan.riskClass).toBe('MEDIUM');
  });

  it('refuses plan construction when deterministic validation has not cleared the publish gate', () => {
    expect(() => buildPublicationPlan(input({
      validationResult: {
        ...input().validationResult,
        warningCodes: ['SOURCE_GAP'],
        unconfirmedWarningCodes: ['SOURCE_GAP'],
        canCreatePlan: false
      }
    }), snapshot())).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('changes planHash when content, base SHA, touched blob SHA or an operation changes', () => {
    const updateInput = input({ intent: 'UPDATE', riskClass: 'MEDIUM' });
    const target = snapshot({
      publicUrlExists: true,
      files: { 'content/culture/liuren-culture.md': 'blob-a' }
    });
    const baseline = buildPublicationPlan(updateInput, target);

    const contentChanged = buildPublicationPlan(input({
      ...updateInput,
      draftVersion: {
        ...updateInput.draftVersion,
        body: '# 六壬文化\n\nOne character changed!',
        contentHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      }
    }), target);
    const baseChanged = buildPublicationPlan(updateInput, { ...target, headSha: '2222222222222222222222222222222222222222' });
    const blobChanged = buildPublicationPlan(updateInput, {
      ...target,
      files: { 'content/culture/liuren-culture.md': 'blob-b' }
    });
    const operationChanged = buildPublicationPlan({
      ...updateInput,
      rollbackStrategy: 'ABANDON_CHANGE'
    }, target);

    expect(new Set([
      baseline.planHash,
      contentChanged.planHash,
      baseChanged.planHash,
      blobChanged.planHash,
      operationChanged.planHash
    ]).size).toBe(5);
  });
});

describe('P8-A exact publication preview', () => {
  it('captures exact file changes, operations, diff, base/blob SHA bindings, risk and validation facts', () => {
    const plan = buildPublicationPlan(input(), snapshot());
    const preview = createPublicationPreview({ id: 'plan-1', ...plan }, {
      files: [{
        path: 'content/culture/liuren-culture.md',
        change: 'CREATED',
        oldBlobSha: null,
        newContentHash: input().draftVersion.contentHash
      }],
      unifiedDiff: '--- /dev/null\n+++ content/culture/liuren-culture.md\n+# 六壬文化',
      validationResult: input().validationResult
    });

    expect(preview).toMatchObject({
      projectId: input().projectId,
      planId: 'plan-1',
      diffSummary: '1 created, 0 modified, 0 deleted',
      validationResult: input().validationResult
    });
    expect(preview.diffPayload).toMatchObject({
      filesCreated: ['content/culture/liuren-culture.md'],
      filesModified: [],
      filesDeleted: [],
      operations: plan.operations,
      unifiedDiff: '--- /dev/null\n+++ content/culture/liuren-culture.md\n+# 六壬文化',
      expectedOutcomes: plan.expectedOutcomes,
      baseSha: plan.baseSha,
      targetBlobHashes: {},
      riskClass: 'LOW',
      validatorVersion: 'PUBLICATION_VALIDATOR_V1'
    });
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects deleted files in P8-A and changes previewHash for any diff character change', () => {
    const plan = buildPublicationPlan(input(), snapshot());
    const basePreview = {
      files: [{
        path: 'content/culture/liuren-culture.md',
        change: 'CREATED' as const,
        oldBlobSha: null,
        newContentHash: input().draftVersion.contentHash
      }],
      unifiedDiff: '+++ content/culture/liuren-culture.md\n+body',
      validationResult: input().validationResult
    };
    const first = createPublicationPreview({ id: 'plan-1', ...plan }, basePreview);
    const second = createPublicationPreview({ id: 'plan-1', ...plan }, {
      ...basePreview,
      unifiedDiff: '+++ content/culture/liuren-culture.md\n+Body'
    });
    expect(first.previewHash).not.toBe(second.previewHash);

    expect(() => createPublicationPreview({ id: 'plan-1', ...plan }, {
      ...basePreview,
      files: [{
        path: 'content/culture/old.md',
        change: 'DELETED',
        oldBlobSha: 'blob-old',
        newContentHash: null
      }]
    })).toThrow(expect.objectContaining({ code: 'OPERATION_NOT_ALLOWED' }));
  });
});
