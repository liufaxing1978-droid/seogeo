import { describe, expect, it } from 'vitest';
import {
  calculateGrowthScore,
  known,
  notApplicable,
  scoreCtrGap,
  scoreDemand,
  scoreGscTrend,
  scoreP6Visibility,
  scorePositionPotential,
  scoreSiteGap,
  unknown
} from '../../src/modules/growth/growth-score.js';

describe('GROWTH_SCORE_V1 deterministic component scoring', () => {
  it.each([
    [100, 0.05, 100],
    [100, 0.10, 100],
    [100, 0.25, 85],
    [100, 0.50, 65],
    [100, 0.75, 40],
    [100, 0.90, 20],
    [0, 0.05, 0]
  ])('scores Demand impressions=%s percentile=%s as %s', (impressions, percentile, expected) => {
    expect(scoreDemand(impressions, percentile)).toEqual(known(expected));
  });

  it('keeps Demand unknown when source evidence is missing', () => {
    expect(scoreDemand(null, null)).toEqual(unknown());
  });

  it.each([
    [1, 40], [3, 40], [4, 100], [10, 100], [11, 85], [20, 85],
    [21, 60], [30, 60], [31, 30], [50, 30], [51, 10], [100, 10]
  ])('scores position %s as %s', (position, expected) => {
    expect(scorePositionPotential(position)).toEqual(known(expected));
  });

  it('keeps invalid position unknown', () => {
    expect(scorePositionPotential(null)).toEqual(unknown());
    expect(scorePositionPotential(0)).toEqual(unknown());
  });

  it.each([
    [0.04, 0.10, 100],
    [0.06, 0.10, 80],
    [0.08, 0.10, 60],
    [0.09, 0.10, 30],
    [0.096, 0.10, 0],
    [0.12, 0.10, 0]
  ])('scores CTR gap actual=%s expected=%s as %s', (actual, expectedCtr, expectedScore) => {
    expect(scoreCtrGap(actual, expectedCtr)).toEqual(known(expectedScore));
  });

  it('keeps CTR gap unknown when expected CTR is absent or non-positive', () => {
    expect(scoreCtrGap(0.1, null)).toEqual(unknown());
    expect(scoreCtrGap(0.1, 0)).toEqual(unknown());
  });

  it('scores Site Gap from deduped roots and excludes UNKNOWN from the denominator', () => {
    expect(scoreSiteGap([
      { state: 'FAIL', severity: 'HIGH' },
      { state: 'FAIL', severity: 'MEDIUM' },
      { state: 'PASS', severity: null },
      { state: 'UNKNOWN', severity: null }
    ])).toEqual(known(160 / 3));
  });

  it('returns NOT_APPLICABLE for only non-applicable site evidence and UNKNOWN for only unknown evidence', () => {
    expect(scoreSiteGap([{ state: 'NOT_APPLICABLE', severity: null }])).toEqual(notApplicable());
    expect(scoreSiteGap([{ state: 'UNKNOWN', severity: null }])).toEqual(unknown());
  });

  it('scores GSC deterioration using the mean of comparable metrics', () => {
    const result = scoreGscTrend(
      { impressions: 70, clicks: 85, ctr: 0.09, position: 11 },
      { impressions: 100, clicks: 100, ctr: 0.10, position: 10 }
    );
    // 30% -> 100, 15% -> 75, 10% -> 50, 10% position degradation -> 50.
    expect(result.state).toBe('KNOWN');
    expect(result.score).toBe(68.75);
  });

  it('treats a known previous zero as no decline rather than UNKNOWN', () => {
    expect(scoreGscTrend(
      { impressions: 10, clicks: 2, ctr: 0.2, position: 5 },
      { impressions: 0, clicks: 0, ctr: 0, position: 5 }
    )).toEqual(known(0));
  });

  it('returns UNKNOWN when no GSC trend metric is comparable', () => {
    expect(scoreGscTrend({}, {})).toEqual(unknown());
  });

  it('uses the maximum unique known adverse P6 signal and ignores became-unknown as numeric penalty', () => {
    expect(scoreP6Visibility([
      { kind: 'OWNED_DELTA', deltaBasisPoints: -250 },
      { kind: 'COMPETITOR_DELTA', deltaBasisPoints: 1200 },
      { kind: 'OWNED_VS_COMPETITOR_GAP', gapBasisPoints: 700 },
      { kind: 'METRIC_BECAME_UNKNOWN' }
    ])).toEqual(known(100));
  });

  it('returns P6 UNKNOWN when there is no mappable known numeric signal', () => {
    expect(scoreP6Visibility([{ kind: 'METRIC_BECAME_UNKNOWN' }])).toEqual(unknown());
  });
});

describe('GROWTH_SCORE_V1 weighted total and evidence quality', () => {
  it('matches the locked 83.5 -> 84 HIGH example', () => {
    expect(calculateGrowthScore({
      demand: known(90),
      positionPotential: known(100),
      ctrGap: known(80),
      siteGap: known(70),
      gscTrend: known(50),
      p6Visibility: known(50)
    })).toMatchObject({
      score: 84,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      availableWeight: 100,
      evidenceCoverage: 1,
      evidenceQuality: 'COMPLETE',
      rankingEligible: true,
      trendVisibilityDisplayScore: 50
    });
  });

  it('normalizes known weight without treating UNKNOWN as zero', () => {
    const result = calculateGrowthScore({
      demand: known(80),
      positionPotential: known(100),
      ctrGap: known(60),
      siteGap: known(60),
      gscTrend: unknown(),
      p6Visibility: unknown()
    });
    expect(result.availableWeight).toBe(90);
    expect(result.score).toBe(78);
    expect(result.evidenceQuality).toBe('PARTIAL');
    expect(result.rankingEligible).toBe(true);
  });

  it('allows a 50-69 diagnostic score but excludes it from ranking', () => {
    const result = calculateGrowthScore({
      demand: known(90),
      positionPotential: known(70),
      ctrGap: unknown(),
      siteGap: unknown(),
      gscTrend: unknown(),
      p6Visibility: unknown()
    });
    expect(result.availableWeight).toBe(55);
    expect(result.score).toBe(81);
    expect(result.priority).toBe('HIGH');
    expect(result.evidenceQuality).toBe('PARTIAL');
    expect(result.rankingEligible).toBe(false);
  });

  it('returns authoritative UNKNOWN below 50 available weight', () => {
    const result = calculateGrowthScore({
      demand: known(100),
      positionPotential: unknown(),
      ctrGap: unknown(),
      siteGap: unknown(),
      gscTrend: known(100),
      p6Visibility: unknown()
    });
    expect(result.availableWeight).toBe(36);
    expect(result.score).toBeNull();
    expect(result.priority).toBe('UNKNOWN');
    expect(result.scoreState).toBe('UNKNOWN');
    expect(result.evidenceQuality).toBe('UNKNOWN');
    expect(result.rankingEligible).toBe(false);
  });

  it('normalizes the 60/40 display signal over whichever trend/visibility components are known', () => {
    expect(calculateGrowthScore({
      demand: known(70), positionPotential: known(70), ctrGap: known(70), siteGap: known(70),
      gscTrend: known(80), p6Visibility: unknown()
    }).trendVisibilityDisplayScore).toBe(80);
    expect(calculateGrowthScore({
      demand: known(70), positionPotential: known(70), ctrGap: known(70), siteGap: known(70),
      gscTrend: unknown(), p6Visibility: known(25)
    }).trendVisibilityDisplayScore).toBe(25);
  });
});
