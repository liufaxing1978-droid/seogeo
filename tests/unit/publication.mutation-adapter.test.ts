import { describe, expect, it } from 'vitest';
import { ExportMutationAdapter } from '../../src/modules/publication/export-mutation.adapter.js';
import type {
  ApprovedPlanInput,
  MutationAdapter,
  TargetRef
} from '../../src/modules/publication/mutation-adapter.js';

function targetRef(overrides: Partial<TargetRef> = {}): TargetRef {
  return {
    repositoryIdentity: 'liufaxing1978-droid/xingshantang',
    branch: 'main',
    headSha: '1111111111111111111111111111111111111111',
    touchedBlobShas: {
      'content/culture/liuren.md': 'blob-a'
    },
    ...overrides
  };
}

function approvedPlan(overrides: Partial<ApprovedPlanInput> = {}): ApprovedPlanInput {
  return {
    publicationId: 'publication-1',
    planId: 'plan-1',
    planHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    previewHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    contentHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    repositoryIdentity: 'liufaxing1978-droid/xingshantang',
    branch: 'main',
    baseSha: '1111111111111111111111111111111111111111',
    touchedBlobShas: {
      'content/culture/liuren.md': 'blob-a'
    },
    riskClass: 'LOW',
    operations: [{
      type: 'UPDATE_CONTENT_PAGE',
      path: 'content/culture/liuren.md',
      targetUrl: 'https://xingshantang.org/culture/liuren',
      contentHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    }],
    unifiedDiff: '--- a/content/culture/liuren.md\n+++ b/content/culture/liuren.md\n-old\n+new',
    ...overrides
  };
}

describe('P8-A mutation adapter contract', () => {
  it('exposes the EXPORT_ONLY capability through the shared adapter interface', () => {
    const adapter: MutationAdapter = new ExportMutationAdapter();
    expect(adapter.capability).toBe('EXPORT_ONLY');
  });

  it('returns the exact caller-supplied target snapshot without a remote read', async () => {
    const adapter = new ExportMutationAdapter();
    const target = targetRef();

    await expect(adapter.readTargetSnapshot(target)).resolves.toEqual({
      repositoryIdentity: target.repositoryIdentity,
      branch: target.branch,
      headSha: target.headSha,
      touchedBlobShas: target.touchedBlobShas
    });
  });

  it('creates a deterministic credential-free preview and patch artifact', async () => {
    const adapter = new ExportMutationAdapter();
    const plan = approvedPlan();

    const first = await adapter.preview(plan);
    const second = await adapter.preview(plan);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      capability: 'EXPORT_ONLY',
      repositoryIdentity: plan.repositoryIdentity,
      branch: plan.branch,
      baseSha: plan.baseSha,
      touchedBlobShas: plan.touchedBlobShas,
      unifiedDiff: plan.unifiedDiff,
      artifact: {
        kind: 'PATCH',
        mediaType: 'text/x-diff',
        content: plan.unifiedDiff
      }
    });
    expect(first.artifact.filename).toBe('publication-publication-1-aaaaaaaaaaaa.patch');
    expect(first.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(/token|secret|password|authorization|credential/i);
  });

  it('apply never performs a remote write and always returns MANUAL_ACTION_REQUIRED with the same export artifact', async () => {
    const adapter = new ExportMutationAdapter();
    const plan = approvedPlan();
    const preview = await adapter.preview(plan);

    const result = await adapter.apply(plan);

    expect(result).toEqual({
      capability: 'EXPORT_ONLY',
      status: 'MANUAL_ACTION_REQUIRED',
      remoteWritePerformed: false,
      artifact: preview.artifact
    });
    expect(Object.keys(adapter as unknown as Record<string, unknown>)).not.toContain('transport');
  });

  it('returns stable manual execution and rollback state without inventing remote state', async () => {
    const adapter = new ExportMutationAdapter();

    await expect(adapter.readExecutionState({
      executionId: 'execution-1',
      artifactSha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    })).resolves.toEqual({
      status: 'MANUAL_ACTION_REQUIRED',
      remoteStateKnown: false,
      artifactSha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    });

    await expect(adapter.rollback({
      executionId: 'execution-1',
      artifactSha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    })).resolves.toEqual({
      status: 'MANUAL_ACTION_REQUIRED',
      strategy: 'DISCARD_OR_REVERSE_EXPORTED_PATCH',
      remoteWritePerformed: false,
      artifactSha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    });
  });

  it('changes the artifact hash when any diff character changes', async () => {
    const adapter = new ExportMutationAdapter();
    const first = await adapter.preview(approvedPlan());
    const second = await adapter.preview(approvedPlan({
      unifiedDiff: '--- a/content/culture/liuren.md\n+++ b/content/culture/liuren.md\n-old\n+New'
    }));

    expect(first.artifact.sha256).not.toBe(second.artifact.sha256);
  });
});
