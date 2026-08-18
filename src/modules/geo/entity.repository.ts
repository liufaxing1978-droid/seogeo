import type { EntityType, PageEntityRole } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export async function loadEntityAuditInput(geoAuditRunId: string) {
  const audit = await prisma.geoAuditRun.findUnique({
    where: { id: geoAuditRunId },
    select: { id: true, projectId: true, crawlRunId: true }
  });

  if (!audit) throw new Error(`GeoAuditRun not found: ${geoAuditRunId}`);

  const snapshots = await prisma.pageSnapshot.findMany({
    where: { crawlRunId: audit.crawlRunId },
    select: {
      id: true,
      pageId: true,
      capturedAt: true,
      page: { select: { normalizedUrl: true } }
    },
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }]
  });

  const latestByPage = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latestByPage.has(snapshot.pageId)) latestByPage.set(snapshot.pageId, snapshot);
  }

  const latestSnapshots = [...latestByPage.values()];
  const structured = latestSnapshots.length
    ? await prisma.pageStructuredSignal.findMany({
        where: { pageSnapshotId: { in: latestSnapshots.map((snapshot) => snapshot.id) } }
      })
    : [];
  const structuredBySnapshot = new Map(structured.map((signal) => [signal.pageSnapshotId, signal]));

  return {
    ...audit,
    pages: latestSnapshots.map((snapshot) => ({
      pageId: snapshot.pageId,
      normalizedUrl: snapshot.page.normalizedUrl,
      snapshotId: snapshot.id,
      structured: structuredBySnapshot.get(snapshot.id) ?? null
    }))
  };
}

export async function resetEntityObservationsForAudit(geoAuditRunId: string): Promise<void> {
  await prisma.entityObservation.deleteMany({ where: { geoAuditRunId } });
}

export async function upsertStableEntity(input: {
  projectId: string;
  entityType: EntityType;
  canonicalName: string;
  normalizedName: string;
  officialUrl: string | null;
  confidence: number;
}) {
  const existing = await prisma.entity.findUnique({
    where: {
      projectId_entityType_normalizedName: {
        projectId: input.projectId,
        entityType: input.entityType,
        normalizedName: input.normalizedName
      }
    }
  });

  if (existing) {
    if (!existing.officialUrl && input.officialUrl) {
      return prisma.entity.update({
        where: { id: existing.id },
        data: { officialUrl: input.officialUrl, confidence: Math.max(existing.confidence, input.confidence) }
      });
    }
    return existing;
  }

  return prisma.entity.create({
    data: {
      projectId: input.projectId,
      entityType: input.entityType,
      canonicalName: input.canonicalName,
      normalizedName: input.normalizedName,
      officialUrl: input.officialUrl,
      confidence: input.confidence
    }
  });
}

export async function upsertEntityAlias(input: {
  entityId: string;
  alias: string;
  normalizedAlias: string;
  sourceType: string;
}) {
  return prisma.entityAlias.upsert({
    where: {
      entityId_normalizedAlias: {
        entityId: input.entityId,
        normalizedAlias: input.normalizedAlias
      }
    },
    create: input,
    update: { alias: input.alias, sourceType: input.sourceType }
  });
}

export async function upsertPageEntity(input: {
  pageId: string;
  entityId: string;
  role: PageEntityRole;
  confidence: number;
  sourceType: string;
}) {
  return prisma.pageEntity.upsert({
    where: {
      pageId_entityId_role_sourceType: {
        pageId: input.pageId,
        entityId: input.entityId,
        role: input.role,
        sourceType: input.sourceType
      }
    },
    create: input,
    update: { confidence: input.confidence }
  });
}

export async function ensureEntityRelation(input: {
  projectId: string;
  sourceEntityId: string;
  relationType: string;
  targetEntityId: string;
  sourcePageId: string;
  confidence: number;
  evidence: Record<string, unknown>;
}) {
  const existing = await prisma.entityRelation.findFirst({
    where: {
      projectId: input.projectId,
      sourceEntityId: input.sourceEntityId,
      relationType: input.relationType,
      targetEntityId: input.targetEntityId,
      sourcePageId: input.sourcePageId
    }
  });

  if (existing) return existing;

  return prisma.entityRelation.create({
    data: {
      projectId: input.projectId,
      sourceEntityId: input.sourceEntityId,
      relationType: input.relationType,
      targetEntityId: input.targetEntityId,
      sourcePageId: input.sourcePageId,
      confidence: input.confidence,
      evidence: input.evidence as Prisma.InputJsonValue
    }
  });
}

export async function createEntityObservation(input: {
  geoAuditRunId: string;
  entityId: string;
  pageId: string;
  property: string;
  value: string;
  evidence: Record<string, unknown>;
}) {
  return prisma.entityObservation.create({
    data: {
      geoAuditRunId: input.geoAuditRunId,
      entityId: input.entityId,
      pageId: input.pageId,
      sourceType: 'SCHEMA',
      property: input.property,
      value: input.value,
      evidence: input.evidence as Prisma.InputJsonValue
    }
  });
}
