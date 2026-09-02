export const KEYWORD_OPPORTUNITY_FORMULA_VERSION = 'keyword-opportunity-v1';
export const KEYWORD_OPPORTUNITY_MIN_KNOWN_WEIGHT = 30;

export const KEYWORD_OPPORTUNITY_WEIGHTS = Object.freeze({
  relevance: 25,
  demand: 15,
  rankingOpportunity: 15,
  difficulty: 10,
  contentGap: 10,
  authorityFit: 10,
  strategicValue: 10,
  geoValue: 5,
});

export type KeywordOpportunityComponentName = keyof typeof KEYWORD_OPPORTUNITY_WEIGHTS;
export type KeywordOpportunityEvidenceState = 'KNOWN' | 'UNKNOWN' | 'NOT_APPLICABLE';

export type KeywordOpportunityComponentInput = {
  state: KeywordOpportunityEvidenceState;
  score: number | null;
  provenance: string[];
};

export type KeywordOpportunityScoreInput = {
  components: Record<KeywordOpportunityComponentName, KeywordOpportunityComponentInput>;
};

export type KeywordOpportunityBreakdownEntry = KeywordOpportunityComponentInput & {
  weight: number;
  weightedContribution: number | null;
};

export type KeywordOpportunityScoreResult = {
  score: number | null;
  dataConfidence: number;
  breakdown: Record<KeywordOpportunityComponentName, KeywordOpportunityBreakdownEntry>;
  sourceProvenance: Array<{ component: KeywordOpportunityComponentName; sources: string[] }>;
  formulaVersion: typeof KEYWORD_OPPORTUNITY_FORMULA_VERSION;
};

const componentNames = Object.keys(KEYWORD_OPPORTUNITY_WEIGHTS) as KeywordOpportunityComponentName[];
const totalWeight = componentNames.reduce(
  (sum, component) => sum + KEYWORD_OPPORTUNITY_WEIGHTS[component],
  0,
);

function rounded(value: number, precision = 4): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function scoreKeywordOpportunity(
  input: KeywordOpportunityScoreInput,
): KeywordOpportunityScoreResult {
  let knownWeight = 0;
  let weightedScore = 0;
  const breakdown = {} as KeywordOpportunityScoreResult['breakdown'];

  for (const component of componentNames) {
    const evidence = input.components[component];
    const weight = KEYWORD_OPPORTUNITY_WEIGHTS[component];

    if (evidence.state === 'KNOWN') {
      if (evidence.score === null || evidence.score < 0 || evidence.score > 100) {
        throw new RangeError('Opportunity component score must be between 0 and 100');
      }
      knownWeight += weight;
      weightedScore += evidence.score * weight;
    } else if (evidence.score !== null) {
      throw new RangeError('Unknown opportunity components cannot contain a score');
    }

    breakdown[component] = {
      ...evidence,
      provenance: [...evidence.provenance],
      weight,
      weightedContribution: evidence.state === 'KNOWN'
        ? rounded(evidence.score! * weight / totalWeight)
        : null,
    };
  }

  return {
    score: knownWeight >= KEYWORD_OPPORTUNITY_MIN_KNOWN_WEIGHT
      ? rounded(weightedScore / knownWeight, 2)
      : null,
    dataConfidence: rounded(knownWeight / totalWeight),
    breakdown,
    sourceProvenance: componentNames.map((component) => ({
      component,
      sources: [...input.components[component].provenance],
    })),
    formulaVersion: KEYWORD_OPPORTUNITY_FORMULA_VERSION,
  };
}
