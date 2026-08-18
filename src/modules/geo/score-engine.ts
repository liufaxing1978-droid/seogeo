import { prisma } from '../../db/prisma.js';
import { logGeoEvent } from './geo-observability.js';

export interface GeoReadinessDimensionInput {
  citability: number | null;
  entity: number | null;
  aiCrawler: number | null;
  brand: number | null;
  contentGeo: number | null;
}

export interface GeoReadinessComponent {
  componentCode: 'CITABILITY' | 'ENTITY' | 'AI_CRAWLER' | 'BRAND' | 'CONTENT_GEO';
  componentName: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  sourceType: string;
}

export interface GeoReadinessCalculation {
  scoreType: 'GEO_READINESS_V1';
  formulaVersion: 'GEO_READINESS_V1_NORMALIZED_AVAILABLE';
  score: number | null;
  availableWeight: number;
  components: GeoReadinessComponent[];
}

const DIMENSIONS = [
  { key: 'citability', code: 'CITABILITY', name: 'Citability', weight: 30, sourceType: 'CITABILITY_RESULTS' },
  { key: 'entity', code: 'ENTITY', name: 'Entity Authority / Clarity', weight: 25, sourceType: 'ENTITY_OBSERVATIONS' },
  { key: 'aiCrawler', code: 'AI_CRAWLER', name: 'Technical AI Readiness', weight: 20, sourceType: 'AI_CRAWLER_RESULTS' },
  { key: 'brand', code: 'BRAND', name: 'Brand Authority / Consistency', weight: 15, sourceType: 'BRAND_READINESS' },
  { key: 'contentGeo', code: 'CONTENT_GEO', name: 'Content GEO Quality', weight: 10, sourceType: 'PAGE_FACTS' }
] as const;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateGeoReadinessScore(input: GeoReadinessDimensionInput): GeoReadinessCalculation {
  const available = DIMENSIONS.flatMap((dimension) => {
    const value = input[dimension.key];
    if (value === null || !Number.isFinite(value)) return [];
    return [{ ...dimension, rawScore: clamp(value) }];
  });
  const availableWeight = available.reduce((sum, dimension) => sum + dimension.weight, 0);

  if (availableWeight === 0) {
    return {
      scoreType: 'GEO_READINESS_V1',
      formulaVersion: 'GEO_READINESS_V1_NORMALIZED_AVAILABLE',
      score: null,
      availableWeight: 0,
      components: []
    };
  }

  const components: GeoReadinessComponent[] = available.map((dimension) => ({
    componentCode: dimension.code,
    componentName: dimension.name,
    rawScore: round2(dimension.rawScore),
    weight: dimension.weight,
    weightedScore: round2((dimension.rawScore * dimension.weight) / availableWeight),
    sourceType: dimension.sourceType
  }));

  return {
    scoreType: 'GEO_READINESS_V1',
    formulaVersion: 'GEO_READINESS_V1_NORMALIZED_AVAILABLE',
    score: round2(components.reduce((sum, component) => sum + component.weightedScore, 0)),
    availableWeight,
    components
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

async function loadCitabilityScore(geoAuditRunId: string): Promise<number | null> {
  const rows = await prisma.citabilityResult.findMany({
    where: { geoAuditRunId },
    select: { overallScore: true }
  });
  return average(rows.map((row) => row.overallScore));
}

async function loadEntityScore(geoAuditRunId: string, eligiblePages: number): Promise<number | null> {
  if (eligiblePages === 0) return null;

  const observations = await prisma.entityObservation.findMany({
    where: { geoAuditRunId },
    include: { entity: { select: { id: true, entityType: true, officialUrl: true } } }
  });
  const entityIds = [...new Set(observations.map((row) => row.entityId))];
  const organizations = new Map(
    observations
      .filter((row) => row.entity.entityType === 'ORGANIZATION')
      .map((row) => [row.entity.id, row.entity])
  );

  let score = 0;
  if (organizations.size > 0) score += 25;
  if ([...organizations.values()].some((entity) => Boolean(entity.officialUrl))) score += 20;
  if (observations.some((row) => row.property === 'sameAs')) score += 15;
  if (observations.some((row) => row.property === '@id')) score += 15;

  const publisherCount = entityIds.length
    ? await prisma.pageEntity.count({
        where: { entityId: { in: entityIds }, role: 'PUBLISHER' }
      })
    : 0;
  if (publisherCount > 0) score += 15;

  const relationCount = entityIds.length
    ? await prisma.entityRelation.count({
        where: { sourceEntityId: { in: entityIds }, targetEntityId: { in: entityIds } }
      })
    : 0;
  if (relationCount > 0) score += 10;

  return score;
}

async function loadAiCrawlerScore(geoAuditRunId: string): Promise<number | null> {
  const rows = await prisma.aiCrawlerResult.findMany({
    where: { geoAuditRunId },
    select: { status: true }
  });
  const known = rows.filter((row) => row.status !== 'UNKNOWN');
  if (known.length === 0) return null;
  return round2((known.filter((row) => row.status === 'PASS').length / known.length) * 100);
}

async function loadBrandScore(geoAuditRunId: string): Promise<number | null> {
  const row = await prisma.brandAuthorityResult.findUnique({
    where: { geoAuditRunId },
    select: { overallScore: true }
  });
  return row?.overallScore ?? null;
}

function isSuccessfulHtml(snapshot: { statusCode: number | null; contentType: string | null }): boolean {
  const html = ['text/html', 'application/xhtml+xml'].includes(snapshot.contentType?.toLowerCase() ?? '');
  return snapshot.statusCode !== null && snapshot.statusCode >= 200 && snapshot.statusCode < 300 && html;
}

async function loadContentGeoScore(crawlRunId: string): Promise<number | null> {
  const snapshots = await prisma.pageSnapshot.findMany({
    where: { crawlRunId },
    orderBy: { capturedAt: 'desc' }
  });
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latest.has(snapshot.pageId)) latest.set(snapshot.pageId, snapshot);
  }

  const scores = [...latest.values()].filter(isSuccessfulHtml).map((snapshot) => {
    let score = 0;
    if (snapshot.h1Count === 1 && snapshot.h2Count >= 1) score += 25;
    else if (snapshot.h1Count === 1) score += 15;
    if (snapshot.externalLinksCount > 0) score += 15;
    if (snapshot.schemaCount > 0) score += 20;
    if (snapshot.canonicalUrl) score += 15;
    if (snapshot.indexable === true) score += 15;
    if (snapshot.wordCount >= 200) score += 10;
    return score;
  });

  return average(scores);
}

export async function calculateAndPersistGeoReadinessScore(
  geoAuditRunId: string,
  engineVersion: string
) {
  const audit = await prisma.geoAuditRun.findUnique({
    where: { id: geoAuditRunId },
    select: { projectId: true, crawlRunId: true, eligiblePages: true }
  });
  if (!audit) throw new Error(`GeoAuditRun not found: ${geoAuditRunId}`);

  const input: GeoReadinessDimensionInput = {
    citability: await loadCitabilityScore(geoAuditRunId),
    entity: await loadEntityScore(geoAuditRunId, audit.eligiblePages),
    aiCrawler: await loadAiCrawlerScore(geoAuditRunId),
    brand: await loadBrandScore(geoAuditRunId),
    contentGeo: await loadContentGeoScore(audit.crawlRunId)
  };
  const calculation = calculateGeoReadinessScore(input);
  if (calculation.score === null) return null;

  const previous = await prisma.geoScore.findFirst({
    where: {
      projectId: audit.projectId,
      scoreType: calculation.scoreType,
      geoAuditRunId: { not: geoAuditRunId }
    },
    orderBy: { calculatedAt: 'desc' },
    select: { score: true }
  });
  const previousScore = previous?.score ?? null;
  const change = previousScore === null ? null : round2(calculation.score - previousScore);

  const persisted = await prisma.$transaction(async (tx) => {
    const score = await tx.geoScore.upsert({
      where: { geoAuditRunId },
      create: {
        geoAuditRunId,
        projectId: audit.projectId,
        scoreType: calculation.scoreType,
        score: calculation.score!,
        previousScore,
        change,
        formulaVersion: calculation.formulaVersion,
        engineVersion
      },
      update: {
        scoreType: calculation.scoreType,
        score: calculation.score!,
        previousScore,
        change,
        formulaVersion: calculation.formulaVersion,
        engineVersion,
        calculatedAt: new Date()
      }
    });

    await tx.geoScoreComponent.deleteMany({ where: { geoScoreId: score.id } });
    for (const component of calculation.components) {
      await tx.geoScoreComponent.create({
        data: {
          geoScoreId: score.id,
          componentCode: component.componentCode,
          componentName: component.componentName,
          rawScore: component.rawScore,
          weight: component.weight,
          weightedScore: component.weightedScore,
          sourceType: component.sourceType,
          sourceReference: `geoAuditRun:${geoAuditRunId}`
        }
      });
    }

    return tx.geoScore.findUniqueOrThrow({
      where: { id: score.id },
      include: { components: { orderBy: { componentCode: 'asc' } } }
    });
  });

  logGeoEvent('geo.score.calculated', {
    geoAuditRunId,
    scoreType: persisted.scoreType,
    score: persisted.score,
    previousScore: persisted.previousScore,
    change: persisted.change,
    componentCount: persisted.components.length,
    formulaVersion: persisted.formulaVersion,
    engineVersion
  });
  return persisted;
}
