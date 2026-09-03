import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { OptimizationOperationsRepository } from '../../src/modules/optimization-operations/operations.repository.js';
import { OptimizationOperationsService } from '../../src/modules/optimization-operations/operations.service.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-02T12:00:00.000Z');

function verificationAuthority(
  id: string,
  status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'UNKNOWN',
  observedAt: string,
) {
  return {
    id,
    executionId: `execution-${id}`,
    status,
    targetUrl: `https://example.com/${id}`,
    observedAt: new Date(observedAt),
    httpStatus: status === 'FAILED' ? 500 : 200,
    titleMatches: true,
    descriptionMatches: status !== 'FAILED',
    canonicalMatches: true,
    h1Matches: true,
    indexable: status !== 'UNKNOWN',
    schemaValid: true,
    contentFingerprintOk: status === 'VERIFIED',
    regressionFindings: status === 'FAILED' ? ['HTTP_STATUS_MISMATCH'] : [],
    reasonCode: status === 'FAILED' ? 'HTTP_STATUS_MISMATCH' : null,
    createdAt: new Date(observedAt),
    authorityUrl: `/projects/${PROJECT_ID}/publication/verifications/${id}`,
  };
}

describe('OL-4 Verification Monitor', () => {
  it('reads recent project-scoped PublicationVerification authority without re-verifying', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'verification-1',
        executionId: 'execution-1',
        status: 'FAILED',
        observedUrl: null,
        observedAt: new Date('2026-09-02T10:00:00.000Z'),
        httpStatus: 500,
        titleMatches: true,
        descriptionMatches: false,
        canonicalMatches: true,
        h1Matches: true,
        indexable: false,
        schemaValid: true,
        contentFingerprintOk: false,
        regressionFindings: ['HTTP_STATUS_MISMATCH'],
        reasonCode: 'HTTP_STATUS_MISMATCH',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
        execution: {
          plan: { targetPublicUrl: 'https://example.com/expected' },
        },
      },
    ]);
    const repository = new OptimizationOperationsRepository({
      publicationVerification: { findMany },
    } as never);
    const method = (repository as unknown as Record<string, unknown>)[
      'listRecentVerificationAuthority'
    ];

    expect(method).toBeTypeOf('function');
    if (typeof method !== 'function') return;

    const rows = await (method as (
      this: OptimizationOperationsRepository,
      projectId: string,
      limit: number,
    ) => Promise<unknown>).call(repository, PROJECT_ID, 25);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: PROJECT_ID },
      take: 25,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: expect.objectContaining({
        status: true,
        observedUrl: true,
        observedAt: true,
        httpStatus: true,
        titleMatches: true,
        descriptionMatches: true,
        canonicalMatches: true,
        h1Matches: true,
        indexable: true,
        schemaValid: true,
        contentFingerprintOk: true,
        regressionFindings: true,
        reasonCode: true,
        execution: {
          select: {
            plan: { select: { targetPublicUrl: true } },
          },
        },
      }),
    }));
    expect(rows).toEqual([
      {
        id: 'verification-1',
        executionId: 'execution-1',
        status: 'FAILED',
        targetUrl: 'https://example.com/expected',
        observedAt: new Date('2026-09-02T10:00:00.000Z'),
        httpStatus: 500,
        titleMatches: true,
        descriptionMatches: false,
        canonicalMatches: true,
        h1Matches: true,
        indexable: false,
        schemaValid: true,
        contentFingerprintOk: false,
        regressionFindings: ['HTTP_STATUS_MISMATCH'],
        reasonCode: 'HTTP_STATUS_MISMATCH',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
        authorityUrl: `/projects/${PROJECT_ID}/publication/verifications/verification-1`,
      },
    ]);
  });

  it('adds four-state verification counts and recent persisted verification facts to the overview', async () => {
    const recentVerifications = [
      verificationAuthority('verified', 'VERIFIED', '2026-09-02T07:00:00.000Z'),
      verificationAuthority('failed-1', 'FAILED', '2026-09-02T08:00:00.000Z'),
      verificationAuthority('unknown', 'UNKNOWN', '2026-09-02T09:00:00.000Z'),
      verificationAuthority('pending', 'PENDING', '2026-09-02T10:00:00.000Z'),
      verificationAuthority('failed-2', 'FAILED', '2026-09-02T11:00:00.000Z'),
    ];
    const fakeRepository = {
      getProjectPlanLevel: vi.fn().mockResolvedValue(null),
      getCurrentPolicy: vi.fn().mockResolvedValue(null),
      countTodayRuns: vi.fn().mockResolvedValue(0),
      listPipelineAuthority: vi.fn().mockResolvedValue([]),
      listInboxAuthority: vi.fn().mockResolvedValue([]),
      listAutomationAlertAuthority: vi.fn().mockResolvedValue([]),
      listRecentVerificationAuthority: vi.fn().mockResolvedValue(recentVerifications),
      listTerminalObservations: vi.fn().mockResolvedValue([]),
      listFeedbackEvidence: vi.fn().mockResolvedValue([]),
      listFeedbackProfiles: vi.fn().mockResolvedValue([]),
      listReservations: vi.fn().mockResolvedValue([]),
      listRecentActivityAuthority: vi.fn().mockResolvedValue([]),
    };
    const service = new OptimizationOperationsService(fakeRepository as never, () => false);

    const overview = await service.getOverview(PROJECT_ID, NOW);
    const monitor = overview as unknown as Record<string, unknown>;

    expect(fakeRepository.listRecentVerificationAuthority).toHaveBeenCalledWith(PROJECT_ID, 20);
    expect(monitor.verificationSummary).toEqual({
      PENDING: 1,
      VERIFIED: 1,
      FAILED: 2,
      UNKNOWN: 1,
    });
    expect(monitor.recentVerifications).toEqual(recentVerifications);
  });

  it('renders a read-only Verification Monitor after alerts and before overview metrics', () => {
    const template = readFileSync(
      new URL('../../src/views/optimization-operations/index.ejs', import.meta.url),
      'utf8',
    );

    expect(template).toContain('data-ui="operations-verification-monitor"');
    expect(template).toContain('发布后验证监控');
    expect(template).toContain('PENDING');
    expect(template).toContain('VERIFIED');
    expect(template).toContain('FAILED');
    expect(template).toContain('UNKNOWN');
    expect(template).toContain('HTTP');
    expect(template).toContain('通过检查');
    expect(template).toContain('Reason Code');
    expect(template).toMatch(
      /operations-alert-center[\s\S]*operations-verification-monitor[\s\S]*Operations overview metrics/,
    );
    expect(template).not.toMatch(/data-verification-(?:retry|rerun|force)|重新验证|强制通过/);
  });
});
