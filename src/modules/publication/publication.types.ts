import type {
  ContentDraftStatus,
  ContentGeneratedBy,
  Prisma,
  PublicationAdapterType,
  PublicationExecutionEventType,
  PublicationExecutionStatus,
  PublicationProposalSourceType,
  PublicationRiskClass,
  PublicationRollbackStatus,
  PublicationVerificationStatus,
  PublicationWriteCapability
} from '@prisma/client';

export interface CreatePublicationSiteInput {
  projectId: string;
  displayName: string;
  domain: string;
  repositoryIdentity?: string | null;
  baseBranch?: string | null;
  adapterType: PublicationAdapterType;
  writeCapability: PublicationWriteCapability;
  allowedPaths?: Prisma.InputJsonValue;
  enabled?: boolean;
}

export interface CreatePublicationChannelInput {
  siteId: string;
  pathPrefix: string;
  displayName: string;
  repositoryPathTemplate?: string | null;
  contentType?: string | null;
  defaultSchemaTypes?: Prisma.InputJsonValue;
  allowedOperationClasses?: Prisma.InputJsonValue;
  enabled?: boolean;
}

export interface CreatePublicationProposalInput {
  projectId: string;
  sourceType: PublicationProposalSourceType;
  reason: string;
  createdBy: string;
  sourceReferenceId?: string | null;
  sourceSnapshotId?: string | null;
  sourceMetadata?: Prisma.InputJsonValue;
}

export interface CreateContentDraftInput {
  projectId: string;
  sourceProposalId?: string | null;
  title: string;
  slugCandidate?: string | null;
  body: string;
  excerpt?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonicalCandidate?: string | null;
  schemaJson?: Prisma.InputJsonValue;
  author?: string | null;
  language: string;
  contentHash?: string | null;
  status?: ContentDraftStatus;
  generatedBy: ContentGeneratedBy;
}

export interface AppendDraftVersionInput {
  title?: string;
  slugCandidate?: string | null;
  body?: string;
  excerpt?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonicalCandidate?: string | null;
  schemaJson?: Prisma.InputJsonValue;
  author?: string | null;
  language?: string;
  contentHash?: string | null;
  status?: ContentDraftStatus;
  generatedBy: ContentGeneratedBy;
}

export interface CreateContentSourceReferenceInput {
  projectId: string;
  draftId?: string | null;
  title: string;
  author?: string | null;
  publisher?: string | null;
  sourceUrl?: string | null;
  publishedAt?: Date | null;
  sourceType: string;
  accessedAt?: Date | null;
  userProvided?: boolean;
  internalRef?: boolean;
}

export interface CreatePublicationPlanInput {
  projectId: string;
  proposalId: string;
  draftId: string;
  draftVersion: number;
  siteId: string;
  channelId?: string | null;
  version: number;
  targetPublicUrl: string;
  targetRepository: string;
  targetBranch: string;
  baseSha: string;
  targetBlobHashes?: Prisma.InputJsonValue;
  operations: Prisma.InputJsonValue;
  expectedOutcomes: Prisma.InputJsonValue;
  validatorVersion: string;
  riskClass: PublicationRiskClass;
  rollbackStrategy: string;
  planHash: string;
}

export interface CreatePublicationPreviewInput {
  projectId: string;
  planId: string;
  previewHash: string;
  diffSummary: string;
  diffPayload?: Prisma.InputJsonValue;
  validationResult?: Prisma.InputJsonValue;
}

export interface CreatePublicationApprovalInput {
  projectId: string;
  planId: string;
  planVersion: number;
  planHash: string;
  contentHash: string;
  previewHash: string;
  baseSha: string;
  approverActorId: string;
  approvedRiskClass: PublicationRiskClass;
  confirmedWarningCodes?: Prisma.InputJsonValue;
  expiresAt?: Date | null;
}

export interface CreatePublicationAutomationAuthorizationInput {
  projectId: string;
  planId: string;
  planVersion: number;
  planHash: string;
  contentVersion: number;
  contentHash: string;
  previewHash: string;
  baseSha: string;
  targetRepository: string;
  targetBranch: string;
  targetBlobHashes: Prisma.InputJsonValue;
  authorizedRiskClass: 'LOW';
  automationDecisionId: string;
  automationPolicyVersion: string;
  automationPolicyHash: string;
  automationSource: 'CONTROLLED_AUTOPILOT';
  expiresAt: Date;
}

type PublicationExecutionCommonInput = {
  projectId: string;
  planId: string;
  executionKey: string;
  status?: PublicationExecutionStatus;
  branchName?: string | null;
  commitSha?: string | null;
  pullRequestNo?: number | null;
  pullRequestUrl?: string | null;
  errorCode?: string | null;
};

export type CreatePublicationExecutionInput = PublicationExecutionCommonInput & (
  | {
      approvalId: string;
      automationAuthorizationId?: never;
    }
  | {
      approvalId?: never;
      automationAuthorizationId: string;
    }
);

export interface AppendPublicationExecutionEventInput {
  eventType: PublicationExecutionEventType;
  fromStatus?: PublicationExecutionStatus | null;
  toStatus: PublicationExecutionStatus;
  reasonCode: string;
  actorId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface CreatePublicationVerificationInput {
  projectId: string;
  executionId: string;
  status?: PublicationVerificationStatus;
  observedUrl?: string | null;
  observedAt?: Date | null;
  httpStatus?: number | null;
  titleMatches?: boolean | null;
  descriptionMatches?: boolean | null;
  canonicalMatches?: boolean | null;
  h1Matches?: boolean | null;
  indexable?: boolean | null;
  schemaValid?: boolean | null;
  contentFingerprintOk?: boolean | null;
  regressionFindings?: Prisma.InputJsonValue;
  reasonCode?: string | null;
}

export interface CreatePublicationRollbackProposalInput {
  projectId: string;
  executionId: string;
  strategy: string;
  status?: PublicationRollbackStatus;
  reasonCode: string;
  proposedBy?: string | null;
  payload?: Prisma.InputJsonValue;
}
