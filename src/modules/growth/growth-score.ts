import type { GrowthEvidenceSeverity, GrowthPriority } from '@prisma/client';

export const GROWTH_SCORE_VERSION = 'GROWTH_SCORE_V1' as const;

export const GROWTH_SCORE_WEIGHTS = {
  demand: 30,
  positionPotential: 25,
  ctrGap: 20,
  siteGap: 15,
  gscTrend: 6,
  p6Visibility: 4
} as const;

export type GrowthComponent =
  | { state: 'KNOWN'; score: number }
  | { state: 'UNKNOWN'; score: null }
  | { state: 'NOT_APPLICABLE'; score: null };

export type SiteGapEvidence = {
  state: 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';
  severity: GrowthEvidenceSeverity | null;
};

export type GscTrendMetrics = {
  impressions?: number | null;
  clicks?: number | null;
  ctr?: number | null;
  position?: number | null;
};

export type P6VisibilitySignal =
  | { kind: 'OWNED_DELTA'; deltaBasisPoints: number }
  | { kind: 'COMPETITOR_DELTA'; deltaBasisPoints: number }
  | { kind: 'OWNED_VS_COMPETITOR_GAP'; gapBasisPoints: number }
  | { kind: 'METRIC_BECAME_UNKNOWN' };

export type GrowthScoreInput = {
  demand: GrowthComponent;
  positionPotential: GrowthComponent;
  ctrGap: GrowthComponent;
  siteGap: GrowthComponent;
  gscTrend: GrowthComponent;
  p6Visibility: GrowthComponent;
};

export type GrowthScoreResult = {
  formulaVersion: typeof GROWTH_SCORE_VERSION;
  score: number | null;
  priority: GrowthPriority;
  scoreState: 'KNOWN' | 'UNKNOWN';
  availableWeight: number;
  evidenceCoverage: number;
  evidenceQuality: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  rankingEligible: boolean;
  trendVisibilityDisplayScore: number | null;
  weightedTotal: number | null;
};

function assertScore(score: number): number {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError('Growth component score must be finite and between 0 and 100');
  }
  return score;
}

export function known(score: number): GrowthComponent {
  return { state: 'KNOWN', score: assertScore(score) };
}

export function unknown(): GrowthComponent {
  return { state: 'UNKNOWN', score: null };
}

export function notApplicable(): GrowthComponent {
  return { state: 'NOT_APPLICABLE', score: null };
}

export function scoreDemand(impressions: number | null, percentile: number | null): GrowthComponent {
  if (impressions === null || percentile === null || !Number.isFinite(impressions) || !Number.isFinite(percentile)) {
    return unknown();
  }
  if (impressions < 0 || percentile < 0 || percentile > 1) return unknown();
  if (impressions === 0) return known(0);
  if (percentile <= 0.10) return known(100);
  if (percentile <= 0.25) return known(85);
  if (percentile <= 0.50) return known(65);
  if (percentile <= 0.75) return known(40);
  return known(20);
}

export function scorePositionPotential(position: number | null): GrowthComponent {
  if (position === null || !Number.isFinite(position) || position <= 0) return unknown();
  if (position <= 3) return known(40);
  if (position <= 10) return known(100);
  if (position <= 20) return known(85);
  if (position <= 30) return known(60);
  if (position <= 50) return known(30);
  return known(10);
}

export function scoreCtrGap(actualCtr: number | null, expectedCtr: number | null): GrowthComponent {
  if (
    actualCtr === null || expectedCtr === null ||
    !Number.isFinite(actualCtr) || !Number.isFinite(expectedCtr) ||
    actualCtr < 0 || expectedCtr <= 0
  ) return unknown();

  const gap = Math.max(0, (expectedCtr - actualCtr) / expectedCtr);
  const epsilon = 1e-12;
  if (gap + epsilon >= 0.60) return known(100);
  if (gap + epsilon >= 0.40) return known(80);
  if (gap + epsilon >= 0.20) return known(60);
  if (gap + epsilon >= 0.05) return known(30);
  return known(0);
}

const SITE_GAP_UNITS: Record<GrowthEvidenceSeverity, number> = {
  HIGH: 100,
  MEDIUM: 60,
  LOW: 30,
  INFO: 10
};

export function scoreSiteGap(evidence: readonly SiteGapEvidence[]): GrowthComponent {
  let sum = 0;
  let denominator = 0;
  let sawUnknown = false;
  let sawNotApplicable = false;

  for (const row of evidence) {
    if (row.state === 'UNKNOWN') {
      sawUnknown = true;
      continue;
    }
    if (row.state === 'NOT_APPLICABLE') {
      sawNotApplicable = true;
      continue;
    }
    if (row.state === 'PASS') {
      denominator += 1;
      continue;
    }
    if (row.state === 'FAIL') {
      if (!row.severity) {
        sawUnknown = true;
        continue;
      }
      denominator += 1;
      sum += SITE_GAP_UNITS[row.severity];
    }
  }

  if (denominator > 0) return known(sum / denominator);
  if (sawUnknown) return unknown();
  if (sawNotApplicable) return notApplicable();
  return unknown();
}

function degradationScore(ratio: number): number {
  const epsilon = 1e-12;
  if (ratio + epsilon >= 0.30) return 100;
  if (ratio + epsilon >= 0.15) return 75;
  if (ratio + epsilon >= 0.05) return 50;
  if (ratio > epsilon) return 20;
  return 0;
}

function comparableDecline(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (
    current === null || current === undefined || previous === null || previous === undefined ||
    !Number.isFinite(current) || !Number.isFinite(previous) || current < 0 || previous < 0
  ) return null;
  if (previous === 0) return 0;
  return Math.max(0, (previous - current) / previous);
}

function comparablePositionDegradation(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (
    current === null || current === undefined || previous === null || previous === undefined ||
    !Number.isFinite(current) || !Number.isFinite(previous) || current <= 0 || previous <= 0
  ) return null;
  return Math.max(0, (current - previous) / previous);
}

export function scoreGscTrend(current: GscTrendMetrics, previous: GscTrendMetrics): GrowthComponent {
  const ratios = [
    comparableDecline(current.impressions, previous.impressions),
    comparableDecline(current.clicks, previous.clicks),
    comparableDecline(current.ctr, previous.ctr),
    comparablePositionDegradation(current.position, previous.position)
  ].filter((value): value is number => value !== null);

  if (ratios.length === 0) return unknown();
  return known(ratios.reduce((sum, ratio) => sum + degradationScore(ratio), 0) / ratios.length);
}

function deltaSeverity(absBasisPoints: number): number {
  if (absBasisPoints >= 1000) return 100;
  if (absBasisPoints >= 500) return 75;
  if (absBasisPoints >= 200) return 50;
  if (absBasisPoints >= 1) return 25;
  return 0;
}

function gapSeverity(gapBasisPoints: number): number {
  if (gapBasisPoints >= 2000) return 100;
  if (gapBasisPoints >= 1000) return 75;
  if (gapBasisPoints >= 500) return 50;
  if (gapBasisPoints >= 1) return 25;
  return 0;
}

export function scoreP6Visibility(signals: readonly P6VisibilitySignal[]): GrowthComponent {
  const scores: number[] = [];
  for (const signal of signals) {
    if (signal.kind === 'METRIC_BECAME_UNKNOWN') continue;
    if (signal.kind === 'OWNED_DELTA') {
      if (!Number.isFinite(signal.deltaBasisPoints)) continue;
      scores.push(signal.deltaBasisPoints < 0 ? deltaSeverity(Math.abs(signal.deltaBasisPoints)) : 0);
      continue;
    }
    if (signal.kind === 'COMPETITOR_DELTA') {
      if (!Number.isFinite(signal.deltaBasisPoints)) continue;
      scores.push(signal.deltaBasisPoints > 0 ? deltaSeverity(signal.deltaBasisPoints) : 0);
      continue;
    }
    if (!Number.isFinite(signal.gapBasisPoints)) continue;
    scores.push(signal.gapBasisPoints > 0 ? gapSeverity(signal.gapBasisPoints) : 0);
  }
  if (scores.length === 0) return unknown();
  return known(Math.max(...scores));
}

function priorityFor(score: number): GrowthPriority {
  if (score >= 85) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score >= 25) return 'LOW';
  return 'MONITOR';
}

function trendVisibilityDisplayScore(gsc: GrowthComponent, p6: GrowthComponent): number | null {
  let numerator = 0;
  let denominator = 0;
  if (gsc.state === 'KNOWN') {
    numerator += gsc.score * 60;
    denominator += 60;
  }
  if (p6.state === 'KNOWN') {
    numerator += p6.score * 40;
    denominator += 40;
  }
  return denominator > 0 ? numerator / denominator : null;
}

export function calculateGrowthScore(input: GrowthScoreInput): GrowthScoreResult {
  const components = [
    [input.demand, GROWTH_SCORE_WEIGHTS.demand],
    [input.positionPotential, GROWTH_SCORE_WEIGHTS.positionPotential],
    [input.ctrGap, GROWTH_SCORE_WEIGHTS.ctrGap],
    [input.siteGap, GROWTH_SCORE_WEIGHTS.siteGap],
    [input.gscTrend, GROWTH_SCORE_WEIGHTS.gscTrend],
    [input.p6Visibility, GROWTH_SCORE_WEIGHTS.p6Visibility]
  ] as const;

  let weighted = 0;
  let availableWeight = 0;
  for (const [component, weight] of components) {
    if (component.state !== 'KNOWN') continue;
    weighted += component.score * weight;
    availableWeight += weight;
  }

  const evidenceCoverage = availableWeight / 100;
  const display = trendVisibilityDisplayScore(input.gscTrend, input.p6Visibility);

  if (availableWeight < 50) {
    return {
      formulaVersion: GROWTH_SCORE_VERSION,
      score: null,
      priority: 'UNKNOWN',
      scoreState: 'UNKNOWN',
      availableWeight,
      evidenceCoverage,
      evidenceQuality: 'UNKNOWN',
      rankingEligible: false,
      trendVisibilityDisplayScore: display,
      weightedTotal: null
    };
  }

  const normalized = weighted / availableWeight;
  const score = Math.round(normalized);
  const evidenceQuality = availableWeight === 100 ? 'COMPLETE' : 'PARTIAL';

  return {
    formulaVersion: GROWTH_SCORE_VERSION,
    score,
    priority: priorityFor(score),
    scoreState: 'KNOWN',
    availableWeight,
    evidenceCoverage,
    evidenceQuality,
    rankingEligible: availableWeight >= 70,
    trendVisibilityDisplayScore: display,
    weightedTotal: weighted
  };
}
