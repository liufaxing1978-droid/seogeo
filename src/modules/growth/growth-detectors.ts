import type { GrowthOpportunityType } from '@prisma/client';
import { dedupeGrowthEvidence, type GrowthEvidence } from './growth-evidence.js';
import type { GrowthComponent } from './growth-score.js';

export type NormalGrowthOpportunityType =
  | 'RANKING_UPSIDE'
  | 'CTR_UNDERPERFORMANCE'
  | 'SEO_GAP'
  | 'GEO_CITABILITY_GAP'
  | 'CONTENT_GAP'
  | 'AI_VISIBILITY_GAP'
  | 'DECLINING_PERFORMANCE';

export type GrowthOpportunitySignal = {
  type: NormalGrowthOpportunityType;
  signalScore: number;
  weightedContribution: number;
};

export type NormalOpportunityDetectorInput = {
  position: number | null;
  positionPotential: GrowthComponent;
  ctrGap: GrowthComponent;
  gscTrend: GrowthComponent;
  p6Visibility: GrowthComponent;
  evidence: readonly GrowthEvidence[];
};

const TYPE_WEIGHT: Record<NormalGrowthOpportunityType, number> = {
  RANKING_UPSIDE: 25,
  CTR_UNDERPERFORMANCE: 20,
  SEO_GAP: 15,
  GEO_CITABILITY_GAP: 15,
  CONTENT_GAP: 15,
  AI_VISIBILITY_GAP: 4,
  DECLINING_PERFORMANCE: 6
};

// Versioned fixed order used only for exact weighted-contribution ties.
export const NORMAL_OPPORTUNITY_CATALOG_ORDER: readonly NormalGrowthOpportunityType[] = [
  'DECLINING_PERFORMANCE',
  'RANKING_UPSIDE',
  'CTR_UNDERPERFORMANCE',
  'AI_VISIBILITY_GAP',
  'GEO_CITABILITY_GAP',
  'CONTENT_GAP',
  'SEO_GAP'
] as const;

const SEVERITY_SCORE = {
  HIGH: 100,
  MEDIUM: 60,
  LOW: 30,
  INFO: 10
} as const;

function knownScore(component: GrowthComponent): number | null {
  return component.state === 'KNOWN' ? component.score : null;
}

function signal(type: NormalGrowthOpportunityType, score: number): GrowthOpportunitySignal {
  return {
    type,
    signalScore: score,
    weightedContribution: (score * TYPE_WEIGHT[type]) / 100
  };
}

function actionableEvidenceScore(
  evidence: readonly GrowthEvidence[],
  predicate: (row: GrowthEvidence) => boolean
): number | null {
  const deduped = dedupeGrowthEvidence(evidence);
  const scores = deduped.scoringGroups
    .map((group) => group.representative)
    .filter((row) => predicate(row) && row.evidenceState === 'FAIL' && row.severity !== null && row.severity !== 'INFO')
    .map((row) => SEVERITY_SCORE[row.severity!]);
  return scores.length > 0 ? Math.max(...scores) : null;
}

export function detectNormalOpportunityTypes(
  input: NormalOpportunityDetectorInput
): GrowthOpportunitySignal[] {
  const signals: GrowthOpportunitySignal[] = [];

  const positionPotential = knownScore(input.positionPotential);
  if (
    input.position !== null && Number.isFinite(input.position) &&
    input.position >= 4 && input.position <= 20 &&
    positionPotential !== null
  ) {
    signals.push(signal('RANKING_UPSIDE', positionPotential));
  }

  const ctrGap = knownScore(input.ctrGap);
  if (ctrGap !== null && ctrGap >= 30) {
    signals.push(signal('CTR_UNDERPERFORMANCE', ctrGap));
  }

  const seoGap = actionableEvidenceScore(input.evidence, (row) => row.sourceModule === 'P2_SEO');
  if (seoGap !== null) signals.push(signal('SEO_GAP', seoGap));

  const geoGap = actionableEvidenceScore(
    input.evidence,
    (row) => row.sourceModule === 'P3_CITABILITY'
  );
  if (geoGap !== null) signals.push(signal('GEO_CITABILITY_GAP', geoGap));

  const contentGap = actionableEvidenceScore(
    input.evidence,
    (row) => row.sourceModule === 'P5_CONTENT' || row.sourceModule === 'P5_COMPETITOR'
  );
  if (contentGap !== null) signals.push(signal('CONTENT_GAP', contentGap));

  const p6Visibility = knownScore(input.p6Visibility);
  if (p6Visibility !== null && p6Visibility >= 25) {
    signals.push(signal('AI_VISIBILITY_GAP', p6Visibility));
  }

  const gscTrend = knownScore(input.gscTrend);
  if (gscTrend !== null && gscTrend >= 50) {
    signals.push(signal('DECLINING_PERFORMANCE', gscTrend));
  }

  return signals.sort(compareSignals);
}

function catalogIndex(type: NormalGrowthOpportunityType): number {
  return NORMAL_OPPORTUNITY_CATALOG_ORDER.indexOf(type);
}

function compareSignals(a: GrowthOpportunitySignal, b: GrowthOpportunitySignal): number {
  return (
    b.weightedContribution - a.weightedContribution ||
    catalogIndex(a.type) - catalogIndex(b.type) ||
    a.type.localeCompare(b.type)
  );
}

export function selectPrimaryType(
  signals: readonly GrowthOpportunitySignal[]
): { primaryType: GrowthOpportunityType; secondaryTypes: GrowthOpportunityType[] } {
  if (signals.length === 0) throw new Error('At least one triggered Growth opportunity signal is required');
  const ordered = [...signals].sort(compareSignals);
  return {
    primaryType: ordered[0]!.type,
    secondaryTypes: ordered.slice(1).map((row) => row.type)
  };
}
