import { describe, expect, it } from 'vitest';
import {
  GitHubMutationAdapter,
  type GitHubPublicationTransport,
  type GitHubDraftPullRequest
} from '../../src/modules/publication/github-mutation.adapter.js';
import type { ApprovedPlanInput } from '../../src/modules/publication/mutation-adapter.js';

const BASE_SHA = '1111111111111111111111111111111111111111';
const COMMIT_SHA = '2222222222222222222222222222222222222222';
const PLAN_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PATH = 'content/culture/liuren.md';
const MUTATION_BRANCH = 'seogeo/p8/publication-1-aaaaaaaaaaaa';

function plan(): ApprovedPlanInput {
  return {
    publicationId: 'publication-1',
    planId: 'plan-1',
    planHash: PLAN_HASH,
    previewHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    contentHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    repositoryIdentity: 'liufaxing1978-droid/xingshantang',
    branch: 'main',
    baseSha: BASE_SHA,
    touchedBlobShas: { [PATH]: 'blob-a' },
    riskClass: 'LOW',
    operations: [{
      type: 'UPDATE_CONTENT_PAGE',
      path: PATH,
      targetUrl: 'https://xingshantang.org/culture/liuren',
      contentHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      content: '# 六壬文化\n\nidempotent body'
    }],
    unifiedDiff: `--- a/${PATH}\n+++ b/${PATH}\n-old\n+new`
  };
}

class StatefulTransport implements GitHubPublicationTransport {
  writes: string[] = [];
  draftPrByHead = new Map<string, GitHubDraftPullRequest>();

  async readBranch() {
    return { headSha: BASE_SHA };
  }

  async readFile(input: { path: string }) {
    return { blobSha: input.path === PATH ? 'blob-a' : null };
  }

  async findDraftPullRequestByHead(input: { headBranch: string }) {
    return this.draftPrByHead.get(input.headBranch) ?? null;
  }

  async createBranch(input: { branchName: string; fromSha: string }) {
    this.writes.push(`branch:${input.branchName}:${input.fromSha}`);
  }

  async commitFiles(input: { branch: string; force: boolean }) {
    this.writes.push(`commit:${input.branch}:force=${String(input.force)}`);
    return { commitSha: COMMIT_SHA };
  }

  async createDraftPullRequest(input: { headBranch: string; baseBranch: string; draft: true }) {
    this.writes.push(`pr:${input.headBranch}->${input.baseBranch}:draft=${String(input.draft)}`);
    const pr = {
      number: 42,
      url: 'https://github.com/liufaxing1978-droid/xingshantang/pull/42',
      headBranch: input.headBranch,
      commitSha: COMMIT_SHA
    };
    this.draftPrByHead.set(input.headBranch, pr);
    return pr;
  }

  async readPullRequest(input: { pullRequestNo: number }) {
    return {
      number: input.pullRequestNo,
      url: 'https://github.com/liufaxing1978-droid/xingshantang/pull/42',
      headBranch: MUTATION_BRANCH,
      commitSha: COMMIT_SHA,
      state: 'OPEN' as const
    };
  }

  async prepareRevertPatch() {
    return { artifactSha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' };
  }
}

describe('P8-A GitHub Draft PR adapter idempotency', () => {
  it('re-delivery of the same approved plan returns the existing Draft PR with zero duplicate remote writes', async () => {
    const transport = new StatefulTransport();
    const adapter = new GitHubMutationAdapter(transport);

    const first = await adapter.apply(plan());
    const writesAfterFirst = [...transport.writes];
    const second = await adapter.apply(plan());

    expect(first).toEqual({
      capability: 'DRAFT_PR',
      status: 'APPLIED',
      remoteWritePerformed: true,
      branchName: MUTATION_BRANCH,
      commitSha: COMMIT_SHA,
      pullRequestNo: 42,
      pullRequestUrl: 'https://github.com/liufaxing1978-droid/xingshantang/pull/42'
    });
    expect(second).toEqual({
      ...first,
      remoteWritePerformed: false
    });
    expect(transport.writes).toEqual(writesAfterFirst);
    expect(transport.writes).toEqual([
      `branch:${MUTATION_BRANCH}:${BASE_SHA}`,
      `commit:${MUTATION_BRANCH}:force=false`,
      `pr:${MUTATION_BRANCH}->main:draft=true`
    ]);
  });
});
