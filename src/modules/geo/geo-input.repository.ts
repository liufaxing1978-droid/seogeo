import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export interface CitabilityPageFact {
  pageId: string;
  normalizedUrl: string;
  statusCode: number | null;
  contentType: string | null;
  title: string | null;
  canonicalUrl: string | null;
  h1: string | null;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  wordCount: number;
  internalLinksCount: number;
  externalLinksCount: number;
  schemaCount: number;
  indexable: boolean | null;
}

export interface CitabilityPersistenceInput {
  pageId: string;
  answerFirstScore: number | null;
  headingStructureScore: number;
  factualDensityScore: number | null;
  sourceSupportScore: number;
  extractabilityScore: number;
  definitionClarityScore: number | null;
  overallScore: number;
  evidence: Record<string, unknown>;
}

export async function loadCitabilityPageFacts(
  geoAuditRunId: string
): Promise<CitabilityPageFact[]> {
  const audit = await prisma.geoAuditRun.findUnique({
    where: { id: geoAuditRunId },
    select: { crawlRunId: true }
  });

  if (!audit) throw new Error(`GeoAuditRun not found: ${geoAuditRunId}`);

  const snapshots = await prisma.pageSnapshot.findMany({
    where: { crawlRunId: audit.crawlRunId },
    include: { page: { select: { id: true, normalizedUrl: true } } },
    orderBy: { capturedAt: 'desc' }
  });

  const latestByPage = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latestByPage.has(snapshot.pageId)) latestByPage.set(snapshot.pageId, snapshot);
  }

  return [...latestByPage.values()]
    .sort((a, b) => a.page.normalizedUrl.localeCompare(b.page.normalizedUrl))
    .map((snapshot) => ({
      pageId: snapshot.page.id,
      normalizedUrl: snapshot.page.normalizedUrl,
      statusCode: snapshot.statusCode,
      contentType: snapshot.contentType,
      title: snapshot.title,
      canonicalUrl: snapshot.canonicalUrl,
      h1: snapshot.h1,
      h1Count: snapshot.h1Count,
      h2Count: snapshot.h2Count,
      h3Count: snapshot.h3Count,
      wordCount: snapshot.wordCount,
      internalLinksCount: snapshot.internalLinksCount,
      externalLinksCount: snapshot.externalLinksCount,
      schemaCount: snapshot.schemaCount,
      indexable: snapshot.indexable
    }));
}

export async function replaceCitabilityResults(
  geoAuditRunId: string,
  engineVersion: string,
  results: readonly CitabilityPersistenceInput[]
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.citabilityResult.deleteMany({ where: { geoAuditRunId } });

    for (const result of results) {
      await tx.citabilityResult.create({
        data: {
          geoAuditRunId,
          pageId: result.pageId,
          answerFirstScore: result.answerFirstScore,
          headingStructureScore: result.headingStructureScore,
          factualDensityScore: result.factualDensityScore,
          sourceSupportScore: result.sourceSupportScore,
          extractabilityScore: result.extractabilityScore,
          definitionClarityScore: result.definitionClarityScore,
          overallScore: result.overallScore,
          evidence: result.evidence as Prisma.InputJsonValue,
          engineVersion
        }
      });
    }
  });
}
