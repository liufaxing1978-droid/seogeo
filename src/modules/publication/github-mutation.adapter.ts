import { ExportMutationAdapter } from './export-mutation.adapter.js';
import type {
  ApprovedPlanInput,
  MutationAdapter,
  MutationApplyResult,
  MutationExecutionState,
  MutationPreview,
  MutationRollbackDraft,
  PublicationExecutionRef,
  TargetRef,
  TargetSnapshot
} from './mutation-adapter.js';

export class GitHubMutationAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'GitHubMutationAdapterError';
  }
}

export interface GitHubDraftPullRequest {
  number: number;
  url: string;
  headBranch: string;
  commitSha: string;
}

export interface GitHubPublicationTransport {
  readBranch(input: {
    repositoryIdentity: string;
    branch: string;
  }): Promise<{ headSha: string }>;
  readFile(input: {
    repositoryIdentity: string;
    branch: string;
    path: string;
  }): Promise<{ blobSha: string | null }>;
  findDraftPullRequestByHead(input: {
    repositoryIdentity: string;
    headBranch: string;
  }): Promise<GitHubDraftPullRequest | null>;
  createBranch(input: {
    repositoryIdentity: string;
    branchName: string;
    fromSha: string;
  }): Promise<void>;
  commitFiles(input: {
    repositoryIdentity: string;
    branch: string;
    message: string;
    force: boolean;
    files: Array<{
      path: string;
      content: string;
      expectedBlobSha: string | null;
    }>;
  }): Promise<{ commitSha: string }>;
  createDraftPullRequest(input: {
    repositoryIdentity: string;
    baseBranch: string;
    headBranch: string;
    title: string;
    body: string;
    draft: true;
  }): Promise<GitHubDraftPullRequest>;
  readPullRequest(input: {
    repositoryIdentity: string;
    pullRequestNo: number;
  }): Promise<GitHubDraftPullRequest & { state: 'OPEN' | 'CLOSED' | 'MERGED' }>;
  prepareRevertPatch(input: {
    repositoryIdentity: string;
    commitSha: string;
  }): Promise<{ artifactSha256: string }>;
}

function fail(code: string, message: string): never {
  throw new GitHubMutationAdapterError(code, message);
}

function stableStringMap(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}

function publicationBranchName(plan: ApprovedPlanInput): string {
  const publicationId = plan.publicationId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'publication';
  const shortHash = plan.planHash.slice(0, 12).toLowerCase();
  return `seogeo/p8/${publicationId}-${shortHash}`;
}

function boundedCommitMessage(plan: ApprovedPlanInput): string {
  return `seo: publish ${plan.publicationId}`.slice(0, 72);
}

function approvedFiles(plan: ApprovedPlanInput) {
  return plan.operations.map((operation) => {
    const content = operation.content;
    if (typeof operation.path !== 'string' || !operation.path.trim()) {
      return fail('VALIDATION_FAILED', 'Approved publication operation is missing a repository path');
    }
    if (typeof content !== 'string') {
      return fail('VALIDATION_FAILED', 'Approved publication operation is missing exact file content');
    }
    return {
      path: operation.path,
      content,
      expectedBlobSha: plan.touchedBlobShas[operation.path] ?? null
    };
  });
}

export class GitHubMutationAdapter implements MutationAdapter {
  readonly capability = 'DRAFT_PR' as const;
  private readonly exportPreview = new ExportMutationAdapter();
  private lastRepositoryIdentity = '';

  constructor(private readonly transport: GitHubPublicationTransport) {}

  async readTargetSnapshot(input: TargetRef): Promise<TargetSnapshot> {
    this.lastRepositoryIdentity = input.repositoryIdentity;
    const branch = await this.transport.readBranch({
      repositoryIdentity: input.repositoryIdentity,
      branch: input.branch
    });
    const touchedBlobShas: Record<string, string> = {};
    for (const path of Object.keys(input.touchedBlobShas).sort()) {
      const file = await this.transport.readFile({
        repositoryIdentity: input.repositoryIdentity,
        branch: input.branch,
        path
      });
      if (file.blobSha !== null) touchedBlobShas[path] = file.blobSha;
    }
    return {
      repositoryIdentity: input.repositoryIdentity,
      branch: input.branch,
      headSha: branch.headSha,
      touchedBlobShas
    };
  }

  async preview(plan: ApprovedPlanInput): Promise<MutationPreview> {
    const preview = await this.exportPreview.preview(plan);
    return {
      ...preview,
      capability: this.capability
    };
  }

  async apply(plan: ApprovedPlanInput): Promise<MutationApplyResult> {
    this.lastRepositoryIdentity = plan.repositoryIdentity;
    const branchName = publicationBranchName(plan);
    const existing = await this.transport.findDraftPullRequestByHead({
      repositoryIdentity: plan.repositoryIdentity,
      headBranch: branchName
    });
    if (existing) {
      return {
        capability: this.capability,
        status: 'APPLIED',
        remoteWritePerformed: false,
        branchName: existing.headBranch,
        commitSha: existing.commitSha,
        pullRequestNo: existing.number,
        pullRequestUrl: existing.url
      };
    }

    const snapshot = await this.readTargetSnapshot({
      repositoryIdentity: plan.repositoryIdentity,
      branch: plan.branch,
      headSha: plan.baseSha,
      touchedBlobShas: plan.touchedBlobShas
    });
    if (snapshot.headSha !== plan.baseSha) {
      fail('TARGET_REVISION_CHANGED', 'Publication base branch changed after approval');
    }
    const expectedBlobs = stableStringMap(plan.touchedBlobShas);
    if (JSON.stringify(snapshot.touchedBlobShas) !== JSON.stringify(expectedBlobs)) {
      fail('TARGET_REVISION_CHANGED', 'A touched publication file changed after approval');
    }

    const files = approvedFiles(plan);
    await this.transport.createBranch({
      repositoryIdentity: plan.repositoryIdentity,
      branchName,
      fromSha: plan.baseSha
    });
    const commit = await this.transport.commitFiles({
      repositoryIdentity: plan.repositoryIdentity,
      branch: branchName,
      message: boundedCommitMessage(plan),
      force: false,
      files
    });
    const pullRequest = await this.transport.createDraftPullRequest({
      repositoryIdentity: plan.repositoryIdentity,
      baseBranch: plan.branch,
      headBranch: branchName,
      title: `SEO/GEO publication: ${plan.publicationId}`.slice(0, 120),
      body: `Plan: ${plan.planHash}\nPreview: ${plan.previewHash}`,
      draft: true
    });

    return {
      capability: this.capability,
      status: 'APPLIED',
      remoteWritePerformed: true,
      branchName,
      commitSha: commit.commitSha,
      pullRequestNo: pullRequest.number,
      pullRequestUrl: pullRequest.url
    };
  }

  async readExecutionState(execution: PublicationExecutionRef): Promise<MutationExecutionState> {
    if (!execution.pullRequestNo) {
      return {
        status: 'PENDING',
        remoteStateKnown: false,
        branchName: execution.branchName ?? null,
        commitSha: execution.commitSha ?? null,
        pullRequestNo: execution.pullRequestNo ?? null
      };
    }
    const pullRequest = await this.transport.readPullRequest({
      repositoryIdentity: this.lastRepositoryIdentity,
      pullRequestNo: execution.pullRequestNo
    });
    return {
      status: pullRequest.state === 'OPEN' || pullRequest.state === 'MERGED' ? 'APPLIED' : 'FAILED',
      remoteStateKnown: true,
      branchName: pullRequest.headBranch,
      commitSha: pullRequest.commitSha,
      pullRequestNo: pullRequest.number
    };
  }

  async rollback(execution: PublicationExecutionRef): Promise<MutationRollbackDraft> {
    if (!execution.commitSha) {
      return {
        status: 'MANUAL_ACTION_REQUIRED',
        strategy: 'REVERT_COMMIT',
        remoteWritePerformed: false,
        artifactSha256: null
      };
    }
    const revert = await this.transport.prepareRevertPatch({
      repositoryIdentity: this.lastRepositoryIdentity,
      commitSha: execution.commitSha
    });
    return {
      status: 'READY',
      strategy: 'REVERT_COMMIT',
      remoteWritePerformed: false,
      artifactSha256: revert.artifactSha256
    };
  }
}
