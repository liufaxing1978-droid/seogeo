export type NewContentPageInput = {
  canonicalPage: string;
  impressions: number;
  position: number | null;
};

export type NewContentOpportunityInput = {
  normalizedQuery: string;
  demandScore: number | null;
  queryImpressions: number;
  projectP50Impressions: number | null;
  pages: readonly NewContentPageInput[];
};

export type NewContentContext = {
  hasCoverageGap: boolean | null;
  hasDeterministicDuplicateLandingPage: boolean | null;
  evidenceKnown: boolean;
  cannibalizationActive: boolean;
};

export type NewContentOpportunityResult = {
  state: 'DETECTED' | 'NOT_DETECTED' | 'UNKNOWN';
  type: 'NEW_CONTENT_OPPORTUNITY';
  reasonCodes: string[];
};

function result(
  state: NewContentOpportunityResult['state'],
  reasonCode: string
): NewContentOpportunityResult {
  return { state, type: 'NEW_CONTENT_OPPORTUNITY', reasonCodes: [reasonCode] };
}

export function detectNewContentOpportunity(
  input: NewContentOpportunityInput,
  context: NewContentContext
): NewContentOpportunityResult {
  if (!input.normalizedQuery.trim()) throw new Error('normalizedQuery is required');
  if (!context.evidenceKnown) return result('UNKNOWN', 'EVIDENCE_INSUFFICIENT');
  if (input.demandScore === null || !Number.isFinite(input.demandScore)) return result('UNKNOWN', 'DEMAND_UNKNOWN');
  if (input.projectP50Impressions === null || !Number.isFinite(input.projectP50Impressions)) {
    return result('UNKNOWN', 'PROJECT_P50_UNKNOWN');
  }
  if (!Number.isFinite(input.queryImpressions) || input.queryImpressions <= 0) return result('UNKNOWN', 'QUERY_IMPRESSIONS_UNKNOWN');
  if (input.pages.length === 0) return result('UNKNOWN', 'EXISTING_PAGE_EVIDENCE_MISSING');
  if (input.pages.some((page) => !Number.isFinite(page.impressions) || page.impressions < 0 || page.position === null || !Number.isFinite(page.position) || page.position <= 0)) {
    return result('UNKNOWN', 'PAGE_METRICS_UNKNOWN');
  }
  if (context.hasCoverageGap === null) return result('UNKNOWN', 'COVERAGE_GAP_UNKNOWN');
  if (context.hasDeterministicDuplicateLandingPage === null) return result('UNKNOWN', 'DUPLICATE_LANDING_PAGE_UNKNOWN');

  if (context.cannibalizationActive) return result('NOT_DETECTED', 'CANNIBALIZATION_PRECEDENCE');
  if (input.demandScore < 65) return result('NOT_DETECTED', 'DEMAND_BELOW_THRESHOLD');
  if (input.queryImpressions < input.projectP50Impressions) return result('NOT_DETECTED', 'IMPRESSIONS_BELOW_PROJECT_P50');

  const bestPosition = Math.min(...input.pages.map((page) => page.position!));
  if (bestPosition <= 20) return result('NOT_DETECTED', 'EXISTING_PAGE_RANKS_TOP_20');

  const dominantShare = Math.max(...input.pages.map((page) => page.impressions / input.queryImpressions));
  if (!Number.isFinite(dominantShare)) return result('UNKNOWN', 'PAGE_SHARE_UNKNOWN');
  if (dominantShare >= 0.70) return result('NOT_DETECTED', 'DOMINANT_EXISTING_PAGE');

  if (!context.hasCoverageGap) return result('NOT_DETECTED', 'NO_P3_P5_COVERAGE_GAP');
  if (context.hasDeterministicDuplicateLandingPage) return result('NOT_DETECTED', 'DUPLICATE_LANDING_PAGE_PRESENT');

  return {
    state: 'DETECTED',
    type: 'NEW_CONTENT_OPPORTUNITY',
    reasonCodes: [
      'DEMAND_ELIGIBLE',
      'IMPRESSIONS_AT_OR_ABOVE_PROJECT_P50',
      'NO_TOP_20_EXISTING_PAGE',
      'NO_DOMINANT_EXISTING_PAGE',
      'P3_P5_COVERAGE_GAP',
      'NO_DETERMINISTIC_DUPLICATE'
    ]
  };
}
