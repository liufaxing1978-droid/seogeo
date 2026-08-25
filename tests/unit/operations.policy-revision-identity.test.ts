import { describe, expect, it } from 'vitest';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = '00000000-0000-4000-8000-000000000002';

const normalizedPolicy = {
  enabled: true,
  allowedRiskClass: 'LOW',
  allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
  dailyDraftPrLimit: 3,
  maxConcurrentRuns: 1,
  requireFreshEvidence: true,
  minimumEvidenceCoverage: 70,
  pauseOnVerificationFailure: true,
  killSwitch: false,
};

async function loadIdentityModule() {
  const modulePath = [
    '../../src/modules/optimization-operations',
    'policy-revision.identity.js',
  ].join('/');
  return import(modulePath) as Promise<Record<string, unknown>>;
}

describe('P9-F Autopilot Policy Revision identity', () => {
  it('builds deterministic SHA-256 identity for the exact immutable command', async () => {
    const module = await loadIdentityModule();
    const version = module.AUTOPILOT_POLICY_REVISION_VERSION;
    const build = module.buildAutopilotPolicyRevisionIdentity;

    expect(version).toBe('AUTOPILOT_POLICY_REVISION_V1');
    expect(build).toBeTypeOf('function');
    if (typeof build !== 'function') return;

    const base = {
      revisionVersion: version,
      projectId: PROJECT_ID,
      requestId: REQUEST_ID,
      expectedUpdatedAt: '2026-08-25T12:00:00.000Z',
      actorId: 'operator:fixture',
      normalizedPolicy,
    };
    const reordered = {
      actorId: 'operator:fixture',
      expectedUpdatedAt: '2026-08-25T12:00:00.000Z',
      normalizedPolicy: {
        killSwitch: false,
        pauseOnVerificationFailure: true,
        minimumEvidenceCoverage: 70,
        requireFreshEvidence: true,
        maxConcurrentRuns: 1,
        dailyDraftPrLimit: 3,
        allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
        allowedRiskClass: 'LOW',
        enabled: true,
      },
      requestId: REQUEST_ID,
      projectId: PROJECT_ID,
      revisionVersion: version,
    };

    const first = (build as (input: unknown) => { revisionKey: string; commandFingerprint: string })(base);
    const second = (build as (input: unknown) => { revisionKey: string; commandFingerprint: string })(reordered);

    expect(first).toEqual(second);
    expect(first.revisionKey).toMatch(/^[0-9a-f]{64}$/);
    expect(first.commandFingerprint).toMatch(/^[0-9a-f]{64}$/);

    for (const changed of [
      { ...base, requestId: '00000000-0000-4000-8000-000000000003' },
      { ...base, actorId: 'operator:other' },
      { ...base, expectedUpdatedAt: '2026-08-25T12:00:01.000Z' },
      { ...base, normalizedPolicy: { ...normalizedPolicy, dailyDraftPrLimit: 4 } },
    ]) {
      expect((build as (input: unknown) => { revisionKey: string })(changed).revisionKey)
        .not.toBe(first.revisionKey);
    }
  });

  it('fails closed for malformed normalized policy input', async () => {
    const module = await loadIdentityModule();
    const build = module.buildAutopilotPolicyRevisionIdentity;
    expect(build).toBeTypeOf('function');
    if (typeof build !== 'function') return;

    const valid = {
      revisionVersion: 'AUTOPILOT_POLICY_REVISION_V1',
      projectId: PROJECT_ID,
      requestId: REQUEST_ID,
      expectedUpdatedAt: null,
      actorId: 'operator:fixture',
      normalizedPolicy,
    };

    for (const malformed of [
      { ...valid, normalizedPolicy: { ...normalizedPolicy, dailyDraftPrLimit: -0 } },
      { ...valid, normalizedPolicy: { ...normalizedPolicy, unexpected: true } },
      { ...valid, normalizedPolicy: { ...normalizedPolicy, allowedRiskClass: 'HIGH' } },
      { ...valid, normalizedPolicy: { ...normalizedPolicy, allowedOperationClasses: ['DELETE_PAGE'] } },
      { ...valid, normalizedPolicy: { ...normalizedPolicy, minimumEvidenceCoverage: undefined } },
    ]) {
      expect(() => (build as (input: unknown) => unknown)(malformed)).toThrow();
    }
  });
});
