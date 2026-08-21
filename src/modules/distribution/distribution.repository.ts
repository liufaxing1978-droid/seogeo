import { Prisma, type DistributionStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type {
  AppendDistributionTargetEventInput,
  CreateDistributionArtifactInput,
  EnsureDistributionTargetInput,
  MarkDistributionSourceVersionOutdatedInput
} from './distribution.types.js';

function inputJson(value: Prisma.InputJsonValue | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : value;
}

export class DistributionRepository {
  async ensureTarget(input: EnsureDistributionTargetInput) {
    const publication = await prisma.publicationExecution.findFirst({
      where: {
        id: input.publicationId,
        projectId: input.projectId
      },
      select: {
        id: true,
        plan: {
          select: {
            draftVersion: true
          }
        }
      }
    });
    if (!publication) throw new Error('DISTRIBUTION_PRIMARY_NOT_FOUND');

    return prisma.distributionTarget.upsert({
      where: {
        publicationId_platform_mode_targetKey: {
          publicationId: input.publicationId,
          platform: input.platform,
          mode: input.mode,
          targetKey: input.targetKey
        }
      },
      create: {
        projectId: input.projectId,
        publicationId: input.publicationId,
        platform: input.platform,
        mode: input.mode,
        targetKey: input.targetKey,
        status: 'NOT_PREPARED',
        sourceContentVersion: publication.plan.draftVersion
      },
      update: {}
    });
  }

  listTargetsForPublication(publicationId: string) {
    return prisma.distributionTarget.findMany({
      where: { publicationId },
      orderBy: [
        { platform: 'asc' },
        { mode: 'asc' },
        { targetKey: 'asc' },
        { id: 'asc' }
      ]
    });
  }

  getTarget(targetId: string) {
    return prisma.distributionTarget.findUnique({ where: { id: targetId } });
  }

  async createArtifact(targetId: string, input: CreateDistributionArtifactInput) {
    return prisma.$transaction(async (tx) => {
      const target = await tx.distributionTarget.findUnique({ where: { id: targetId } });
      if (!target) throw new Error('DISTRIBUTION_TARGET_NOT_FOUND');

      const artifact = await tx.distributionArtifact.create({
        data: {
          targetId,
          projectId: target.projectId,
          sourceContentVersion: input.sourceContentVersion,
          adaptationVersion: input.adaptationVersion,
          artifactVersion: input.artifactVersion,
          artifactHash: input.artifactHash,
          title: input.title ?? null,
          body: input.body,
          originalUrl: input.originalUrl,
          canonicalUrl: input.canonicalUrl ?? null,
          sourceRefs: input.sourceRefs
        }
      });

      const nextSourceVersion = Math.max(
        target.sourceContentVersion ?? input.sourceContentVersion,
        input.sourceContentVersion
      );

      await tx.distributionTargetEvent.create({
        data: {
          targetId,
          artifactId: artifact.id,
          fromStatus: target.status,
          toStatus: 'DRAFT_READY',
          reasonCode: 'ARTIFACT_PREPARED',
          sourceContentVersion: input.sourceContentVersion
        }
      });

      await tx.distributionTarget.update({
        where: { id: targetId },
        data: {
          status: 'DRAFT_READY',
          sourceContentVersion: nextSourceVersion
        }
      });

      return artifact;
    });
  }

  async appendTargetEvent(targetId: string, input: AppendDistributionTargetEventInput) {
    return prisma.$transaction(async (tx) => {
      const target = await tx.distributionTarget.findUnique({ where: { id: targetId } });
      if (!target) throw new Error('DISTRIBUTION_TARGET_NOT_FOUND');

      if (input.artifactId) {
        const artifact = await tx.distributionArtifact.findFirst({
          where: { id: input.artifactId, targetId },
          select: { id: true }
        });
        if (!artifact) throw new Error('DISTRIBUTION_ARTIFACT_NOT_FOUND');
      }

      const event = await tx.distributionTargetEvent.create({
        data: {
          targetId,
          artifactId: input.artifactId ?? null,
          fromStatus: input.fromStatus === undefined ? target.status : input.fromStatus,
          toStatus: input.toStatus,
          reasonCode: input.reasonCode,
          sourceContentVersion: input.sourceContentVersion ?? null,
          ...(input.metadata !== undefined ? { metadata: inputJson(input.metadata) } : {})
        }
      });

      const nextSourceVersion = input.sourceContentVersion === undefined || input.sourceContentVersion === null
        ? target.sourceContentVersion
        : Math.max(target.sourceContentVersion ?? input.sourceContentVersion, input.sourceContentVersion);

      await tx.distributionTarget.update({
        where: { id: targetId },
        data: {
          status: input.toStatus,
          sourceContentVersion: nextSourceVersion
        }
      });

      return event;
    });
  }

  listTargetEvents(targetId: string) {
    return prisma.distributionTargetEvent.findMany({
      where: { targetId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
  }

  async markSourceVersionOutdated(input: MarkDistributionSourceVersionOutdatedInput) {
    return prisma.$transaction(async (tx) => {
      const targets = await tx.distributionTarget.findMany({
        where: { publicationId: input.publicationId },
        include: {
          artifacts: {
            where: {
              sourceContentVersion: { lt: input.currentSourceContentVersion }
            },
            orderBy: [{ artifactVersion: 'asc' }, { id: 'asc' }]
          }
        },
        orderBy: [{ id: 'asc' }]
      });

      for (const target of targets) {
        if (target.artifacts.length === 0) {
          if ((target.sourceContentVersion ?? 0) < input.currentSourceContentVersion) {
            await tx.distributionTarget.update({
              where: { id: target.id },
              data: { sourceContentVersion: input.currentSourceContentVersion }
            });
          }
          continue;
        }

        await tx.distributionTarget.update({
          where: { id: target.id },
          data: {
            status: 'OUTDATED',
            sourceContentVersion: input.currentSourceContentVersion
          }
        });

        for (const artifact of target.artifacts) {
          await tx.distributionTargetEvent.create({
            data: {
              targetId: target.id,
              artifactId: artifact.id,
              fromStatus: target.status,
              toStatus: 'OUTDATED',
              reasonCode: input.reasonCode,
              sourceContentVersion: input.currentSourceContentVersion
            }
          });
        }
      }

      return targets.length;
    });
  }

  async listArtifacts(targetId: string) {
    const target = await prisma.distributionTarget.findUnique({
      where: { id: targetId },
      include: {
        artifacts: {
          include: {
            events: {
              orderBy: [{ createdAt: 'desc' }],
              take: 1
            }
          },
          orderBy: [{ artifactVersion: 'asc' }, { id: 'asc' }]
        }
      }
    });
    if (!target) return [];

    return target.artifacts.map((artifact) => {
      const latestArtifactEvent = artifact.events[0];
      let effectiveStatus: DistributionStatus;
      if (latestArtifactEvent) {
        effectiveStatus = latestArtifactEvent.toStatus;
      } else if (
        target.sourceContentVersion !== null
        && artifact.sourceContentVersion < target.sourceContentVersion
      ) {
        effectiveStatus = 'OUTDATED';
      } else {
        effectiveStatus = target.status;
      }

      const { events: _events, ...frozenArtifact } = artifact;
      return {
        ...frozenArtifact,
        effectiveStatus
      };
    });
  }
}
