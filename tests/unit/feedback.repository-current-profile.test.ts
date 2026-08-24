import { describe, expect, it, vi } from 'vitest';
import {
  buildFeedbackProfileIdentity,
  buildFeedbackScopeKey
} from '../../src/modules/optimization-feedback/feedback.identity.js';
import { OptimizationFeedbackRepository } from '../../src/modules/optimization-feedback/feedback.repository.js';
import { OPTIMIZATION_FEEDBACK_PROFILE_VERSION } from '../../src/modules/optimization-feedback/feedback.types.js';

describe('P9-E current feedback profile lookup', () => {
  it('resolves the exact profile for the current deterministic last-20 evidence set', async () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    const scope = {
      projectId,
      marketScopeMode: 'CONFIGURED_MARKET' as const,
      marketCode: 'HK' as const,
      locale: 'zh-Hant',
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION' as const
    };
    const scopeKey = buildFeedbackScopeKey(scope);
    const orderedEvidenceIds = [
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012'
    ];
    const identity = buildFeedbackProfileIdentity({
      projectId,
      scopeKey,
      orderedEvidenceIds
    });
    const currentProfile = { id: 'current-profile', sampleCount: 2 };
    const staleProfile = { id: 'stale-profile', sampleCount: 1 };

    const evidenceFindMany = vi.fn().mockResolvedValue([
      { id: orderedEvidenceIds[1] },
      { id: orderedEvidenceIds[0] }
    ]);
    const profileFindFirst = vi.fn().mockImplementation((args: {
      where?: { inputFingerprint?: string };
    }) => Promise.resolve(
      args.where?.inputFingerprint === identity.inputFingerprint
        ? currentProfile
        : staleProfile
    ));
    const repository = new OptimizationFeedbackRepository({
      optimizationFeedbackEvidence: { findMany: evidenceFindMany },
      optimizationFeedbackProfile: { findFirst: profileFindFirst }
    } as never);

    const result = await repository.findLatestProfileForScope(scope);

    expect(evidenceFindMany).toHaveBeenCalledWith({
      where: { projectId, scopeKey },
      orderBy: [{ inputCutoffAt: 'desc' }, { observationId: 'desc' }],
      take: 20,
      select: { id: true }
    });
    expect(profileFindFirst).toHaveBeenCalledWith({
      where: {
        projectId,
        feedbackProfileVersion: OPTIMIZATION_FEEDBACK_PROFILE_VERSION,
        scopeKey,
        inputFingerprint: identity.inputFingerprint
      }
    });
    expect(result).toBe(currentProfile);
  });

  it('fails closed when the scope is invalid or the current evidence set has no profile snapshot', async () => {
    const evidenceFindMany = vi.fn().mockResolvedValue([]);
    const profileFindFirst = vi.fn();
    const repository = new OptimizationFeedbackRepository({
      optimizationFeedbackEvidence: { findMany: evidenceFindMany },
      optimizationFeedbackProfile: { findFirst: profileFindFirst }
    } as never);

    await expect(repository.findLatestProfileForScope({
      projectId: '00000000-0000-4000-8000-000000000001',
      marketScopeMode: 'INVALID_PROVENANCE',
      marketCode: null,
      locale: null,
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION'
    })).resolves.toBeNull();

    expect(evidenceFindMany).not.toHaveBeenCalled();
    expect(profileFindFirst).not.toHaveBeenCalled();
  });
});
