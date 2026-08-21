import type { PublicationRiskClass } from '@prisma/client';

export type MutationAdapterCapability = 'EXPORT_ONLY' | 'DRAFT_PR';

export interface TargetRef {
  repositoryIdentity: string;
  branch: string;
  headSha: string;
  touchedBlobShas: Record<string, string>;
}

export interface TargetSnapshot {
  repositoryIdentity: string;
  branch: string;
  headSha: string;
  touchedBlobShas: Record<string, string>;
}

export interface ApprovedPlanOperation {
  type: string;
  path: string;
  targetUrl?: string;
  contentHash?: string;
  [key: string]: unknown;
}

export interface ApprovedPlanInput {
  publicationId: string;
  planId: string;
  planHash: string;
  previewHash: string;
  contentHash: string;
  repositoryIdentity: string;
  branch: string;
  baseSha: string;
  touchedBlobShas: Record<string, string>;
  riskClass: PublicationRiskClass;
  operations: ApprovedPlanOperation[];
  unifiedDiff: string;
}

export interface MutationExportArtifact {
  kind: 'PATCH';
  filename: string;
  mediaType: 'text/x-diff';
  content: string;
  sha256: string;
}

export interface MutationPreview {
  capability: MutationAdapterCapability;
  repositoryIdentity: string;
  branch: string;
  baseSha: string;
  touchedBlobShas: Record<string, string>;
  operations: ApprovedPlanOperation[];
  unifiedDiff: string;
  artifact: MutationExportArtifact;
}

export interface MutationApplyResult {
  capability: MutationAdapterCapability;
  status: 'MANUAL_ACTION_REQUIRED' | 'APPLIED';
  remoteWritePerformed: boolean;
  artifact?: MutationExportArtifact;
  branchName?: string;
  commitSha?: string;
  pullRequestNo?: number;
  pullRequestUrl?: string;
}

export interface PublicationExecutionRef {
  executionId: string;
  artifactSha256?: string | null;
  branchName?: string | null;
  commitSha?: string | null;
  pullRequestNo?: number | null;
}

export interface MutationExecutionState {
  status: 'MANUAL_ACTION_REQUIRED' | 'PENDING' | 'APPLIED' | 'FAILED';
  remoteStateKnown: boolean;
  artifactSha256?: string | null;
  branchName?: string | null;
  commitSha?: string | null;
  pullRequestNo?: number | null;
}

export interface MutationRollbackDraft {
  status: 'MANUAL_ACTION_REQUIRED' | 'READY';
  strategy: string;
  remoteWritePerformed: boolean;
  artifactSha256?: string | null;
}

export interface MutationAdapter {
  readonly capability: MutationAdapterCapability;
  readTargetSnapshot(input: TargetRef): Promise<TargetSnapshot>;
  preview(plan: ApprovedPlanInput): Promise<MutationPreview>;
  apply(plan: ApprovedPlanInput): Promise<MutationApplyResult>;
  readExecutionState(execution: PublicationExecutionRef): Promise<MutationExecutionState>;
  rollback(execution: PublicationExecutionRef): Promise<MutationRollbackDraft>;
}
