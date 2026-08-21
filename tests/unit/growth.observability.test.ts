import { describe, expect, it } from 'vitest';
import { serializeGrowthEvent } from '../../src/modules/growth/growth.observability.js';

describe('P7-A growth observability', () => {
  it('keeps only bounded allowlisted materialization fields', () => {
    expect(serializeGrowthEvent('growth.materialization.completed', {
      projectId: 'project-1',
      status: 'COMPLETED',
      materializationVersion: 'GROWTH_MATERIALIZATION_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      selectedGscSnapshotCount: 56,
      opportunitySnapshotCount: 12,
      topicSnapshotCount: 4,
      durationMs: 42,
      normalizedQuery: '六壬',
      evidence: [{ secret: true }],
      accessToken: 'token-material'
    })).toEqual({
      event: 'growth.materialization.completed',
      projectId: 'project-1',
      status: 'COMPLETED',
      materializationVersion: 'GROWTH_MATERIALIZATION_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      selectedGscSnapshotCount: 56,
      opportunitySnapshotCount: 12,
      topicSnapshotCount: 4,
      durationMs: 42
    });
  });

  it('allows lifecycle metadata without Query or evidence payloads', () => {
    expect(serializeGrowthEvent('growth.lifecycle.changed', {
      projectId: 'project-1',
      identityId: 'identity-1',
      lifecycleEventType: 'AUTO_RESOLVED',
      lifecycleStatus: 'RESOLVED',
      reasonCode: 'GROWTH_OPPORTUNITY_NON_ACTIONABLE_TWO_WINDOWS',
      normalizedQuery: '六壬',
      evidence: ['private']
    })).toEqual({
      event: 'growth.lifecycle.changed',
      projectId: 'project-1',
      identityId: 'identity-1',
      lifecycleEventType: 'AUTO_RESOLVED',
      lifecycleStatus: 'RESOLVED',
      reasonCode: 'GROWTH_OPPORTUNITY_NON_ACTIONABLE_TWO_WINDOWS'
    });
  });
});
