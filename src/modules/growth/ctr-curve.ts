import {
  PROJECT_CTR_BUCKETS,
  type ProjectCtrBucket,
  type ProjectCtrBucketKey,
  type ProjectCtrCurveV1,
  type QueryPageAggregate
} from './growth.types.js';

export const PROJECT_CTR_CURVE_VERSION = 'PROJECT_CTR_CURVE_V1' as const;
export const CTR_CURVE_MIN_ROW_IMPRESSIONS = 10;
export const CTR_CURVE_MIN_BUCKET_SAMPLES = 30;

function positionBucket(position: number): ProjectCtrBucketKey | null {
  if (!Number.isFinite(position) || position <= 0) return null;
  if (position < 2) return '1';
  if (position < 3) return '2';
  if (position < 4) return '3';
  if (position < 6) return '4-5';
  if (position < 11) return '6-10';
  if (position < 21) return '11-20';
  if (position < 31) return '21-30';
  if (position < 51) return '31-50';
  return '>50';
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number(value.toFixed(12));
}

function isEligibleSample(sample: QueryPageAggregate): sample is QueryPageAggregate & { position: number } {
  return (
    sample.impressions >= CTR_CURVE_MIN_ROW_IMPRESSIONS &&
    Number.isFinite(sample.impressions) &&
    Number.isFinite(sample.ctr) &&
    sample.ctr >= 0 &&
    sample.ctr <= 1 &&
    typeof sample.position === 'number' &&
    Number.isFinite(sample.position) &&
    sample.position > 0
  );
}

export function buildProjectCtrCurve(samples: readonly QueryPageAggregate[]): ProjectCtrCurveV1 {
  const values = new Map<ProjectCtrBucketKey, number[]>(
    PROJECT_CTR_BUCKETS.map((bucket) => [bucket, []])
  );

  for (const sample of samples) {
    if (!isEligibleSample(sample)) continue;
    const bucket = positionBucket(sample.position);
    if (!bucket) continue;
    values.get(bucket)!.push(sample.ctr);
  }

  const buckets = Object.fromEntries(
    PROJECT_CTR_BUCKETS.map((bucket) => {
      const eligibleCtrs = values.get(bucket)!;
      const result: ProjectCtrBucket = eligibleCtrs.length >= CTR_CURVE_MIN_BUCKET_SAMPLES
        ? {
            state: 'KNOWN',
            sampleCount: eligibleCtrs.length,
            expectedCtr: median(eligibleCtrs)
          }
        : {
            state: 'UNKNOWN',
            sampleCount: eligibleCtrs.length,
            expectedCtr: null
          };
      return [bucket, result];
    })
  ) as Record<ProjectCtrBucketKey, ProjectCtrBucket>;

  return {
    version: PROJECT_CTR_CURVE_VERSION,
    buckets
  };
}
