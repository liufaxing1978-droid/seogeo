import type { RecommendedActionType } from '@prisma/client';
import type { ExperimentWindowType } from './experiment.types.js';

export type ExperimentWindow = {
  windowType: ExperimentWindowType;
  windowDays: 7 | 14 | 28 | 56;
};

const schedules: Partial<Record<RecommendedActionType, readonly ExperimentWindow[]>> = {
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
): readonly ExperimentWindow[] | null {
  return schedules[action] ?? null;
}
