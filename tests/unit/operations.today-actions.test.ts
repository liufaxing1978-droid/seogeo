import { describe, expect, it } from 'vitest';
import { deriveTodayActions } from '../../src/modules/optimization-operations/operations.derive.js';
import type { OperationsInboxItem } from '../../src/modules/optimization-operations/operations.types.js';

function inboxItem(overrides: Partial<OperationsInboxItem> & Pick<OperationsInboxItem, 'id' | 'category' | 'severity'>): OperationsInboxItem {
  return {
    authorityType: 'PUBLICATION_EXECUTION',
    authorityId: overrides.id,
    reasonCode: 'REASON',
    optimizationPlanId: 'plan-1',
    targetUrl: 'https://example.com/page',
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    authorityUrl: '/authority/1',
    ...overrides,
  };
}

describe('OL-1 Today / Action Center projection', () => {
  it('turns persisted inbox facts into concrete actions without inventing metrics', () => {
    const actions = deriveTodayActions([
      inboxItem({
        id: 'verify',
        category: 'VERIFICATION_FAILED',
        severity: 'HIGH',
        reasonCode: 'HTTP_STATUS_MISMATCH',
      }),
      inboxItem({
        id: 'stale',
        category: 'STALE',
        severity: 'MEDIUM',
        reasonCode: 'SOURCE_STALE',
      }),
      inboxItem({
        id: 'merge',
        category: 'AWAITING_HUMAN_MERGE',
        severity: 'LOW',
        reasonCode: 'HUMAN_MERGE_REQUIRED',
      }),
    ]);

    expect(actions.map((action) => ({
      id: action.id,
      priority: action.priority,
      kind: action.kind,
      reasonCode: action.reasonCode,
    }))).toEqual([
      {
        id: 'today:verify',
        priority: 'P0',
        kind: 'INVESTIGATE_VERIFICATION',
        reasonCode: 'HTTP_STATUS_MISMATCH',
      },
      {
        id: 'today:stale',
        priority: 'P1',
        kind: 'REFRESH_EVIDENCE',
        reasonCode: 'SOURCE_STALE',
      },
      {
        id: 'today:merge',
        priority: 'P2',
        kind: 'REVIEW_DRAFT_PR',
        reasonCode: 'HUMAN_MERGE_REQUIRED',
      },
    ]);

    expect(actions[0]).toMatchObject({
      title: '发布后验证失败',
      recommendedAction: '检查验证证据并修复失败原因',
      targetUrl: 'https://example.com/page',
      authorityUrl: '/authority/1',
    });
    expect(actions[0]).not.toHaveProperty('score');
    expect(actions[0]).not.toHaveProperty('opportunityScore');
  });

  it('maps every existing human-attention category to one stable action kind', () => {
    const actions = deriveTodayActions([
      inboxItem({ id: 'verify', category: 'VERIFICATION_FAILED', severity: 'HIGH' }),
      inboxItem({ id: 'exec', category: 'EXECUTION_FAILED', severity: 'HIGH' }),
      inboxItem({ id: 'policy', category: 'POLICY_BLOCKED', severity: 'MEDIUM', authorityType: 'AUTOPILOT_DECISION' }),
      inboxItem({ id: 'p8', category: 'P8_VALIDATION_BLOCKED', severity: 'MEDIUM', authorityType: 'AUTOPILOT_DECISION' }),
      inboxItem({ id: 'stale', category: 'STALE', severity: 'MEDIUM' }),
      inboxItem({ id: 'merge', category: 'AWAITING_HUMAN_MERGE', severity: 'LOW' }),
    ]);

    expect(actions.map((action) => action.kind)).toEqual([
      'INVESTIGATE_VERIFICATION',
      'INVESTIGATE_EXECUTION',
      'REVIEW_POLICY',
      'REVIEW_P8_HANDOFF',
      'REFRESH_EVIDENCE',
      'REVIEW_DRAFT_PR',
    ]);
  });

  it('preserves the inbox order, removes duplicate facts, and caps the daily list at seven', () => {
    const items: OperationsInboxItem[] = [
      inboxItem({ id: 'a', category: 'VERIFICATION_FAILED', severity: 'HIGH' }),
      inboxItem({ id: 'a', category: 'VERIFICATION_FAILED', severity: 'HIGH' }),
      inboxItem({ id: 'b', category: 'EXECUTION_FAILED', severity: 'HIGH' }),
      inboxItem({ id: 'c', category: 'STALE', severity: 'MEDIUM' }),
      inboxItem({ id: 'd', category: 'STALE', severity: 'MEDIUM' }),
      inboxItem({ id: 'e', category: 'POLICY_BLOCKED', severity: 'MEDIUM', authorityType: 'AUTOPILOT_DECISION' }),
      inboxItem({ id: 'f', category: 'P8_VALIDATION_BLOCKED', severity: 'MEDIUM', authorityType: 'AUTOPILOT_DECISION' }),
      inboxItem({ id: 'g', category: 'AWAITING_HUMAN_MERGE', severity: 'LOW' }),
      inboxItem({ id: 'h', category: 'AWAITING_HUMAN_MERGE', severity: 'LOW' }),
    ];

    expect(deriveTodayActions(items).map((action) => action.id)).toEqual([
      'today:a',
      'today:b',
      'today:c',
      'today:d',
      'today:e',
      'today:f',
      'today:g',
    ]);
  });
});
