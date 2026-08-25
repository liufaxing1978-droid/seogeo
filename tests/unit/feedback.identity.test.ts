import { describe, expect, it } from 'vitest';
import {
  buildFeedbackEvidenceKey,
  buildFeedbackProfileIdentity,
  buildFeedbackScopeKey
} from '../../src/modules/optimization-feedback/feedback.identity.js';

function configuredScope() {
  return {
    projectId: '11111111-1111-4111-8111-111111111111',
    marketScopeMode: 'CONFIGURED_MARKET' as const,
    marketCode: 'HK',
    locale: 'zh-Hant',
    recommendedActionType: 'CONTENT_REFRESH'
  };
}

describe('P9-E feedback identity', () => {
  it('is stable across equivalent scope object key order', () => {
    const scope = configuredScope();
    const reordered = {
      recommendedActionType: scope.recommendedActionType,
      locale: scope.locale,
      marketCode: scope.marketCode,
      marketScopeMode: scope.marketScopeMode,
      projectId: scope.projectId
    };

    expect(buildFeedbackScopeKey(scope)).toBe(buildFeedbackScopeKey(reordered));
    expect(buildFeedbackScopeKey(scope)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps explicit legacy null scope distinct from configured scope', () => {
    const configured = configuredScope();
    const legacy = {
      ...configured,
      marketScopeMode: 'UNCONFIGURED_LEGACY' as const,
      marketCode: null,
      locale: null
    };

    expect(buildFeedbackScopeKey(legacy)).not.toBe(buildFeedbackScopeKey(configured));
  });

  it('changes when project, market, locale, or action changes', () => {
    const base = configuredScope();
    const key = buildFeedbackScopeKey(base);

    expect(buildFeedbackScopeKey({
      ...base,
      projectId: '22222222-2222-4222-8222-222222222222'
    })).not.toBe(key);
    expect(buildFeedbackScopeKey({ ...base, marketCode: 'SG' })).not.toBe(key);
    expect(buildFeedbackScopeKey({ ...base, locale: 'en-SG' })).not.toBe(key);
    expect(buildFeedbackScopeKey({
      ...base,
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION'
    })).not.toBe(key);
  });

  it('binds evidence identity to the exact observation', () => {
    const scopeKey = buildFeedbackScopeKey(configuredScope());
    const base = {
      projectId: '11111111-1111-4111-8111-111111111111',
      experimentId: '33333333-3333-4333-8333-333333333333',
      observationId: '44444444-4444-4444-8444-444444444444',
      scopeKey
    };

    expect(buildFeedbackEvidenceKey(base)).toMatch(/^[a-f0-9]{64}$/);
    expect(buildFeedbackEvidenceKey({
      ...base,
      observationId: '55555555-5555-4555-8555-555555555555'
    })).not.toBe(buildFeedbackEvidenceKey(base));
  });

  it('binds profile identity to the exact frozen evidence order', () => {
    const scopeKey = buildFeedbackScopeKey(configuredScope());
    const input = {
      projectId: '11111111-1111-4111-8111-111111111111',
      scopeKey,
      orderedEvidenceIds: ['evidence-a', 'evidence-b', 'evidence-c']
    };

    const first = buildFeedbackProfileIdentity(input);
    const rerun = buildFeedbackProfileIdentity({
      ...input,
      orderedEvidenceIds: [...input.orderedEvidenceIds]
    });
    const reordered = buildFeedbackProfileIdentity({
      ...input,
      orderedEvidenceIds: ['evidence-b', 'evidence-a', 'evidence-c']
    });

    expect(rerun).toEqual(first);
    expect(first.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.profileKey).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered.inputFingerprint).not.toBe(first.inputFingerprint);
    expect(reordered.profileKey).not.toBe(first.profileKey);
  });
});
