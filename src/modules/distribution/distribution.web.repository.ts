import { Prisma, type DistributionMode, type DistributionPlatform } from '@prisma/client';
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

export type CommunityDistributionReview = {
  kind: 'COMMUNITY';
  label: 'Community GEO · 人工发布';
  question: string | null;
  topicUrl: string | null;
  includeBrandLink: boolean;
  brandLinkIncluded: boolean;
  promotionalLanguageDetected: boolean;
  contextHash: string | null;
};

export type EntityDistributionReview = {
  kind: 'ENTITY';
  label: 'Entity Suggestion · 人工编辑清单';
  entityName: string | null;
  attributes: Array<{ property: string; value: string; sourceRefs: string[] }>;
  sameAs: Array<{ url: string; sourceRefs: string[] }>;
  reliableSourceRefs: string[];
  missingData: string[];
  policyReminders: string[];
  humanChecklist: string[];
};

export type DistributionReview = CommunityDistributionReview | EntityDistributionReview;

function objectRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
  return clean || null;
}

function boundedStringList(
  value: unknown,
  maxItems: number,
  maxLength: number
): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value.slice(0, maxItems)) {
    const clean = boundedString(item, maxLength);
    if (clean) result.push(clean);
  }
  return result;
}

function decodeCommunityReview(
  targetContext: Prisma.JsonValue | null,
  platformMetadata: Prisma.JsonValue | null
): CommunityDistributionReview {
  const context = objectRecord(targetContext);
  const metadata = objectRecord(platformMetadata);
  const contextHash = boundedString(metadata.contextHash, 64);
  return {
    kind: 'COMMUNITY',
    label: 'Community GEO · 人工发布',
    question: boundedString(context.question, 4_000),
    topicUrl: boundedString(context.topicUrl, 2_048),
    includeBrandLink: context.includeBrandLink === true,
    brandLinkIncluded: metadata.brandLinkIncluded === true,
    promotionalLanguageDetected: metadata.promotionalLanguageDetected === true,
    contextHash: contextHash && /^[a-f0-9]{64}$/i.test(contextHash) ? contextHash : null
  };
}

function decodeEntityReview(platformMetadata: Prisma.JsonValue | null): EntityDistributionReview {
  const metadata = objectRecord(platformMetadata);
  const attributes = Array.isArray(metadata.attributes)
    ? metadata.attributes.slice(0, 40).flatMap((item) => {
      const record = objectRecord(item as Prisma.JsonValue);
      const property = boundedString(record.property, 300);
      const value = boundedString(record.value, 2_000);
      if (!property || !value) return [];
      return [{
        property,
        value,
        sourceRefs: boundedStringList(record.sourceRefs, 40, 300)
      }];
    })
    : [];
  const sameAs = Array.isArray(metadata.sameAs)
    ? metadata.sameAs.slice(0, 40).flatMap((item) => {
      const record = objectRecord(item as Prisma.JsonValue);
      const url = boundedString(record.url, 2_048);
      if (!url) return [];
      return [{ url, sourceRefs: boundedStringList(record.sourceRefs, 40, 300) }];
    })
    : [];

  return {
    kind: 'ENTITY',
    label: 'Entity Suggestion · 人工编辑清单',
    entityName: boundedString(metadata.entityName, 300),
    attributes,
    sameAs,
    reliableSourceRefs: boundedStringList(metadata.reliableSourceRefs, 40, 300),
    missingData: boundedStringList(metadata.missingData, 40, 1_000),
    policyReminders: boundedStringList(metadata.policyReminders, 40, 1_000),
    humanChecklist: boundedStringList(metadata.humanChecklist, 40, 1_000)
  };
}

export function distributionReviewFromPersistedData(input: {
  mode: DistributionMode;
  targetContext: Prisma.JsonValue | null;
  platformMetadata: Prisma.JsonValue | null;
}): DistributionReview | null {
  if (input.mode === 'COMMUNITY_DRAFT') {
    return decodeCommunityReview(input.targetContext, input.platformMetadata);
  }
  if (input.mode === 'ENTITY_SUGGESTION') {
    return decodeEntityReview(input.platformMetadata);
  }
  return null;
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

function safeEvent<T extends { metadata: Prisma.JsonValue | null }>(event: T) {
  const { metadata: _metadata, ...safe } = event;
  return safe;
}

function safeArtifact<T extends { platformMetadata: Prisma.JsonValue | null }>(artifact: T) {
  const { platformMetadata: _platformMetadata, ...safe } = artifact;
  return safe;
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
      targets: targets.map((target) => {
        const latestArtifact = target.artifacts[0] ?? null;
        const review = distributionReviewFromPersistedData({
          mode: target.mode,
          targetContext: target.targetContext,
          platformMetadata: latestArtifact?.platformMetadata ?? null
        });
        const capability = distributionCapabilityFromEvents(target.platform, target.events);
        const publicUrl = distributionPublicUrlFromEvents(target.events);
        const { events: _events, artifacts: _artifacts, targetContext: _targetContext, ...safeTarget } = target;
        return {
          ...safeTarget,
          capability,
          publicUrl,
          review,
          latestArtifact: latestArtifact ? safeArtifact(latestArtifact) : null
        };
      })
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

    const latestArtifact = target.artifacts[0] ?? null;
    const review = distributionReviewFromPersistedData({
      mode: target.mode,
      targetContext: target.targetContext,
      platformMetadata: latestArtifact?.platformMetadata ?? null
    });
    const capability = distributionCapabilityFromEvents(target.platform, target.events);
    const publicUrl = distributionPublicUrlFromEvents(target.events);
    const { events, artifacts, targetContext: _targetContext, ...safeTarget } = target;

    return {
      project,
      publication,
      target: {
        ...safeTarget,
        events: events.map(safeEvent),
        artifacts: artifacts.map(safeArtifact),
        capability,
        publicUrl,
        review
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

    const review = distributionReviewFromPersistedData({
      mode: artifact.target.mode,
      targetContext: artifact.target.targetContext,
      platformMetadata: artifact.platformMetadata
    });
    const capability = distributionCapabilityFromEvents(artifact.target.platform, artifact.target.events);
    const publicUrl = distributionPublicUrlFromEvents(artifact.target.events);
    const { events: artifactEvents, target: artifactTarget, platformMetadata: _platformMetadata, ...safeArtifactFields } = artifact;
    const { events: targetEvents, targetContext: _targetContext, ...safeTarget } = artifactTarget;

    return {
      project,
      publication,
      artifact: {
        ...safeArtifactFields,
        events: artifactEvents.map(safeEvent),
        publicUrl,
        review
      },
      target: {
        ...safeTarget,
        events: targetEvents.map(safeEvent),
        capability,
        publicUrl,
        review
      }
    };
  }
}

export const distributionWebRepository = new DistributionWebRepository();