import type { AiTask, GeoDimension, GeoPriority, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiGatewayConfig } from './ai.config.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from './ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js';

const PROMPT_ID = 'geo-readiness-analysis-v1';
const MAX_CITABILITY_ROWS = 20;
const MAX_AI_CRAWLERS = 20;
const MAX_ENTITIES = 20;
const MAX_OBSERVATIONS_PER_ENTITY = 10;
const MAX_RELATIONS = 20;
const MAX_RULE_OPPORTUNITIES = 30;

export const GeoAnalysisSchema = z.object({
  summary: z.string().min(1),
  opportunities: z
    .array(
      z.object({
        priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        dimension: z.enum(['CITABILITY', 'ENTITY', 'AI_CRAWLER', 'BRAND', 'CONTENT_GEO']),
        title: z.string().min(1),
        recommendation: z.string().min(1),
        sourceRefs: z.array(z.string().min(1)).min(1)
      })
    )
    .max(12),
  unavailableFacts: z.array(z.string().min(1)).max(20)
});

export type GeoAnalysis = z.infer<typeof GeoAnalysisSchema>;

interface SourceReference {
  type: string;
  id: string;
}

interface GeoFactPacket {
  audit: {
    sourceRef: string;
    id: string;
    status: 'COMPLETED';
    eligiblePages: number;
    rulesEvaluated: number;
    engineVersion: string;
  };
  score: {
    sourceRef: string;
    scoreType: string;
    score: number;
    previousScore: number | null;
    change: number | null;
    formulaVersion: string;
    components: Array<{
      componentCode: string;
      componentName: string;
      rawScore: number;
      weight: number;
      weightedScore: number;
      sourceType: string;
      sourceReference: string | null;
    }>;
  } | null;
  citability: Array<{
    sourceRef: string;
    pageRef: string;
    url: string;
    answerFirstScore: number | null;
    headingStructureScore: number;
    factualDensityScore: number | null;
    sourceSupportScore: number;
    extractabilityScore: number;
    definitionClarityScore: number | null;
    overallScore: number;
    engineVersion: string;
  }>;
  aiCrawlers: Array<{
    sourceRef: string;
    crawlerCode: string;
    robotsAllowed: boolean | null;
    metaRobotsAllowed: boolean | null;
    xRobotsAllowed: boolean | null;
    reachable: boolean | null;
    status: 'PASS' | 'FAIL' | 'UNKNOWN';
  }>;
  entities: Array<{
    sourceRef: string;
    id: string;
    entityType: string;
    canonicalName: string;
    officialUrl: string | null;
    confidence: number;
    aliases: string[];
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
  brand: {
    sourceRef: string;
    officialIdentityPresent: boolean;
    organizationSchemaPresent: boolean;
    sameAsCount: number;
    publisherConsistency: number;
    contactIdentityConsistency: number;
    aboutPagePresent: boolean;
    overallScore: number;
  } | null;
  ruleOpportunities: Array<{
    sourceRef: string;
    ruleCode: string;
    ruleName: string;
    dimension: GeoDimension;
    priority: GeoPriority;
    outcome: 'FAIL';
    geoImpact: string;
    fixGuide: string;
    pageRef: string | null;
    pageUrl: string | null;
    entityRef: string | null;
  }>;
}

const PRIORITY_RANK: Record<GeoPriority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2
};

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

function packetLength(packet: GeoFactPacket): number {
  return JSON.stringify(packet).length;
}

function fitPacket(packet: GeoFactPacket, maxChars: number): GeoFactPacket {
  if (packetLength(packet) <= maxChars) return packet;

  const reduced: GeoFactPacket = {
    ...packet,
    citability: packet.citability.slice(0, 10),
    entities: packet.entities.slice(0, 10).map((entity) => ({
      ...entity,
      observations: entity.observations.slice(0, 3)
    })),
    relations: packet.relations.slice(0, 10),
    ruleOpportunities: packet.ruleOpportunities.slice(0, 15)
  };
  if (packetLength(reduced) <= maxChars) return reduced;

  const minimal: GeoFactPacket = {
    ...reduced,
    citability: reduced.citability.slice(0, 3),
    entities: reduced.entities.slice(0, 5).map((entity) => ({ ...entity, observations: [] })),
    relations: [],
    ruleOpportunities: reduced.ruleOpportunities.slice(0, 5)
  };
  if (packetLength(minimal) <= maxChars) return minimal;

  throw new AppError('GEO analysis fact packet exceeds the configured AI input limit', 413, 'AI_INPUT_TOO_LARGE');
}

function collectPacketReferences(packet: GeoFactPacket): SourceReference[] {
  const refs: SourceReference[] = [{ type: 'GEO_AUDIT', id: packet.audit.id }];
  if (packet.score) refs.push({ type: 'GEO_SCORE', id: packet.score.sourceRef.slice('GEO_SCORE:'.length) });
  for (const row of packet.citability) {
    refs.push({ type: 'CITABILITY_RESULT', id: row.sourceRef.slice('CITABILITY_RESULT:'.length) });
    refs.push({ type: 'PAGE', id: row.pageRef.slice('PAGE:'.length) });
  }
  for (const row of packet.aiCrawlers) {
    refs.push({ type: 'AI_CRAWLER_RESULT', id: row.sourceRef.slice('AI_CRAWLER_RESULT:'.length) });
  }
  for (const entity of packet.entities) {
    refs.push({ type: 'ENTITY', id: entity.id });
    for (const observation of entity.observations) {
      refs.push({ type: 'ENTITY_OBSERVATION', id: observation.sourceRef.slice('ENTITY_OBSERVATION:'.length) });
      if (observation.pageRef) refs.push({ type: 'PAGE', id: observation.pageRef.slice('PAGE:'.length) });
    }
  }
  for (const relation of packet.relations) {
    refs.push({ type: 'ENTITY_RELATION', id: relation.sourceRef.slice('ENTITY_RELATION:'.length) });
  }
  if (packet.brand) {
    refs.push({ type: 'BRAND_AUTHORITY_RESULT', id: packet.brand.sourceRef.slice('BRAND_AUTHORITY_RESULT:'.length) });
  }
  for (const opportunity of packet.ruleOpportunities) {
    refs.push({ type: 'GEO_RULE_RESULT', id: opportunity.sourceRef.slice('GEO_RULE_RESULT:'.length) });
    if (opportunity.pageRef) refs.push({ type: 'PAGE', id: opportunity.pageRef.slice('PAGE:'.length) });
    if (opportunity.entityRef) refs.push({ type: 'ENTITY', id: opportunity.entityRef.slice('ENTITY:'.length) });
  }
  return uniqueSourceReferences(refs);
}

export async function buildGeoAnalysisTaskInput(
  projectId: string,
  geoAuditRunId: string,
  maxInputChars = aiGatewayConfig.maxInputChars
): Promise<CreateAiTaskInput> {
  const audit = await prisma.geoAuditRun.findFirst({
    where: { id: geoAuditRunId, projectId },
    include: {
      geoScore: {
        include: { components: { orderBy: { weightedScore: 'desc' } } }
      },
      citabilityResults: {
        include: { page: { select: { id: true, normalizedUrl: true } } },
        orderBy: { overallScore: 'asc' },
        take: MAX_CITABILITY_ROWS
      },
      aiCrawlerResults: {
        orderBy: { crawlerCode: 'asc' },
        take: MAX_AI_CRAWLERS
      },
      brandAuthorityResult: true,
      ruleResults: {
        where: { outcome: 'FAIL' },
        include: {
          ruleVersion: { include: { geoRule: true } },
          page: { select: { id: true, normalizedUrl: true } },
          entity: { select: { id: true } }
        },
        take: MAX_RULE_OPPORTUNITIES * 2
      },
      entityObservations: {
        include: {
          entity: { include: { aliases: true } },
          page: { select: { id: true } }
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_ENTITIES * MAX_OBSERVATIONS_PER_ENTITY * 2
      }
    }
  });

  if (!audit) throw new NotFoundError('GEO audit not found for project', 'GEO_AUDIT_NOT_FOUND');
  if (audit.status !== 'COMPLETED') {
    throw new AppError('GEO analysis requires a completed deterministic audit', 409, 'GEO_AUDIT_NOT_COMPLETED');
  }

  const observationsByEntity = new Map<
    string,
    {
      entity: (typeof audit.entityObservations)[number]['entity'];
      observations: typeof audit.entityObservations;
    }
  >();
  for (const observation of audit.entityObservations) {
    const current = observationsByEntity.get(observation.entityId);
    if (current) {
      if (current.observations.length < MAX_OBSERVATIONS_PER_ENTITY) current.observations.push(observation);
    } else if (observationsByEntity.size < MAX_ENTITIES) {
      observationsByEntity.set(observation.entityId, { entity: observation.entity, observations: [observation] });
    }
  }

  const entityIds = [...observationsByEntity.keys()];
  const relations = entityIds.length
    ? await prisma.entityRelation.findMany({
        where: {
          projectId,
          OR: [{ sourceEntityId: { in: entityIds } }, { targetEntityId: { in: entityIds } }]
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_RELATIONS
      })
    : [];

  const ruleOpportunities = [...audit.ruleResults]
    .sort((left, right) => {
      const priority = PRIORITY_RANK[left.ruleVersion.severity] - PRIORITY_RANK[right.ruleVersion.severity];
      if (priority !== 0) return priority;
      return left.ruleVersion.geoRule.ruleCode.localeCompare(right.ruleVersion.geoRule.ruleCode);
    })
    .slice(0, MAX_RULE_OPPORTUNITIES);

  const packet: GeoFactPacket = {
    audit: {
      sourceRef: sourceRef('GEO_AUDIT', audit.id),
      id: audit.id,
      status: 'COMPLETED',
      eligiblePages: audit.eligiblePages,
      rulesEvaluated: audit.rulesEvaluated,
      engineVersion: audit.engineVersion
    },
    score: audit.geoScore
      ? {
          sourceRef: sourceRef('GEO_SCORE', audit.geoScore.id),
          scoreType: audit.geoScore.scoreType,
          score: audit.geoScore.score,
          previousScore: audit.geoScore.previousScore,
          change: audit.geoScore.change,
          formulaVersion: audit.geoScore.formulaVersion,
          components: audit.geoScore.components.map((component) => ({
            componentCode: component.componentCode,
            componentName: component.componentName,
            rawScore: component.rawScore,
            weight: component.weight,
            weightedScore: component.weightedScore,
            sourceType: component.sourceType,
            sourceReference: component.sourceReference
          }))
        }
      : null,
    citability: audit.citabilityResults.map((row) => ({
      sourceRef: sourceRef('CITABILITY_RESULT', row.id),
      pageRef: sourceRef('PAGE', row.pageId),
      url: safeUrl(row.page.normalizedUrl),
      answerFirstScore: row.answerFirstScore,
      headingStructureScore: row.headingStructureScore,
      factualDensityScore: row.factualDensityScore,
      sourceSupportScore: row.sourceSupportScore,
      extractabilityScore: row.extractabilityScore,
      definitionClarityScore: row.definitionClarityScore,
      overallScore: row.overallScore,
      engineVersion: row.engineVersion
    })),
    aiCrawlers: audit.aiCrawlerResults.map((row) => ({
      sourceRef: sourceRef('AI_CRAWLER_RESULT', row.id),
      crawlerCode: row.crawlerCode,
      robotsAllowed: row.robotsAllowed,
      metaRobotsAllowed: row.metaRobotsAllowed,
      xRobotsAllowed: row.xRobotsAllowed,
      reachable: row.reachable,
      status: row.status
    })),
    entities: [...observationsByEntity.values()].map(({ entity, observations }) => ({
      sourceRef: sourceRef('ENTITY', entity.id),
      id: entity.id,
      entityType: entity.entityType,
      canonicalName: cleanText(entity.canonicalName, 300),
      officialUrl: entity.officialUrl ? safeUrl(entity.officialUrl) : null,
      confidence: entity.confidence,
      aliases: entity.aliases.slice(0, 10).map((alias) => cleanText(alias.alias, 200)),
      observations: observations.map((observation) => ({
        sourceRef: sourceRef('ENTITY_OBSERVATION', observation.id),
        sourceType: observation.sourceType,
        property: cleanText(observation.property, 120),
        value: safeObservationValue(observation.value),
        pageRef: observation.pageId ? sourceRef('PAGE', observation.pageId) : null
      }))
    })),
    relations: relations.map((relation) => ({
      sourceRef: sourceRef('ENTITY_RELATION', relation.id),
      sourceEntityRef: sourceRef('ENTITY', relation.sourceEntityId),
      relationType: cleanText(relation.relationType, 120),
      targetEntityRef: sourceRef('ENTITY', relation.targetEntityId),
      confidence: relation.confidence,
      pageRef: relation.sourcePageId ? sourceRef('PAGE', relation.sourcePageId) : null
    })),
    brand: audit.brandAuthorityResult
      ? {
          sourceRef: sourceRef('BRAND_AUTHORITY_RESULT', audit.brandAuthorityResult.id),
          officialIdentityPresent: audit.brandAuthorityResult.officialIdentityPresent,
          organizationSchemaPresent: audit.brandAuthorityResult.organizationSchemaPresent,
          sameAsCount: audit.brandAuthorityResult.sameAsCount,
          publisherConsistency: audit.brandAuthorityResult.publisherConsistency,
          contactIdentityConsistency: audit.brandAuthorityResult.contactIdentityConsistency,
          aboutPagePresent: audit.brandAuthorityResult.aboutPagePresent,
          overallScore: audit.brandAuthorityResult.overallScore
        }
      : null,
    ruleOpportunities: ruleOpportunities.map((row) => ({
      sourceRef: sourceRef('GEO_RULE_RESULT', row.id),
      ruleCode: row.ruleVersion.geoRule.ruleCode,
      ruleName: row.ruleVersion.geoRule.name,
      dimension: row.ruleVersion.dimension,
      priority: row.ruleVersion.severity,
      outcome: 'FAIL',
      geoImpact: cleanText(row.ruleVersion.geoImpact, 1000),
      fixGuide: cleanText(row.ruleVersion.fixGuide, 1000),
      pageRef: row.pageId ? sourceRef('PAGE', row.pageId) : null,
      pageUrl: row.page ? safeUrl(row.page.normalizedUrl) : null,
      entityRef: row.entityId ? sourceRef('ENTITY', row.entityId) : null
    }))
  };

  const bounded = fitPacket(packet, maxInputChars);
  const refs = collectPacketReferences(bounded);

  return {
    projectId,
    taskType: 'GEO_READINESS_ANALYSIS',
    requestKey: `geo-audit:${audit.id}:${PROMPT_ID}`,
    promptVersion: PROMPT_ID,
    factSnapshot: bounded as unknown as Prisma.InputJsonValue,
    sourceReferences: refs as unknown as Prisma.InputJsonValue
  };
}

export async function createGeoAnalysisTask(
  projectId: string,
  geoAuditRunId: string,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService
): Promise<AiTask> {
  return service.createAndEnqueue(await buildGeoAnalysisTaskInput(projectId, geoAuditRunId));
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

export function parseGeoAnalysisOutput(content: string, sourceReferences: unknown): GeoAnalysis {
  const output = parseStructuredOutput(content, GeoAnalysisSchema);
  const allowed = allowedReferenceSet(sourceReferences);
  const returnedRefs = output.opportunities.flatMap((opportunity) => opportunity.sourceRefs);

  if (returnedRefs.some((ref) => !allowed.has(ref))) {
    throw new AiOutputValidationError('AI output contains a source reference that was not supplied');
  }

  return output;
}
