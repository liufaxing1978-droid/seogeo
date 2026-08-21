import { Prisma, type DistributionPlatform } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  resolveDistributionCapability,
  type DistributionCapability
} from './distribution-adapter.js';

const KNOWN_CAPABILITIES = new Set<DistributionCapability>([
  'PREPARE_ONLY',
  'MANUAL_HANDOFF',
  'PUBLISH_API'
]);

function objectRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function distributionCapabilityFromEvents(
  platform: DistributionPlatform,
  events: Array<{ metadata: Prisma.JsonValue | null }>
): DistributionCapability {
  for (const event of events) {
    const capability = objectRecord(event.metadata).capability;
    if (typeof capability === 'string' && KNOWN_CAPABILITIES.has(capability as DistributionCapability)) {
      return capability as DistributionCapability;
    }
  }
  return resolveDistributionCapability(platform, { trustedPublishAdapterConfigured: false });
}

export function distributionPublicUrlFromEvents(
  events: Array<{ metadata: Prisma.JsonValue | null }>
): string | null {
  for (const event of events) {
    const publicUrl = objectRecord(event.metadata).publicUrl;
    if (typeof publicUrl === 'string' && publicUrl.length > 0) return publicUrl;
  }
  return null;
}

export class DistributionWebRepository {
  async getCenter(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const [publications, targets] = await Promise.all([
      prisma.publicationExecution.findMany({
        where: { projectId, status: 'VERIFIED' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          plan: {
            select: {
              draftVersion: true,
              targetPublicUrl: true,
              draft: { select: { title: true } }
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 100
      }),
      prisma.distributionTarget.findMany({
        where: { projectId },
        include: {
          events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 },
          artifacts: { orderBy: [{ artifactVersion: 'desc' }, { id: 'desc' }], take: 1 }
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 200
      })
    ]);

    return {
      project,
      publications,
      targets: targets.map((target) => ({
        ...target,
        capability: distributionCapabilityFromEvents(target.platform, target.events),
        publicUrl: distributionPublicUrlFromEvents(target.events),
        latestArtifact: target.artifacts[0] ?? null
      }))
    };
  }

  async getTarget(projectId: string, targetId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const target = await prisma.distributionTarget.findFirst({
      where: { id: targetId, projectId },
      include: {
        events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 },
        artifacts: { orderBy: [{ artifactVersion: 'desc' }, { id: 'desc' }], take: 100 }
      }
    });
    if (!target) return null;

    const publication = await prisma.publicationExecution.findFirst({
      where: { id: target.publicationId, projectId },
      select: {
        id: true,
        status: true,
        plan: {
          select: {
            draftVersion: true,
            targetPublicUrl: true,
            draft: { select: { title: true } }
          }
        }
      }
    });
    if (!publication) return null;

    return {
      project,
      publication,
      target: {
        ...target,
        capability: distributionCapabilityFromEvents(target.platform, target.events),
        publicUrl: distributionPublicUrlFromEvents(target.events)
      }
    };
  }

  async getArtifact(projectId: string, targetId: string, artifactId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const artifact = await prisma.distributionArtifact.findFirst({
      where: { id: artifactId, targetId, projectId },
      include: {
        events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 },
        target: {
          include: {
            events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }
          }
        }
      }
    });
    if (!artifact || artifact.target.projectId !== projectId) return null;

    const publication = await prisma.publicationExecution.findFirst({
      where: { id: artifact.target.publicationId, projectId },
      select: {
        id: true,
        status: true,
        plan: {
          select: {
            draftVersion: true,
            targetPublicUrl: true,
            draft: { select: { title: true } }
          }
        }
      }
    });
    if (!publication) return null;

    return {
      project,
      publication,
      artifact: {
        ...artifact,
        publicUrl: distributionPublicUrlFromEvents(artifact.target.events)
      },
      target: {
        ...artifact.target,
        capability: distributionCapabilityFromEvents(artifact.target.platform, artifact.target.events),
        publicUrl: distributionPublicUrlFromEvents(artifact.target.events)
      }
    };
  }
}

export const distributionWebRepository = new DistributionWebRepository();