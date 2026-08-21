import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type {
  AppendDraftVersionInput,
  AppendPublicationExecutionEventInput,
  CreateContentDraftInput,
  CreateContentSourceReferenceInput,
  CreatePublicationApprovalInput,
  CreatePublicationChannelInput,
  CreatePublicationExecutionInput,
  CreatePublicationPlanInput,
  CreatePublicationPreviewInput,
  CreatePublicationProposalInput,
  CreatePublicationRollbackProposalInput,
  CreatePublicationSiteInput,
  CreatePublicationVerificationInput
} from './publication.types.js';

function inputJson(value: Prisma.JsonValue | Prisma.InputJsonValue | null) {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function nullableField<T>(incoming: T | null | undefined, current: T | null): T | null {
  return incoming === undefined ? current : incoming;
}

export class PublicationRepository {
  createSite(input: CreatePublicationSiteInput) {
    return prisma.publicationSite.create({
      data: {
        projectId: input.projectId,
        displayName: input.displayName,
        domain: input.domain,
        repositoryIdentity: input.repositoryIdentity ?? null,
        baseBranch: input.baseBranch ?? null,
        adapterType: input.adapterType,
        writeCapability: input.writeCapability,
        ...(input.allowedPaths !== undefined ? { allowedPaths: input.allowedPaths } : {}),
        enabled: input.enabled ?? true
      }
    });
  }

  createChannel(input: CreatePublicationChannelInput) {
    return prisma.publicationChannel.create({
      data: {
        siteId: input.siteId,
        pathPrefix: input.pathPrefix,
        displayName: input.displayName,
        repositoryPathTemplate: input.repositoryPathTemplate ?? null,
        contentType: input.contentType ?? null,
        ...(input.defaultSchemaTypes !== undefined ? { defaultSchemaTypes: input.defaultSchemaTypes } : {}),
        ...(input.allowedOperationClasses !== undefined
          ? { allowedOperationClasses: input.allowedOperationClasses }
          : {}),
        enabled: input.enabled ?? true
      }
    });
  }

  createProposal(input: CreatePublicationProposalInput) {
    return prisma.publicationProposal.create({
      data: {
        projectId: input.projectId,
        sourceType: input.sourceType,
        reason: input.reason,
        createdBy: input.createdBy,
        sourceReferenceId: input.sourceReferenceId ?? null,
        sourceSnapshotId: input.sourceSnapshotId ?? null,
        ...(input.sourceMetadata !== undefined ? { sourceMetadata: input.sourceMetadata } : {})
      }
    });
  }

  createDraft(input: CreateContentDraftInput) {
    return prisma.$transaction(async (tx) => {
      const draft = await tx.contentDraft.create({
        data: {
          projectId: input.projectId,
          sourceProposalId: input.sourceProposalId ?? null,
          title: input.title,
          slugCandidate: input.slugCandidate ?? null,
          body: input.body,
          excerpt: input.excerpt ?? null,
          metaTitle: input.metaTitle ?? null,
          metaDescription: input.metaDescription ?? null,
          canonicalCandidate: input.canonicalCandidate ?? null,
          ...(input.schemaJson !== undefined ? { schemaJson: input.schemaJson } : {}),
          author: input.author ?? null,
          language: input.language,
          currentVersion: 1,
          currentContentHash: input.contentHash ?? null,
          status: input.status ?? 'DRAFT',
          generatedBy: input.generatedBy
        }
      });

      await tx.contentDraftVersion.create({
        data: {
          draftId: draft.id,
          version: 1,
          title: draft.title,
          slugCandidate: draft.slugCandidate,
          body: draft.body,
          excerpt: draft.excerpt,
          metaTitle: draft.metaTitle,
          metaDescription: draft.metaDescription,
          canonicalCandidate: draft.canonicalCandidate,
          ...(draft.schemaJson !== null ? { schemaJson: inputJson(draft.schemaJson) } : {}),
          author: draft.author,
          language: draft.language,
          contentHash: draft.currentContentHash,
          generatedBy: draft.generatedBy
        }
      });

      return draft;
    });
  }

  appendDraftVersion(draftId: string, input: AppendDraftVersionInput) {
    return prisma.$transaction(async (tx) => {
      const draft = await tx.contentDraft.findUnique({ where: { id: draftId } });
      if (!draft) throw new Error('Content draft not found');

      const nextVersion = draft.currentVersion + 1;
      const title = input.title ?? draft.title;
      const slugCandidate = nullableField(input.slugCandidate, draft.slugCandidate);
      const body = input.body ?? draft.body;
      const excerpt = nullableField(input.excerpt, draft.excerpt);
      const metaTitle = nullableField(input.metaTitle, draft.metaTitle);
      const metaDescription = nullableField(input.metaDescription, draft.metaDescription);
      const canonicalCandidate = nullableField(input.canonicalCandidate, draft.canonicalCandidate);
      const schemaJson = input.schemaJson === undefined ? draft.schemaJson : input.schemaJson;
      const author = nullableField(input.author, draft.author);
      const language = input.language ?? draft.language;
      const contentHash = nullableField(input.contentHash, draft.currentContentHash);
      const status = input.status ?? draft.status;

      const version = await tx.contentDraftVersion.create({
        data: {
          draftId,
          version: nextVersion,
          title,
          slugCandidate,
          body,
          excerpt,
          metaTitle,
          metaDescription,
          canonicalCandidate,
          ...(schemaJson !== null ? { schemaJson: inputJson(schemaJson) } : {}),
          author,
          language,
          contentHash,
          generatedBy: input.generatedBy
        }
      });

      await tx.contentDraft.update({
        where: { id: draftId },
        data: {
          title,
          slugCandidate,
          body,
          excerpt,
          metaTitle,
          metaDescription,
          canonicalCandidate,
          schemaJson: inputJson(schemaJson),
          author,
          language,
          currentVersion: nextVersion,
          currentContentHash: contentHash,
          status,
          generatedBy: input.generatedBy
        }
      });

      return version;
    });
  }

  listDraftVersions(draftId: string) {
    return prisma.contentDraftVersion.findMany({
      where: { draftId },
      orderBy: [{ version: 'asc' }, { id: 'asc' }]
    });
  }

  createSourceReference(input: CreateContentSourceReferenceInput) {
    return prisma.contentSourceReference.create({
      data: {
        projectId: input.projectId,
        draftId: input.draftId ?? null,
        title: input.title,
        author: input.author ?? null,
        publisher: input.publisher ?? null,
        sourceUrl: input.sourceUrl ?? null,
        publishedAt: input.publishedAt ?? null,
        sourceType: input.sourceType,
        accessedAt: input.accessedAt ?? null,
        userProvided: input.userProvided ?? false,
        internalRef: input.internalRef ?? false
      }
    });
  }

  createPlan(input: CreatePublicationPlanInput) {
    return prisma.publicationPlan.create({
      data: {
        projectId: input.projectId,
        proposalId: input.proposalId,
        draftId: input.draftId,
        draftVersion: input.draftVersion,
        siteId: input.siteId,
        channelId: input.channelId ?? null,
        version: input.version,
        targetPublicUrl: input.targetPublicUrl,
        targetRepository: input.targetRepository,
        targetBranch: input.targetBranch,
        baseSha: input.baseSha,
        ...(input.targetBlobHashes !== undefined ? { targetBlobHashes: input.targetBlobHashes } : {}),
        operations: input.operations,
        expectedOutcomes: input.expectedOutcomes,
        validatorVersion: input.validatorVersion,
        riskClass: input.riskClass,
        rollbackStrategy: input.rollbackStrategy,
        planHash: input.planHash
      }
    });
  }

  createPreview(input: CreatePublicationPreviewInput) {
    return prisma.publicationPreview.create({
      data: {
        projectId: input.projectId,
        planId: input.planId,
        previewHash: input.previewHash,
        diffSummary: input.diffSummary,
        ...(input.diffPayload !== undefined ? { diffPayload: input.diffPayload } : {}),
        ...(input.validationResult !== undefined
          ? { validationResult: input.validationResult }
          : {})
      }
    });
  }

  async createApproval(input: CreatePublicationApprovalInput) {
    const plan = await prisma.publicationPlan.findUnique({
      where: { id: input.planId },
      select: {
        projectId: true,
        draftVersion: true,
        targetRepository: true,
        targetBranch: true,
        targetBlobHashes: true
      }
    });
    if (!plan) throw new Error('Publication plan not found');
    if (plan.projectId !== input.projectId) throw new Error('Publication plan project mismatch');

    return prisma.publicationApproval.create({
      data: {
        projectId: input.projectId,
        planId: input.planId,
        planVersion: input.planVersion,
        planHash: input.planHash,
        contentVersion: plan.draftVersion,
        contentHash: input.contentHash,
        previewHash: input.previewHash,
        baseSha: input.baseSha,
        targetRepository: plan.targetRepository,
        targetBranch: plan.targetBranch,
        targetBlobHashes: plan.targetBlobHashes === null
          ? ({} as Prisma.InputJsonObject)
          : inputJson(plan.targetBlobHashes),
        approverActorId: input.approverActorId,
        approvedRiskClass: input.approvedRiskClass,
        ...(input.confirmedWarningCodes !== undefined
          ? { confirmedWarningCodes: input.confirmedWarningCodes }
          : {}),
        expiresAt: input.expiresAt ?? null
      }
    });
  }

  createExecution(input: CreatePublicationExecutionInput) {
    return prisma.publicationExecution.create({
      data: {
        projectId: input.projectId,
        planId: input.planId,
        approvalId: input.approvalId,
        executionKey: input.executionKey,
        status: input.status ?? 'PENDING',
        branchName: input.branchName ?? null,
        commitSha: input.commitSha ?? null,
        pullRequestNo: input.pullRequestNo ?? null,
        pullRequestUrl: input.pullRequestUrl ?? null,
        errorCode: input.errorCode ?? null
      }
    });
  }

  appendExecutionEvent(executionId: string, input: AppendPublicationExecutionEventInput) {
    return prisma.publicationExecutionEvent.create({
      data: {
        executionId,
        eventType: input.eventType,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        reasonCode: input.reasonCode,
        actorId: input.actorId ?? null,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
      }
    });
  }

  createVerification(input: CreatePublicationVerificationInput) {
    return prisma.publicationVerification.create({
      data: {
        projectId: input.projectId,
        executionId: input.executionId,
        status: input.status ?? 'PENDING',
        observedUrl: input.observedUrl ?? null,
        observedAt: input.observedAt ?? null,
        httpStatus: input.httpStatus ?? null,
        titleMatches: input.titleMatches ?? null,
        descriptionMatches: input.descriptionMatches ?? null,
        canonicalMatches: input.canonicalMatches ?? null,
        h1Matches: input.h1Matches ?? null,
        indexable: input.indexable ?? null,
        schemaValid: input.schemaValid ?? null,
        contentFingerprintOk: input.contentFingerprintOk ?? null,
        ...(input.regressionFindings !== undefined
          ? { regressionFindings: input.regressionFindings }
          : {}),
        reasonCode: input.reasonCode ?? null
      }
    });
  }

  createRollbackProposal(input: CreatePublicationRollbackProposalInput) {
    return prisma.publicationRollbackProposal.create({
      data: {
        projectId: input.projectId,
        executionId: input.executionId,
        strategy: input.strategy,
        status: input.status ?? 'PROPOSED',
        reasonCode: input.reasonCode,
        proposedBy: input.proposedBy ?? null,
        ...(input.payload !== undefined ? { payload: input.payload } : {})
      }
    });
  }
}

export const publicationRepository = new PublicationRepository();
