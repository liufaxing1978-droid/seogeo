import { describe, expect, it } from 'vitest';
import {
  GROWTH_OBSERVABILITY_EVENTS,
  serializeGrowthEvent
} from '../../src/modules/growth/growth.observability.js';

describe('P7-A Growth safe observability', () => {
  it('exposes only the final allowlisted Growth event catalog', () => {
    expect([...GROWTH_OBSERVABILITY_EVENTS]).toEqual([
      'growth.materialization.started',
      'growth.materialization.completed',
      'growth.materialization.failed',
      'growth.lifecycle.changed',
      'growth.ai_explanation.completed',
      'growth.ai_explanation.failed'
    ]);
  });

  it('serializes only bounded scalar metadata and drops Query/evidence/AI/provider payloads', () => {
    const event = serializeGrowthEvent('growth.ai_explanation.completed', {
      projectId: 'project-1',
      identityId: 'identity-1',
      status: 'COMPLETED',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: '2026-07-12T00:00:00.000Z',
      currentWindowEnd: '2026-08-08T00:00:00.000Z',
      opportunitySnapshotCount: 3,
      durationMs: 88,
      reasonCode: 'AI_OUTPUT_VALIDATED\nforged',
      query: 'private full query',
      queries: ['private query array'],
      evidence: [{ textSummary: 'private full evidence' }],
      prompt: 'raw AI prompt',
      response: 'raw AI response',
      providerBody: { raw: true },
      providerReasoning: 'raw P6/provider reasoning',
      accessToken: 'secret token',
      arbitrary: 'DROP_ME'
    });

    expect(event).toEqual({
      event: 'growth.ai_explanation.completed',
      projectId: 'project-1',
      identityId: 'identity-1',
      status: 'COMPLETED',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: '2026-07-12T00:00:00.000Z',
      currentWindowEnd: '2026-08-08T00:00:00.000Z',
      opportunitySnapshotCount: 3,
      durationMs: 88,
      reasonCode: 'AI_OUTPUT_VALIDATED forged'
    });
    expect(JSON.stringify(event)).not.toMatch(/private full query|private query array|private full evidence|raw AI prompt|raw AI response|provider reasoning|secret token|DROP_ME/);
  });

  it('drops non-scalar values even when an allowed field name is supplied', () => {
    expect(serializeGrowthEvent('growth.materialization.failed', {
      projectId: { injected: 'object' },
      selectedGscSnapshotCount: Number.NaN,
      durationMs: Number.POSITIVE_INFINITY,
      errorCode: ['not', 'scalar'],
      reasonCode: 'SAFE_REASON'
    })).toEqual({
      event: 'growth.materialization.failed',
      reasonCode: 'SAFE_REASON'
    });
  });
});
