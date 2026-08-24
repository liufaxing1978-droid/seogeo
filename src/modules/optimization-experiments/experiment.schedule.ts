import type { RecommendedActionType } from '@prisma/client';

export type ExperimentWindowType = '7D' | '14D' | '28D' | '56D';

export type ExperimentScheduleItem = {
  windowType: ExperimentWindowType;
  windowDays: 7 | 14 | 28 | 56;
};

const schedules: Partial<Record<RecommendedActionType, readonly ExperimentScheduleItem[]>> = {
  SERP_SNIPPET_OPTIMIZATION: [
    { windowType: '7D', windowDays: 7 },
    { windowType: '14D', windowDays: 14 },
    { windowType: '28D', windowDays: 28 }
  ],
  ON_PAGE_OPTIMIZATION: [
    { windowType: '14D', windowDays: 14 },
    { windowType: '28D', windowDays: 28 },
    { windowType: '56D', windowDays: 56 }
  ],
  CONTENT_REFRESH: [
    { windowType: '14D', windowDays: 14 },
    { windowType: '28D', windowDays: 28 },
    { windowType: '56D', windowDays: 56 }
  ],
  CONTENT_CREATION: [
    { windowType: '14D', windowDays: 14 },
    { windowType: '28D', windowDays: 28 },
    { windowType: '56D', windowDays: 56 }
  ],
  GEO_CITABILITY_IMPROVEMENT: [
    { windowType: '14D', windowDays: 14 },
    { windowType: '28D', windowDays: 28 },
    { windowType: '56D', windowDays: 56 }
  ],
  AI_VISIBILITY_IMPROVEMENT: [
    { windowType: '14D', windowDays: 14 },
    { windowType: '28D', windowDays: 28 },
    { windowType: '56D', windowDays: 56 }
  ]
};

export function scheduleForIntervention(
  action: RecommendedActionType
): readonly ExperimentScheduleItem[] | null {
  return schedules[action] ?? null;
}
