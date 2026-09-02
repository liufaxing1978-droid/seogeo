import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as operationsDerive from '../../src/modules/optimization-operations/operations.derive.js';
import { OptimizationOperationsRepository } from '../../src/modules/optimization-operations/operations.repository.js';
import { OptimizationOperationsService } from '../../src/modules/optimization-operations/operations.service.js';
import type { OperationsInboxItem } from '../../src/modules/optimization-operations/operations.types.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

type AutomationAlertAuthority = {
  id: string;
  status: 'FAILED' | 'TIMED_OUT' | 'SKIPPED' | 'SUCCEEDED';
  lastErrorCode: string | null;
  updatedAt: Date;
  authorityUrl: string;
};

function inboxItem(
  overrides: Partial<OperationsInboxItem> & Pick<OperationsInboxItem, 'id' | 'category' | 'severity'>,
): OperationsInboxItem {
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

function automationRun(
  id: string,
  status: AutomationAlertAuthority['status'],
  updatedAt: string,
  lastErrorCode: string | null = null,
): AutomationAlertAuthority {
  return {
    id,
    status,
    lastErrorCode,
    updatedAt: new Date(updatedAt),
    authorityUrl: `/api/v1/projects/${PROJECT_ID}/optimization/automation-runs/${id}`,
  };
}

describe('OL-3 Alert Center', () => {
  it('projects only actionable persisted failures into stable P0/P1 alerts', () => {
    const deriveAlertCenter = (operationsDerive as unknown as Record<string, unknown>)[
      'deriveAlertCenter'
    ];
    expect(deriveAlertCenter).toBeTypeOf('function');
    if (typeof deriveAlertCenter !== 'function') return;

    const alerts = (deriveAlertCenter as (input: {
      inboxItems: OperationsInboxItem[];
      automationRuns: AutomationAlertAuthority[];
    }) => Array<Record<string, unknown>>)({
      inboxItems: [
        inboxItem({
          id: 'verify',
          category: 'VERIFICATION_FAILED',
          severity: 'HIGH',
          updatedAt: new Date('2026-09-02T01:00:00.000Z'),
          reasonCode: 'HTTP_STATUS_MISMATCH',
        }),
        inboxItem({
          id: 'exec',
          category: 'EXECUTION_FAILED',
          severity: 'HIGH',
          updatedAt: new Date('2026-09-02T02:00:00.000Z'),
          reasonCode: 'PUBLISH_FAILED',
        }),
        inboxItem({
          id: 'stale',
          category: 'STALE',
          severity: 'MEDIUM',
          updatedAt: new Date('2026-09-02T03:00:00.000Z'),
          reasonCode: 'SOURCE_STALE',
        }),
        inboxItem({
          id: 'policy',
          category: 'POLICY_BLOCKED',
          severity: 'MEDIUM',
          authorityType: 'AUTOPILOT_DECISION',
          updatedAt: new Date('2026-09-02T04:00:00.000Z'),
        }),
        inboxItem({
          id: 'p8',
          category: 'P8_VALIDATION_BLOCKED',
          severity: 'MEDIUM',
          authorityType: 'AUTOPILOT_DECISION',
          updatedAt: new Date('2026-09-02T05:00:00.000Z'),
        }),
        inboxItem({
          id: 'merge',
          category: 'AWAITING_HUMAN_MERGE',
          severity: 'LOW',
          updatedAt: new Date('2026-09-02T00:30:00.000Z'),
        }),
      ],
      automationRuns: [
        automationRun('auto-timeout', 'TIMED_OUT', '2026-09-02T00:00:00.000Z', 'AUTOMATION_TIMEOUT'),
        automationRun('auto-failed', 'FAILED', '2026-09-02T00:30:00.000Z', 'PROVIDER_UNAVAILABLE'),
        automationRun('auto-failed', 'FAILED', '2026-09-02T00:30:00.000Z', 'PROVIDER_UNAVAILABLE'),
        automationRun('auto-skipped', 'SKIPPED', '2026-09-02T00:10:00.000Z'),
        automationRun('auto-ok', 'SUCCEEDED', '2026-09-02T00:20:00.000Z'),
      ],
    });

    expect(alerts.map((alert) => ({
      id: alert.id,
      priority: alert.priority,
      kind: alert.kind,
      reasonCode: alert.reasonCode,
    }))).toEqual([
      {
        id: 'alert:automation:auto-timeout:AUTOMATION_TIMED_OUT',
        priority: 'P0',
        kind: 'AUTOMATION_TIMED_OUT',
        reasonCode: 'AUTOMATION_TIMEOUT',
      },
      {
        id: 'alert:automation:auto-failed:AUTOMATION_FAILED',
        priority: 'P0',
        kind: 'AUTOMATION_FAILED',
        reasonCode: 'PROVIDER_UNAVAILABLE',
      },
      {
        id: 'alert:inbox:verify:VERIFICATION_FAILED',
        priority: 'P0',
        kind: 'VERIFICATION_FAILED',
        reasonCode: 'HTTP_STATUS_MISMATCH',
      },
      {
        id: 'alert:inbox:exec:EXECUTION_FAILED',
        priority: 'P0',
        kind: 'EXECUTION_FAILED',
        reasonCode: 'PUBLISH_FAILED',
      },
      {
        id: 'alert:inbox:stale:STALE',
        priority: 'P1',
        kind: 'STALE',
        reasonCode: 'SOURCE_STALE',
      },
      {
        id: 'alert:inbox:policy:POLICY_BLOCKED',
        priority: 'P1',
        kind: 'POLICY_BLOCKED',
        reasonCode: 'REASON',
      },
      {
        id: 'alert:inbox:p8:P8_VALIDATION_BLOCKED',
        priority: 'P1',
        kind: 'P8_VALIDATION_BLOCKED',
        reasonCode: 'REASON',
      },
    ]);

    expect(alerts.some((alert) => alert.kind === 'AWAITING_HUMAN_MERGE')).toBe(false);
    expect(alerts.some((alert) => alert.kind === 'AUTOMATION_SKIPPED')).toBe(false);
  });

  it('reads only failed/timed-out AutomationRun rows for the requested project', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new OptimizationOperationsRepository({
      automationRun: { findMany },
    } as never);
    const listAutomationAlertAuthority = (
      repository as unknown as Record<string, unknown>
    )['listAutomationAlertAuthority'];

    expect(listAutomationAlertAuthority).toBeTypeOf('function');
    if (typeof listAutomationAlertAuthority !== 'function') return;

    await (listAutomationAlertAuthority as (projectId: string, limit: number) => Promise<unknown>)(
      PROJECT_ID,
      25,
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: PROJECT_ID,
        status: { in: ['FAILED', 'TIMED_OUT'] },
      },
      take: 25,
    }));
  });

  it('integrates alert facts into the Operations overview without provider or execution calls', async () => {
    const fakeRepository = {
      getProjectPlanLevel: vi.fn().mockResolvedValue(null),
      getCurrentPolicy: vi.fn().mockResolvedValue(null),
      countTodayRuns: vi.fn().mockResolvedValue(0),
      listPipelineAuthority: vi.fn().mockResolvedValue([]),
      listInboxAuthority: vi.fn().mockResolvedValue([
        {
          authorityType: 'PUBLICATION_EXECUTION',
          authorityId: 'verify',
          status: 'VERIFICATION_FAILED',
          reasonCode: 'HTTP_STATUS_MISMATCH',
          updatedAt: new Date('2026-09-02T01:00:00.000Z'),
          authorityUrl: '/authority/verify',
          optimizationPlanId: 'plan-1',
          targetUrl: 'https://example.com/page',
        },
      ]),
      listAutomationAlertAuthority: vi.fn().mockResolvedValue([
        {
          id: 'auto-failed',
          status: 'FAILED',
          lastErrorCode: 'PROVIDER_UNAVAILABLE',
          updatedAt: new Date('2026-09-02T00:30:00.000Z'),
        },
      ]),
      listTerminalObservations: vi.fn().mockResolvedValue([]),
      listFeedbackEvidence: vi.fn().mockResolvedValue([]),
      listFeedbackProfiles: vi.fn().mockResolvedValue([]),
      listReservations: vi.fn().mockResolvedValue([]),
      listRecentActivityAuthority: vi.fn().mockResolvedValue([]),
    };

    const service = new OptimizationOperationsService(fakeRepository as never, () => false);
    const overview = await service.getOverview(PROJECT_ID, new Date('2026-09-02T12:00:00.000Z'));
    const alertCenter = (overview as unknown as Record<string, unknown>)['alerts'];

    expect(fakeRepository.listAutomationAlertAuthority).toHaveBeenCalledWith(PROJECT_ID, 100);
    expect(alertCenter).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'AUTOMATION_FAILED', reasonCode: 'PROVIDER_UNAVAILABLE' }),
      expect.objectContaining({ kind: 'VERIFICATION_FAILED', reasonCode: 'HTTP_STATUS_MISMATCH' }),
    ]));
  });

  it('renders a dedicated Alert Center before routine activity and keeps merge/deploy authority human', () => {
    const template = readFileSync(
      new URL('../../src/views/optimization-operations/index.ejs', import.meta.url),
      'utf8',
    );

    expect(template).toContain('data-ui="operations-alert-center"');
    expect(template).toContain('告警中心');
    expect(template).toContain('Automation');
    expect(template).toMatch(/告警中心[\s\S]*Recent activity/);
    expect(template).toContain('人工合并与部署边界保持不变');
  });
});
