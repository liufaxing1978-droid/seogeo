import { Prisma, type DistributionArtifact, type DistributionTarget } from '@prisma/client';
import { hasFeature } from '../../auth/feature-flags.js';
import { prisma } from '../../db/prisma.js';
import {
  DistributionAdapterError,
  publishWithDistributionAdapter,
  type ApprovedDistributionArtifact,
  type DistributionAdapter,
  type DistributionPublishResult,
  type DistributionVerifyResult
} from './distribution-adapter.js';
import { createDistributionAdaptationTask } from './distribution-ai.js';
import {
  distributionObservability,
  type DistributionObservability
} from './distribution-observability.js';
import { DistributionRepository } from './distribution.repository.js';

export class DistributionServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DistributionServiceError';
  }
}

export interface DistributionPreparationQueuePort {
  enqueue(targetId: string, sourceContentVersion: number): Promise<unknown>;
}

export type DistributionAdaptationTaskCreator = (
  targetId: string,
  sourceContentVersion: number
) => Promise<unknown>;

export type DistributionServiceDependencies = {
  repository?: DistributionRepository;
  queue?: DistributionPreparationQueuePort;
  adaptationTaskCreator?: DistributionAdaptationTaskCreator;
  observability?: DistributionObservability;
};

type DistributionContext = {
  target: DistributionTarget;
  project: { id: string; planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' };
  publication: {
    id: string;
    status: string;
    plan: { draftVersion: number; targetPublicUrl: string };
  };
};

function stringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function objectMetadata(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function approvedArtifact(
  target: DistributionTarget,
  artifact: DistributionArtifact
): ApprovedDistributionArtifact {
  return {
    platform: target.platform,
    mode: target.mode,
    publicationId: target.publicationId,
    sourceContentVersion: artifact.sourceContentVersion,
    title: artifact.title ?? '',
    body: artifact.body,
    summary: artifact.summary,
    tags: stringArray(artifact.tags),
    originalUrl: artifact.originalUrl,
    canonicalUrl: artifact.canonicalUrl,
    metadata: objectMetadata(artifact.platformMetadata)
  };
}

function requireHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DistributionServiceError('DISTRIBUTION_PUBLIC_URL_INVALID', 'Distribution public URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DistributionServiceError('DISTRIBUTION_PUBLIC_URL_INVALID', 'Distribution public URL must use HTTP or HTTPS');
  }
  return url.toString();
}

function publishResultFromMetadata(value: Prisma.JsonValue | null): DistributionPublishResult {
  const metadata = objectMetadata(value);
  const providerId = typeof metadata.providerId === 'string' ? metadata.providerId : null;
  const publicUrl = typeof metadata.publicUrl === 'string' ? metadata.publicUrl : null;
  const status = typeof metadata.status === 'string' ? metadata.status : null;
  if (!status) {
    throw new DistributionServiceError(
      'DISTRIBUTION_PUBLISH_RESULT_MISSING',
      'Published distribution result is missing its frozen provider status'
    );
  }
  return { providerId, publicUrl, status };
}

export class DistributionService {
  private readonly repository: DistributionRepository;
  private readonly queue?: DistributionPreparationQueuePort;
  private readonly adaptationTaskCreator: DistributionAdaptationTaskCreator;
  private readonly observability: DistributionObservability;

  constructor(dependencies: DistributionServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new DistributionRepository();
    this.queue = dependencies.queue;
    this.adaptationTaskCreator = dependencies.adaptationTaskCreator ?? createDistributionAdaptationTask;
    this.observability = dependencies.observability ?? distributionObservability;
  }

  private async context(
    targetId: string,
    expectedProjectId?: string
  ): Promise<DistributionContext> {
    const target = await this.repository.getTarget(targetId);
    if (!target || (expectedProjectId !== undefined && target.projectId !== expectedProjectId)) {
      throw new DistributionServiceError('DISTRIBUTION_TARGET_NOT_FOUND', 'Distribution target not found');
    }

    const [project, publication] = await Promise.all([
      prisma.project.findUnique({
        where: { id: target.projectId },
        select: { id: true, planLevel: true }
      }),
      prisma.publicationExecution.findFirst({
        where: { id: target.publicationId, projectId: target.projectId },
        select: {
          id: true,
          status: true,
          plan: { select: { draftVersion: true, targetPublicUrl: true } }
        }
      })
    ]);

    if (!project || !publication) {
      throw new DistributionServiceError('DISTRIBUTION_PRIMARY_NOT_FOUND', 'Distribution primary publication not found');
    }

    return { target, project, publication };
  }

  private assertFeature(context: DistributionContext): void {
    if (context.target.mode === 'ENTITY_SUGGESTION') {
      if (!hasFeature(context.project.planLevel, 'PUBLICATION_ENTERPRISE_GOVERNANCE')) {
        throw new DistributionServiceError(
          'PUBLICATION_ENTERPRISE_GOVERNANCE_NOT_AVAILABLE',
          'Entity and knowledge-graph suggestions require the Enterprise plan'
        );
      }
      return;
    }

    if (!hasFeature(context.project.planLevel, 'PUBLICATION_DISTRIBUTION')) {
      throw new DistributionServiceError(
        'PUBLICATION_DISTRIBUTION_NOT_AVAILABLE',
        'Content distribution requires the Advanced plan or higher'
      );
    }
  }

  private assertEntityActionSupported(
    context: DistributionContext,
    action: 'publish' | 'manual-result' | 'verify'
  ): void {
    if (context.target.mode !== 'ENTITY_SUGGESTION') return;
    if (action === 'verify') {
      throw new DistributionServiceError(
        'DISTRIBUTION_VERIFY_NOT_SUPPORTED',
        'Entity and knowledge-graph suggestions are PREPARE_ONLY and cannot be verified as external publications'
      );
    }
    throw new DistributionServiceError(
      'DISTRIBUTION_NOT_SUPPORTED',
      'Entity and knowledge-graph suggestions are PREPARE_ONLY and cannot be published by this system'
    );
  }

  private assertVerified(context: DistributionContext): void {
    if (context.publication.status !== 'VERIFIED') {
      throw new DistributionServiceError(
        'PRIMARY_PUBLICATION_NOT_VERIFIED',
        'Primary publication must be VERIFIED before distribution'
      );
    }
  }

  private assertSourceVersion(context: DistributionContext, sourceContentVersion: number): void {
    if (
      !Number.isInteger(sourceContentVersion)
      || sourceContentVersion < 1
      || sourceContentVersion !== context.publication.plan.draftVersion
    ) {
      throw new DistributionServiceError(
        'DISTRIBUTION_SOURCE_VERSION_MISMATCH',
        'Distribution preparation must bind the exact verified primary source version'
      );
    }
  }

  private async currentArtifact(context: DistributionContext, artifactId: string): Promise<DistributionArtifact> {
    const artifact = await prisma.distributionArtifact.findFirst({
      where: { id: artifactId, targetId: context.target.id, projectId: context.project.id }
    });
    if (!artifact) {
      throw new DistributionServiceError('DISTRIBUTION_ARTIFACT_NOT_FOUND', 'Distribution artifact not found');
    }
    if (
      artifact.sourceContentVersion !== context.publication.plan.draftVersion
      || (context.target.sourceContentVersion !== null
        && artifact.sourceContentVersion < context.target.sourceContentVersion)
    ) {
      throw new DistributionServiceError('DISTRIBUTION_ARTIFACT_OUTDATED', 'Distribution artifact source is outdated');
    }
    return artifact;
  }

  async requestPreparation(input: {
    projectId: string;
    targetId: string;
    sourceContentVersion: number;
  }): Promise<unknown> {
    const context = await this.context(input.targetId, input.projectId);
    this.assertFeature(context);
    this.assertVerified(context);
    this.assertSourceVersion(context, input.sourceContentVersion);
    if (!this.queue) {
      throw new DistributionServiceError(
        'DISTRIBUTION_QUEUE_NOT_CONFIGURED',
        'Distribution preparation queue is not configured'
      );
    }
    return this.queue.enqueue(input.targetId, input.sourceContentVersion);
  }

  async prepareTargetNow(input: {
    targetId: string;
    sourceContentVersion: number;
  }): Promise<unknown> {
    const context = await this.context(input.targetId);
    this.assertFeature(context);
    this.assertVerified(context);
    this.assertSourceVersion(context, input.sourceContentVersion);

    const startedAt = Date.now();
    this.observability.emit('distribution.preparation.started', {
      projectId: context.project.id,
      targetId: context.target.id,
      publicationId: context.publication.id,
      platform: context.target.platform,
      mode: context.target.mode,
      status: context.target.status,
      sourceContentVersion: input.sourceContentVersion
    });
    try {
      const result = await this.adaptationTaskCreator(input.targetId, input.sourceContentVersion);
      this.observability.emit('distribution.preparation.completed', {
        projectId: context.project.id,
        targetId: context.target.id,
        publicationId: context.publication.id,
        platform: context.target.platform,
        mode: context.target.mode,
        status: context.target.status,
        sourceContentVersion: input.sourceContentVersion,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      this.observability.emit('distribution.preparation.failed', {
        projectId: context.project.id,
        targetId: context.target.id,
        publicationId: context.publication.id,
        platform: context.target.platform,
        mode: context.target.mode,
        status: context.target.status,
        sourceContentVersion: input.sourceContentVersion,
        reasonCode: error instanceof Error ? error.name : 'DISTRIBUTION_PREPARATION_FAILED',
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }

  async approveArtifact(input: {
    projectId: string;
    targetId: string;
    artifactId: string;
  }) {
    const context = await this.context(input.targetId, input.projectId);
    this.assertFeature(context);
    this.assertVerified(context);
    if (context.target.status !== 'DRAFT_READY') {
      throw new DistributionServiceError(
        'DISTRIBUTION_ARTIFACT_NOT_READY',
        'Distribution artifact must be DRAFT_READY before approval'
      );
    }
    const artifact = await this.currentArtifact(context, input.artifactId);
    return this.repository.appendTargetEvent(context.target.id, {
      artifactId: artifact.id,
      fromStatus: context.target.status,
      toStatus: 'APPROVED',
      reasonCode: 'ARTIFACT_APPROVED',
      sourceContentVersion: artifact.sourceContentVersion
    });
  }

  async publishApprovedArtifact(input: {
    projectId: string;
    targetId: string;
    artifactId: string;
    adapter: DistributionAdapter;
  }): Promise<DistributionPublishResult> {
    const context = await this.context(input.targetId, input.projectId);
    this.assertFeature(context);
    this.assertVerified(context);
    this.assertEntityActionSupported(context, 'publish');

    if (context.target.status === 'OUTDATED') {
      throw new DistributionServiceError('DISTRIBUTION_ARTIFACT_OUTDATED', 'Outdated distribution artifact cannot be published');
    }
    if (context.target.status !== 'APPROVED') {
      throw new DistributionServiceError(
        'DISTRIBUTION_ARTIFACT_NOT_APPROVED',
        'Distribution artifact requires explicit approval before publishing'
      );
    }

    const artifact = await this.currentArtifact(context, input.artifactId);
    const startedAt = Date.now();
    try {
      const result = await publishWithDistributionAdapter(input.adapter, approvedArtifact(context.target, artifact));
      await this.repository.appendTargetEvent(context.target.id, {
        artifactId: artifact.id,
        fromStatus: context.target.status,
        toStatus: 'PUBLISHED',
        reasonCode: 'DISTRIBUTION_PUBLISH_COMPLETED',
        sourceContentVersion: artifact.sourceContentVersion,
        metadata: {
          capability: input.adapter.capability,
          providerId: result.providerId ?? null,
          publicUrl: result.publicUrl ?? null,
          status: result.status
        } as Prisma.InputJsonValue
      });
      this.observability.emit('distribution.publish.completed', {
        projectId: context.project.id,
        targetId: context.target.id,
        artifactId: artifact.id,
        platform: context.target.platform,
        mode: context.target.mode,
        status: 'PUBLISHED',
        sourceContentVersion: artifact.sourceContentVersion,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      if (error instanceof DistributionAdapterError && error.code === 'DISTRIBUTION_MANUAL_ONLY') {
        await this.repository.appendTargetEvent(context.target.id, {
          artifactId: artifact.id,
          fromStatus: context.target.status,
          toStatus: 'MANUAL_ACTION_REQUIRED',
          reasonCode: error.code,
          sourceContentVersion: artifact.sourceContentVersion,
          metadata: { capability: input.adapter.capability } as Prisma.InputJsonValue
        });
      }
      this.observability.emit('distribution.publish.failed', {
        projectId: context.project.id,
        targetId: context.target.id,
        artifactId: artifact.id,
        platform: context.target.platform,
        mode: context.target.mode,
        status: error instanceof DistributionAdapterError && error.code === 'DISTRIBUTION_MANUAL_ONLY'
          ? 'MANUAL_ACTION_REQUIRED'
          : context.target.status,
        reasonCode: error instanceof DistributionAdapterError
          ? error.code
          : error instanceof DistributionServiceError
            ? error.code
            : 'DISTRIBUTION_PUBLISH_FAILED',
        sourceContentVersion: artifact.sourceContentVersion,
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }

  async recordManualPublicationResult(input: {
    projectId: string;
    targetId: string;
    artifactId: string;
    publicUrl: string;
  }): Promise<{ status: 'PUBLISHED'; publicUrl: string }> {
    const context = await this.context(input.targetId, input.projectId);
    this.assertFeature(context);
    this.assertVerified(context);
    this.assertEntityActionSupported(context, 'manual-result');
    if (context.target.status !== 'MANUAL_ACTION_REQUIRED') {
      throw new DistributionServiceError(
        'DISTRIBUTION_MANUAL_ACTION_NOT_REQUIRED',
        'Manual publication result can only be recorded after a manual handoff'
      );
    }
    const artifact = await this.currentArtifact(context, input.artifactId);
    const publicUrl = requireHttpUrl(input.publicUrl);
    await this.repository.appendTargetEvent(context.target.id, {
      artifactId: artifact.id,
      fromStatus: context.target.status,
      toStatus: 'PUBLISHED',
      reasonCode: 'MANUAL_PUBLISH_RECORDED',
      sourceContentVersion: artifact.sourceContentVersion,
      metadata: {
        capability: 'MANUAL_HANDOFF',
        publicUrl,
        status: 'manual-published'
      } as Prisma.InputJsonValue
    });
    return { status: 'PUBLISHED', publicUrl };
  }

  async verifyPublishedArtifact(input: {
    projectId: string;
    targetId: string;
    artifactId: string;
    adapter: DistributionAdapter;
  }): Promise<DistributionVerifyResult> {
    const context = await this.context(input.targetId, input.projectId);
    this.assertFeature(context);
    this.assertVerified(context);
    this.assertEntityActionSupported(context, 'verify');
    if (context.target.status !== 'PUBLISHED') {
      throw new DistributionServiceError(
        'DISTRIBUTION_NOT_PUBLISHED',
        'Distribution artifact must be PUBLISHED before verification'
      );
    }
    if (
      input.adapter.capability !== 'PUBLISH_API'
      || input.adapter.platform !== context.target.platform
      || !input.adapter.verify
    ) {
      throw new DistributionServiceError(
        'DISTRIBUTION_VERIFY_NOT_SUPPORTED',
        'Distribution adapter does not support trusted verification'
      );
    }
    const artifact = await this.currentArtifact(context, input.artifactId);
    const publishEvent = await prisma.distributionTargetEvent.findFirst({
      where: {
        targetId: context.target.id,
        artifactId: artifact.id,
        toStatus: 'PUBLISHED'
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    if (!publishEvent) {
      throw new DistributionServiceError(
        'DISTRIBUTION_PUBLISH_RESULT_MISSING',
        'Published distribution result is missing'
      );
    }
    const frozenPublishResult = publishResultFromMetadata(publishEvent.metadata);
    const result = await input.adapter.verify(frozenPublishResult);
    await this.repository.appendTargetEvent(context.target.id, {
      artifactId: artifact.id,
      fromStatus: context.target.status,
      toStatus: result.verified ? 'VERIFIED' : 'FAILED',
      reasonCode: result.verified ? 'DISTRIBUTION_VERIFY_COMPLETED' : 'DISTRIBUTION_VERIFY_FAILED',
      sourceContentVersion: artifact.sourceContentVersion,
      metadata: {
        capability: input.adapter.capability,
        publicUrl: result.publicUrl ?? frozenPublishResult.publicUrl ?? null
      } as Prisma.InputJsonValue
    });
    return result;
  }
}

export const distributionService = new DistributionService();
