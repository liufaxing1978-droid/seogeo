import { describe, expect, it } from 'vitest';
import { scheduleForIntervention } from '../../src/modules/optimization-experiments/experiment.schedule.js';

describe('P9-D schedule V1', () => {
  it.each([
    ['SERP_SNIPPET_OPTIMIZATION', ['7D', '14D', '28D']],
    ['ON_PAGE_OPTIMIZATION', ['14D', '28D', '56D']],
    ['CONTENT_REFRESH', ['14D', '28D', '56D']],
    ['CONTENT_CREATION', ['14D', '28D', '56D']],
    ['GEO_CITABILITY_IMPROVEMENT', ['14D', '28D', '56D']],
    ['AI_VISIBILITY_IMPROVEMENT', ['14D', '28D', '56D']]
  ] as const)('%s', (action, expected) => {
    expect(scheduleForIntervention(action)?.map((item) => item.windowType)).toEqual(expected);
  });

  it.each(['TECHNICAL_SEO_REMEDIATION', 'CANNIBALIZATION_REMEDIATION'] as const)(
    'does not invent a proxy for %s',
    (action) => expect(scheduleForIntervention(action)).toBeNull()
  );
});
