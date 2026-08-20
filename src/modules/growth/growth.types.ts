export type GrowthDateRange = {
  start: string;
  end: string;
};

export type StableGrowthWindows = {
  cutoffDate: string;
  current: GrowthDateRange;
  previous: GrowthDateRange;
};

export type GscCoverageSnapshot = {
  id: string;
  date: string | Date;
  status: string;
  syncVersion: number;
};

export type StableWindowCoverage = {
  state: 'ELIGIBLE' | 'INELIGIBLE';
  expectedDateCount: number;
  selectedCompletedDateCount: number;
  missingDates: string[];
  selectedSnapshots: Array<{
    id: string;
    date: string;
    syncVersion: number;
  }>;
};

export type QueryPageFactLike = {
  date?: string | Date;
  normalizedQuery: string;
  canonicalPage: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type QueryPageAggregate = {
  normalizedQuery: string;
  canonicalPage: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
};

export const PROJECT_CTR_BUCKETS = [
  '1',
  '2',
  '3',
  '4-5',
  '6-10',
  '11-20',
  '21-30',
  '31-50',
  '>50'
] as const;

export type ProjectCtrBucketKey = typeof PROJECT_CTR_BUCKETS[number];

export type ProjectCtrBucket =
  | { state: 'KNOWN'; sampleCount: number; expectedCtr: number }
  | { state: 'UNKNOWN'; sampleCount: number; expectedCtr: null };

export type ProjectCtrCurveV1 = {
  version: 'PROJECT_CTR_CURVE_V1';
  buckets: Record<ProjectCtrBucketKey, ProjectCtrBucket>;
};
