import { describe, expect, it } from 'vitest';
import {
  CTR_CURVE_MIN_BUCKET_SAMPLES,
  CTR_CURVE_MIN_ROW_IMPRESSIONS,
  PROJECT_CTR_CURVE_VERSION,
  buildProjectCtrCurve
} from '../../src/modules/growth/ctr-curve.js';

function sample(index: number, overrides: Partial<{
  normalizedQuery: string;
  canonicalPage: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}> = {}) {
  return {
    normalizedQuery: overrides.normalizedQuery ?? `query-${index}`,
    canonicalPage: overrides.canonicalPage ?? `https://example.com/page-${index}`,
    impressions: overrides.impressions ?? 10,
    clicks: overrides.clicks ?? 1,
    ctr: overrides.ctr ?? 0.1,
    position: overrides.position ?? 8
  };
}

describe('P7-A PROJECT_CTR_CURVE_V1', () => {
  it('uses the locked eligibility constants', () => {
    expect(PROJECT_CTR_CURVE_VERSION).toBe('PROJECT_CTR_CURVE_V1');
    expect(CTR_CURVE_MIN_ROW_IMPRESSIONS).toBe(10);
    expect(CTR_CURVE_MIN_BUCKET_SAMPLES).toBe(30);
  });

  it('returns the median CTR for a position bucket only after 30 eligible aggregate samples', () => {
    const eligible = Array.from({ length: 30 }, (_, index) => sample(index, {
      ctr: index < 15 ? 0.1 : 0.2,
      position: 8,
      impressions: 10
    }));
    const lowImpressionNoise = Array.from({ length: 20 }, (_, index) => sample(index + 100, {
      ctr: 0.9,
      position: 8,
      impressions: 9
    }));

    const curve = buildProjectCtrCurve([...eligible, ...lowImpressionNoise]);

    expect(curve.version).toBe('PROJECT_CTR_CURVE_V1');
    expect(curve.buckets['6-10']).toEqual({
      state: 'KNOWN',
      sampleCount: 30,
      expectedCtr: 0.15
    });
  });

  it('keeps an under-sampled bucket explicitly UNKNOWN instead of borrowing another or industry CTR curve', () => {
    const samples = Array.from({ length: 29 }, (_, index) => sample(index, {
      ctr: 0.12,
      position: 4.5,
      impressions: 100
    }));

    const curve = buildProjectCtrCurve(samples);

    expect(curve.buckets['4-5']).toEqual({
      state: 'UNKNOWN',
      sampleCount: 29,
      expectedCtr: null
    });
    expect(curve.buckets['6-10']).toEqual({
      state: 'UNKNOWN',
      sampleCount: 0,
      expectedCtr: null
    });
  });

  it('uses all locked position buckets including >50', () => {
    const positions = [
      ['1', 1],
      ['2', 2],
      ['3', 3],
      ['4-5', 5],
      ['6-10', 10],
      ['11-20', 20],
      ['21-30', 30],
      ['31-50', 50],
      ['>50', 51]
    ] as const;

    const samples = positions.flatMap(([bucket, position], bucketIndex) =>
      Array.from({ length: 30 }, (_, index) => sample(bucketIndex * 100 + index, {
        position,
        ctr: 0.01 * (bucketIndex + 1),
        impressions: 10
      }))
    );

    const curve = buildProjectCtrCurve(samples);

    for (let index = 0; index < positions.length; index += 1) {
      const [bucket] = positions[index];
      expect(curve.buckets[bucket]).toMatchObject({
        state: 'KNOWN',
        sampleCount: 30,
        expectedCtr: 0.01 * (index + 1)
      });
    }
  });
});
