import type { AiTask, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiGatewayConfig } from './ai.config.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from './ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js';

const PROMPT_ID = 'entity-enrichment-v1';
const MAX_ENTITIES = 20;
const MAX_ALIASES = 10;
const MAX_OBSERVATIONS = 12;
const MAX_RELATIONS = 20;

export const EntityEnrichmentSchema = z.object({
  suggestions: z
    .array(
      z.object({
        entityId: z.string().uuid(),
        suggestedDescription: z.string().min(1).nullable(),
        suggestedAliases: z.array(z.string().min(1)).max(10),
        rationale: z.string().min(1),
        sourceRefs: z.array(z.string().min(1)).min(1)
      })
    )
    .max(20)
});

export type EntityEnrichment = z.infer<typeof EntityEnrichmentSchema>;

interface SourceReference {
  type: string;
  id: string;
}

interface EntityEnrichmentPacket {
  audit: {
    sourceRef: string;
    id: string;
    status: 'COMPLETED';
    engineVersion: string;
  };
  entities: Array<{
    sourceRef: string;
    id: string;
    entityType: string;
    canonicalName: string;
    officialUrl: string | null;
    confidence: number;
    aliases: Array<{ sourceRef: string; alias: string; sourceType: string }>;
    observations: Array<{
      sourceRef: string;
      sourceType: string;
      property: string;
      value: string;
      pageRef: string | null;
    }>;
  }>;
  relations: Array<{
    sourceRef: string;
    sourceEntityRef: string;
    relationType: string;
    targetEntityRef: string;
    confidence: number;
    pageRef: string | null;
  }>;
}

function sourceRef(type: string, id: string): string {
  return `${type}:${id}`;
}

function cleanText(value: string, maxLength = 500): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 1200);
  } catch {
    return value.split(/[?#]/, 1)[0]?.slice(0, 1200) ?? value.slice(0, 1200);
  }
}

function safeObservationValue(value: string): string {
  return /^https?:\/\//i.test(value) ? safeUrl(value) : cleanText(value);
}

function uniqueSourceReferences(refs: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = sourceRef(ref.type, ref.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function packetLength(packet: EntityEnrichmentPacket): number {
  return JSON.stringify(packet).length;
}

function fitPacket(packet: EntityEnrichmentPacket, maxChars: number): EntityEnrichmentPacket {
  if (packetLength(packet) <= maxChars) return packet;

  const reduced: EntityEnrichmentPacket = {
    ...packet,
    entities: packet.entities.slice(0, 10).map((entity) => ({
      ...entity,
      aliases: entity.aliases.slice(0, 5),
      observations: entity.observations.slice(0, 4)
    })),
    relations: packet.relations.slice(0, 10)
  };
  if (packetLength(reduced) <= maxChars) return reduced;

  const minimal: EntityEnrichmentPacket = {
    ...packet,
    entities: packet.entities.slice(0, 5).map((entity) => ({
      ...entity,
      aliases: entity.aliases.slice(0, 3),
      observations: []
    })),
    relations: []
  };
  if (packetLength(minimal) <= maxChars) return minimal;

  throw new AppError('Entity enrichment fact packet exceeds the configured AI input limit', 413, 'AI_INPUT_TOO_LARGE');
}

function collectReferences(packet: EntityEnrichmentPacket): SourceReference[] {
  const refs: SourceReference[] = [{ type: 'GEO_AUDIT', id: packet.audit.id }];
  for (const entity of packet.entities) {
    refs.push({ type: 'ENTITY', id: entity.id });
    for (const alias of entity.aliases) {
      refs.push({ type: 'ENTITY_ALIAS', id: alias.sourceRef.slice('ENTITY_ALIAS:'.length) });
    }
    for (const observation of entity.observations) {
      refs.push({ type: 'ENTITY_OBSERVATION', id: observation.sourceRef.slice('ENTITY_OBSERVATION:'.length) });
      if (observation.pageRef) refs.push({ type: 'PAGE', id: observation.pageRef.slice('PAGE:'.length) });
    }
  }
  for (const relation of packet.relations) {
    refs.push({ type: 'ENTITY_RELATION', id: relation.sourceRef.slice('ENTITY_RELATION:'.length) });
  }
  return uniqueSourceReferences(refs);
}

export async function buildEntityEnrichmentTaskInput(
  projectId: string,
  geoAuditRunId: string,
  maxInputChars = aiGatewayConfig.maxInputChars
): Promise<CreateAiTaskInput> {
  const audit = await prisma.geoAuditRun.findFirst({
    where: { id: geoAuditRunId, projectId },
    select: { id: true, status: true, engineVersion: true }
  });
  if (!audit) throw new NotFoundError('GEO audit not found for project', 'GEO_AUDIT_NOT_FOUND');
  if (audit.status !== 'COMPLETED') {
    throw new AppError('Entity enrichment requires a completed deterministic GEO audit', 409, 'GEO_AUDIT_NOT_COMPLETED');
  }

  const observations = await prisma.entityObservation.findMany({
    where: { geoAuditRunId },
    include: {
      entity: { include: { aliases: { orderBy: { normalizedAlias: 'asc' } } } }
    },
    orderBy: { createdAt: 'asc' }
  });

  const byEntity = new Map<string, typeof observations>();
  for (const observation of observations) {
    const rows = byEntity.get(observation.entityId) ?? [];
    if (rows.length < MAX_OBSERVATIONS) rows.push(observation);
    byEntity.set(observation.entityId, rows);
    if (byEntity.size >= MAX_ENTITIES && !byEntity.has(observation.entityId)) break;
  }

  const selected = [...byEntity.entries()].slice(0, MAX_ENTITIES);
  const entityIds = selected.map(([entityId]) => entityId);
  const relations = entityIds.length
    ? await prisma.entityRelation.findMany({
        where: {
          projectId,
          sourceEntityId: { in: entityIds },
          targetEntityId: { in: entityIds }
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_RELATIONS
      })
    : [];

  const packet: EntityEnrichmentPacket = {
    audit: {
      sourceRef: sourceRef('GEO_AUDIT', audit.id),
      id: audit.id,
      status: 'COMPLETED',
      engineVersion: audit.engineVersion
    },
    entities: selected.map(([entityId, rows]) => {
      const entity = rows[0]!.entity;
      return {
        sourceRef: sourceRef('ENTITY', entityId),
        id: entityId,
        entityType: entity.entityType,
        canonicalName: cleanText(entity.canonicalName, 300),
        officialUrl: entity.officialUrl ? safeUrl(entity.officialUrl) : null,
        confidence: entity.confidence,
        aliases: entity.aliases.slice(0, MAX_ALIASES).map((alias) => ({
          sourceRef: sourceRef('ENTITY_ALIAS', alias.id),
          alias: cleanText(alias.alias, 200),
          sourceType: alias.sourceType
        })),
        observations: rows.map((observation) => ({
          sourceRef: sourceRef('ENTITY_OBSERVATION', observation.id),
          sourceType: observation.sourceType,
          property: cleanText(observation.property, 120),
          value: safeObservationValue(observation.value),
          pageRef: observation.pageId ? sourceRef('PAGE', observation.pageId) : null
        }))
      };
    }),
    relations: relations.map((relation) => ({
      sourceRef: sourceRef('ENTITY_RELATION', relation.id),
      sourceEntityRef: sourceRef('ENTITY', relation.sourceEntityId),
      relationType: cleanText(relation.relationType, 120),
      targetEntityRef: sourceRef('ENTITY', relation.targetEntityId),
      confidence: relation.confidence,
      pageRef: relation.sourcePageId ? sourceRef('PAGE', relation.sourcePageId) : null
    }))
  };

  const bounded = fitPacket(packet, maxInputChars);
  return {
    projectId,
    taskType: 'ENTITY_ENRICHMENT',
    requestKey: `geo-audit:${audit.id}:${PROMPT_ID}`,
    promptVersion: PROMPT_ID,
    factSnapshot: bounded as unknown as Prisma.InputJsonValue,
    sourceReferences: collectReferences(bounded) as unknown as Prisma.InputJsonValue
  };
}

export async function createEntityEnrichmentTask(
  projectId: string,
  geoAuditRunId: string,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService
): Promise<AiTask> {
  return service.createAndEnqueue(await buildEntityEnrichmentTaskInput(projectId, geoAuditRunId));
}

function allowedReferenceSet(sourceReferences: unknown): Set<string> {
  if (!Array.isArray(sourceReferences)) return new Set();
  const allowed = new Set<string>();
  for (const ref of sourceReferences) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) continue;
    const type = (ref as Record<string, unknown>).type;
    const id = (ref as Record<string, unknown>).id;
    if (typeof type === 'string' && typeof id === 'string') allowed.add(sourceRef(type, id));
  }
  return allowed;
}

export function parseEntityEnrichmentOutput(content: string, sourceReferences: unknown): EntityEnrichment {
  const output = parseStructuredOutput(content, EntityEnrichmentSchema);
  const allowed = allowedReferenceSet(sourceReferences);
  const allowedEntityIds = new Set(
    [...allowed]
      .filter((ref) => ref.startsWith('ENTITY:'))
      .map((ref) => ref.slice('ENTITY:'.length))
  );

  for (const suggestion of output.suggestions) {
    if (!allowedEntityIds.has(suggestion.entityId)) {
      throw new AiOutputValidationError('AI output suggests an entity that was not supplied');
    }
    if (suggestion.sourceRefs.some((ref) => !allowed.has(ref))) {
      throw new AiOutputValidationError('AI output contains a source reference that was not supplied');
    }
  }
  return output;
}
