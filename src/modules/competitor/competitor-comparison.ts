import { Prisma } from '@prisma/client';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

export const COMPETITOR_COMPARISON_VERSION = 'COMPETITOR_COMPARISON_V1';

type MetricValue = number | null;
export type GapState = 'AHEAD' | 'BEHIND' | 'EVEN' | 'UNKNOWN';

export interface CompetitorMetrics {
  pagesSampled: number;
  successShare: MetricValue;
  averageWordCount: MetricValue;
  titlePresenceShare: MetricValue;
  h1PresenceShare: MetricValue;
  averageHeadingCount: MetricValue;
  averageInternalLinkCount: MetricValue;
  structuredDataPresenceShare: MetricValue;
  indexableShare: MetricValue;
}

export interface CompetitorGap {
  metric: keyof CompetitorMetrics;
  owned: MetricValue;
  competitor: MetricValue;
  delta: MetricValue;
  state: GapState;
}

function average(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!known.length) return null;
  return known.reduce((sum, value) => sum + value, 0) / known.length;
}

function share(values: Array<boolean | null | undefined>): number | null {
  const known = values.filter((value): value is boolean => typeof value === 'boolean');
  if (!known.length) return null;
  return known.filter(Boolean).length / known.length;
}

function present(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value.trim().length > 0;
}

function ownedMetrics(rows: Array<{ title: string | null; h1: string | null; wordCount: number | null; headingCount: number | null; internalLinkCount: number | null; schemaTypes: Prisma.JsonValue; canonicalUrl: string }>): CompetitorMetrics {
  return {
    pagesSampled: rows.length,
    successShare: rows.length ? 1 : null,
    averageWordCount: average(rows.map((row) => row.wordCount)),
    titlePresenceShare: share(rows.map((row) => present(row.title))),
    h1PresenceShare: share(rows.map((row) => present(row.h1))),
    averageHeadingCount: average(rows.map((row) => row.headingCount)),
    averageInternalLinkCount: average(rows.map((row) => row.internalLinkCount)),
    structuredDataPresenceShare: share(rows.map((row) => Array.isArray(row.schemaTypes) ? row.schemaTypes.length > 0 : null)),
    indexableShare: null
  };
}

function competitorMetrics(rows: Array<{ statusCode: number | null; title: string | null; h1: string | null; wordCount: number | null; headingCount: number | null; internalLinkCount: number | null; schemaCount: number | null; indexable: boolean | null }>): CompetitorMetrics {
  return {
    pagesSampled: rows.length,
    successShare: share(rows.map((row) => row.statusCode === null ? null : row.statusCode >= 200 && row.statusCode < 300)),
    averageWordCount: average(rows.map((row) => row.wordCount)),
    titlePresenceShare: share(rows.map((row) => present(row.title))),
    h1PresenceShare: share(rows.map((row) => present(row.h1))),
    averageHeadingCount: average(rows.map((row) => row.headingCount)),
    averageInternalLinkCount: average(rows.map((row) => row.internalLinkCount)),
    structuredDataPresenceShare: share(rows.map((row) => row.schemaCount === null ? null : row.schemaCount > 0)),
    indexableShare: share(rows.map((row) => row.indexable))
  };
}

const TOLERANCE: Partial<Record<keyof CompetitorMetrics, number>> = {
  successShare: 0.05,
  averageWordCount: 100,
  titlePresenceShare: 0.05,
  h1PresenceShare: 0.05,
  averageHeadingCount: 1,
  averageInternalLinkCount: 1,
  structuredDataPresenceShare: 0.05,
  indexableShare: 0.05
};

function compareMetric(metric: keyof CompetitorMetrics, owned: MetricValue, competitor: MetricValue): CompetitorGap {
  if (owned === null || competitor === null) return { metric, owned, competitor, delta: null, state: 'UNKNOWN' };
  const delta = owned - competitor;
  const tolerance = TOLERANCE[metric] ?? 0;
  return { metric, owned, competitor, delta, state: Math.abs(delta) <= tolerance ? 'EVEN' : delta > 0 ? 'AHEAD' : 'BEHIND' };
}

export function buildCompetitorGaps(owned: CompetitorMetrics, competitor: CompetitorMetrics): CompetitorGap[] {
  return (Object.keys(owned) as Array<keyof CompetitorMetrics>)
    .filter((metric) => metric !== 'pagesSampled')
    .map((metric) => compareMetric(metric, owned[metric], competitor[metric]));
}

export async function createCompetitorComparison(projectId: string, competitorId: string) {
  const competitor = await prisma.competitor.findFirst({ where: { id: competitorId, projectId, status: 'ACTIVE' } });
  if (!competitor) throw new NotFoundError('Competitor not found', 'COMPETITOR_NOT_FOUND');
  const crawl = await prisma.competitorCrawl.findFirst({ where: { competitorId, status: 'COMPLETED' }, orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }] });
  if (!crawl) throw new AppError('A completed competitor crawl is required', 409, 'COMPETITOR_CRAWL_REQUIRED');
  const [ownedRows, rivalRows] = await Promise.all([
    prisma.contentDocument.findMany({ where: { projectId }, select: { title: true, h1: true, wordCount: true, headingCount: true, internalLinkCount: true, schemaTypes: true, canonicalUrl: true } }),
    prisma.competitorPageSnapshot.findMany({ where: { competitorCrawlId: crawl.id }, select: { id: true, statusCode: true, title: true, h1: true, wordCount: true, headingCount: true, internalLinkCount: true, schemaCount: true, indexable: true } })
  ]);
  if (!ownedRows.length) throw new AppError('Content refresh is required before competitor comparison', 409, 'CONTENT_REFRESH_REQUIRED');

  const owned = ownedMetrics(ownedRows);
  const rival = competitorMetrics(rivalRows);
  const gaps = buildCompetitorGaps(owned, rival);
  const sourceReferences = [
    ...ownedRows.map((row) => ({ type: 'CONTENT_URL', id: row.canonicalUrl })),
    ...rivalRows.map((row) => ({ type: 'COMPETITOR_PAGE_SNAPSHOT', id: row.id }))
  ];

  return prisma.competitorComparison.upsert({
    where: { projectId_competitorCrawlId_comparisonVersion: { projectId, competitorCrawlId: crawl.id, comparisonVersion: COMPETITOR_COMPARISON_VERSION } },
    create: { projectId, competitorId, competitorCrawlId: crawl.id, comparisonVersion: COMPETITOR_COMPARISON_VERSION, ownedMetrics: owned as unknown as Prisma.InputJsonValue, competitorMetrics: rival as unknown as Prisma.InputJsonValue, gaps: gaps as unknown as Prisma.InputJsonValue, sourceReferences: sourceReferences as unknown as Prisma.InputJsonValue },
    update: { ownedMetrics: owned as unknown as Prisma.InputJsonValue, competitorMetrics: rival as unknown as Prisma.InputJsonValue, gaps: gaps as unknown as Prisma.InputJsonValue, sourceReferences: sourceReferences as unknown as Prisma.InputJsonValue }
  });
}
