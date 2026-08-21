import { describe, expect, it } from 'vitest';
import {
  GitHubMutationAdapter,
  type GitHubPublicationTransport,
  type GitHubDraftPullRequest
} from '../../src/modules/publication/github-mutation.adapter.js';
import type { ApprovedPlanInput, TargetRef } from '../../src/modules/publication/mutation-adapter.js';

const BASE_SHA = '1111111111111111111111111111111111111111';
const PLAN_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CONTENT_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const PATH = 'content/culture/liuren.md';
const MUTATION_BRANCH = 'seogeo/p8/publication-1-aaaaaaaaaaaa';

function plan(overrides: Partial<ApprovedPlanInput> = {}): ApprovedPlanInput {
  return {
    publicationId: 'publication-1',
    planId: 'plan-1',
    planHash: PLAN_HASH,
    previewHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
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
    unifiedDiff: `--- a/${PATH}\n+++ b/${PATH}\n-old\n+new`,
    ...overrides
  };
}

class FakeTransport implements GitHubPublicationTransport {
  headSha = BASE_SHA;
  blobs: Record<string, string | null> = { [PATH]: 'blob-a' };
  existingPr: GitHubDraftPullRequest | null = null;
  writes: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  reads: Array<{ kind: string; payload: Record<string, unknown> }> = [];

  async readBranch(input: { repositoryIdentity: string; branch: string }) {
    this.reads.push({ kind: 'readBranch', payload: input });
    return { headSha: this.headSha };
  }

  async readFile(input: { repositoryIdentity: string; branch: string; path: string }) {
    this.reads.push({ kind: 'readFile', payload: input });
    return { blobSha: this.blobs[input.path] ?? null };
  }

  async findDraftPullRequestByHead(input: { repositoryIdentity: string; headBranch: string }) {
    this.reads.push({ kind: 'findDraftPullRequestByHead', payload: input });
    return this.existingPr;
  }

  async createBranch(input: { repositoryIdentity: string; branchName: string; fromSha: string }) {
    this.writes.push({ kind: 'createBranch', payload: input });
  }

  async commitFiles(input: {
    repositoryIdentity: string;
    branch: string;
    message: string;
    force: boolean;
    files: Array<{ path: string; content: string; expectedBlobSha: string | null }>;
  }) {
    this.writes.push({ kind: 'commitFiles', payload: input as unknown as Record<string, unknown> });
    return { commitSha: '2222222222222222222222222222222222222222' };
  }

  async createDraftPullRequest(input: {
    repositoryIdentity: string;
    baseBranch: string;
    headBranch: string;
    title: string;
    body: string;
    draft: true;
  }) {
    this.writes.push({ kind: 'createDraftPullRequest', payload: input });
    return {
      number: 42,
      url: 'https://github.com/liufaxing1978-droid/xingshantang/pull/42',
      headBranch: input.headBranch,
      commitSha: '2222222222222222222222222222222222222222'
    };
  }

  async readPullRequest(input: { repositoryIdentity: string; pullRequestNo: number }) {
    this.reads.push({ kind: 'readPullRequest', payload: input });
    return {
      number: input.pullRequestNo,
      url: 'https://github.com/liufaxing1978-droid/xingshantang/pull/42',
      headBranch: MUTATION_BRANCH,
      commitSha: '2222222222222222222222222222222222222222',
      state: 'OPEN' as const
    };
  }

  async prepareRevertPatch(input: { repositoryIdentity: string; commitSha: string }) {
    this.reads.push({ kind: 'prepareRevertPatch', payload: input });
    return { artifactSha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' };
  }
}

function expectCode(errorPromise: Promise<unknown>, code: string) {
  return expect(errorPromise).rejects.toMatchObject({ code });
}

describe('P8-A GitHub Draft PR adapter safety', () => {
  it('reads the exact configured base branch and touched blob snapshot', async () => {
    const transport = new FakeTransport();
    const adapter = new GitHubMutationAdapter(transport);
    const target: TargetRef = {
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      branch: 'main',
      headSha: BASE_SHA,
      touchedBlobShas: { [PATH]: 'blob-a' }
    };

    await expect(adapter.readTargetSnapshot(target)).resolves.toEqual({
      repositoryIdentity: target.repositoryIdentity,
      branch: 'main',
      headSha: BASE_SHA,
      touchedBlobShas: { [PATH]: 'blob-a' }
    });
    expect(transport.writes).toHaveLength(0);
  });

  it('previews deterministically as DRAFT_PR without credentials', async () => {
    const adapter = new GitHubMutationAdapter(new FakeTransport());
    const first = await adapter.preview(plan());
    const second = await adapter.preview(plan());

    expect(first).toEqual(second);
    expect(first.capability).toBe('DRAFT_PR');
    expect(first.unifiedDiff).toBe(plan().unifiedDiff);
    expect(JSON.stringify(first)).not.toMatch(/token|secret|password|authorization|credential/i);
  });

  it('writes only to the unique mutation branch, never default branch and never force-updates', async () => {
    const transport = new FakeTransport();
    const adapter = new GitHubMutationAdapter(transport);

    await expect(adapter.apply(plan())).resolves.toMatchObject({
      capability: 'DRAFT_PR',
      status: 'APPLIED',
      remoteWritePerformed: true,
      branchName: MUTATION_BRANCH,
      commitSha: '2222222222222222222222222222222222222222',
      pullRequestNo: 42
    });

    expect(transport.writes.map((entry) => entry.kind)).toEqual([
      'createBranch',
      'commitFiles',
      'createDraftPullRequest'
    ]);
    expect(transport.writes[0]?.payload).toEqual({
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      branchName: MUTATION_BRANCH,
      fromSha: BASE_SHA
    });
    expect(transport.writes[1]?.payload).toMatchObject({
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      branch: MUTATION_BRANCH,
      force: false
    });
    expect(transport.writes[1]?.payload.branch).not.toBe('main');
    expect(transport.writes[2]?.payload).toMatchObject({
      baseBranch: 'main',
      headBranch: MUTATION_BRANCH,
      draft: true
    });
  });

  it('returns TARGET_REVISION_CHANGED before createBranch when base head changed', async () => {
    const transport = new FakeTransport();
    transport.headSha = '9999999999999999999999999999999999999999';
    const adapter = new GitHubMutationAdapter(transport);

    await expectCode(adapter.apply(plan()), 'TARGET_REVISION_CHANGED');
    expect(transport.writes).toHaveLength(0);
  });

  it('returns TARGET_REVISION_CHANGED before createBranch when a touched blob changed', async () => {
    const transport = new FakeTransport();
    transport.blobs[PATH] = 'blob-b';
    const adapter = new GitHubMutationAdapter(transport);

    await expectCode(adapter.apply(plan()), 'TARGET_REVISION_CHANGED');
    expect(transport.writes).toHaveLength(0);
  });

  it('reads existing PR state and prepares rollback without writing or merging', async () => {
    const transport = new FakeTransport();
    const adapter = new GitHubMutationAdapter(transport);

    await expect(adapter.readExecutionState({
      executionId: 'execution-1',
      branchName: MUTATION_BRANCH,
      commitSha: '2222222222222222222222222222222222222222',
      pullRequestNo: 42
    })).resolves.toMatchObject({
      status: 'APPLIED',
      remoteStateKnown: true,
      branchName: MUTATION_BRANCH,
      commitSha: '2222222222222222222222222222222222222222',
      pullRequestNo: 42
    });

    await expect(adapter.rollback({
      executionId: 'execution-1',
      commitSha: '2222222222222222222222222222222222222222',
      pullRequestNo: 42
    })).resolves.toEqual({
      status: 'READY',
      strategy: 'REVERT_COMMIT',
      remoteWritePerformed: false,
      artifactSha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    });
    expect(transport.writes).toHaveLength(0);
  });
});
