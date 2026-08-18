import {
  loadCitabilityPageFacts,
  replaceCitabilityResults,
  type CitabilityPageFact,
  type CitabilityPersistenceInput
} from './geo-input.repository.js';
import { logGeoEvent } from './geo-observability.js';

export interface CitabilityEvidence {
  availability: {
    answerFirst: boolean;
    headingStructure: boolean;
    factualDensity: boolean;
    sourceSupport: boolean;
    extractability: boolean;
    definitionClarity: boolean;
  };
  eligibility: {
    statusCode: number | null;
    contentType: string | null;
    indexable: boolean | null;
  };
  headingStructure?: {
    h1Count: number;
    h2Count: number;
    h3Count: number;
  };
  sourceSupport?: {
    externalLinksCount: number;
    authorityEvaluated: false;
  };
  extractability?: {
    titlePresent: boolean;
    clearH1: boolean;
    canonicalPresent: boolean;
    schemaPresent: boolean;
    wordCount: number;
    indexable: boolean | null;
  };
  unknownReasons: string[];
}

export interface CitabilityAnalysis {
  pageId: string;
  eligible: boolean;
  answerFirstScore: number | null;
  headingStructureScore: number | null;
  factualDensityScore: number | null;
  sourceSupportScore: number | null;
  extractabilityScore: number | null;
  definitionClarityScore: number | null;
  overallScore: number | null;
  evidence: CitabilityEvidence;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function isEligibleHtmlPage(fact: CitabilityPageFact): boolean {
  const contentType = fact.contentType?.toLowerCase() ?? '';
  const html = contentType === 'text/html' || contentType === 'application/xhtml+xml';
  const successful = fact.statusCode !== null && fact.statusCode >= 200 && fact.statusCode < 300;
  return html && successful && fact.indexable !== false;
}

function scoreHeadingStructure(fact: CitabilityPageFact): number {
  let score = 0;

  if (fact.h1Count === 1) score += 60;
  else if (fact.h1Count > 1) score += 25;

  if (fact.h2Count >= 2) score += 30;
  else if (fact.h2Count === 1) score += 20;

  if (fact.h3Count > 0 && fact.h2Count > 0) score += 10;

  return clampScore(score);
}

function scoreSourceSupport(fact: CitabilityPageFact): number {
  if (fact.externalLinksCount <= 0) return 0;
  if (fact.externalLinksCount === 1) return 60;
  return 100;
}

function scoreExtractability(fact: CitabilityPageFact): number {
  let score = 0;

  if (fact.title?.trim()) score += 20;
  if (fact.h1Count === 1 && fact.h1?.trim()) score += 20;
  if (fact.canonicalUrl) score += 20;
  if (fact.schemaCount > 0) score += 15;
  if (fact.wordCount >= 200) score += 15;
  else if (fact.wordCount > 0) score += 5;
  if (fact.indexable === true) score += 10;

  return clampScore(score);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function analyzeCitability(fact: CitabilityPageFact): CitabilityAnalysis {
  const eligible = isEligibleHtmlPage(fact);
  const unknownReasons = [
    'answer-first structure is not persisted as a deterministic P1 fact',
    'factual density requires semantic evidence not available in P1',
    'definition clarity requires semantic evidence not available in P1'
  ];

  const evidence: CitabilityEvidence = {
    availability: {
      answerFirst: false,
      headingStructure: eligible,
      factualDensity: false,
      sourceSupport: eligible,
      extractability: eligible,
      definitionClarity: false
    },
    eligibility: {
      statusCode: fact.statusCode,
      contentType: fact.contentType,
      indexable: fact.indexable
    },
    unknownReasons
  };

  if (!eligible) {
    return {
      pageId: fact.pageId,
      eligible: false,
      answerFirstScore: null,
      headingStructureScore: null,
      factualDensityScore: null,
      sourceSupportScore: null,
      extractabilityScore: null,
      definitionClarityScore: null,
      overallScore: null,
      evidence
    };
  }

  const headingStructureScore = scoreHeadingStructure(fact);
  const sourceSupportScore = scoreSourceSupport(fact);
  const extractabilityScore = scoreExtractability(fact);

  evidence.headingStructure = {
    h1Count: fact.h1Count,
    h2Count: fact.h2Count,
    h3Count: fact.h3Count
  };
  evidence.sourceSupport = {
    externalLinksCount: fact.externalLinksCount,
    authorityEvaluated: false
  };
  evidence.extractability = {
    titlePresent: Boolean(fact.title?.trim()),
    clearH1: fact.h1Count === 1 && Boolean(fact.h1?.trim()),
    canonicalPresent: Boolean(fact.canonicalUrl),
    schemaPresent: fact.schemaCount > 0,
    wordCount: fact.wordCount,
    indexable: fact.indexable
  };

  return {
    pageId: fact.pageId,
    eligible: true,
    answerFirstScore: null,
    headingStructureScore,
    factualDensityScore: null,
    sourceSupportScore,
    extractabilityScore,
    definitionClarityScore: null,
    overallScore: average([headingStructureScore, sourceSupportScore, extractabilityScore]),
    evidence
  };
}

export async function calculateCitabilityForAudit(
  geoAuditRunId: string,
  engineVersion = 'citability-1'
): Promise<{ eligiblePages: number; persistedResults: number }> {
  const facts = await loadCitabilityPageFacts(geoAuditRunId);
  const analyses = facts.map(analyzeCitability);
  const persistable: CitabilityPersistenceInput[] = [];

  for (const analysis of analyses) {
    if (
      !analysis.eligible ||
      analysis.headingStructureScore === null ||
      analysis.sourceSupportScore === null ||
      analysis.extractabilityScore === null ||
      analysis.overallScore === null
    ) {
      continue;
    }

    persistable.push({
      pageId: analysis.pageId,
      answerFirstScore: analysis.answerFirstScore,
      headingStructureScore: analysis.headingStructureScore,
      factualDensityScore: analysis.factualDensityScore,
      sourceSupportScore: analysis.sourceSupportScore,
      extractabilityScore: analysis.extractabilityScore,
      definitionClarityScore: analysis.definitionClarityScore,
      overallScore: analysis.overallScore,
      evidence: analysis.evidence as unknown as Record<string, unknown>
    });
  }

  await replaceCitabilityResults(geoAuditRunId, engineVersion, persistable);
  logGeoEvent('geo.citability.calculated', {
    geoAuditRunId,
    factsEvaluated: facts.length,
    eligiblePages: persistable.length,
    persistedResults: persistable.length,
    engineVersion
  });

  return {
    eligiblePages: persistable.length,
    persistedResults: persistable.length
  };
}