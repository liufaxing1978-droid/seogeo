import { describe, expect, it } from 'vitest';
import { resolveDistributionCapability } from '../../src/modules/distribution/distribution-adapter.js';
import {
  assertDistributionTargetPolicy,
  normalizeDistributionTargetContext
} from '../../src/modules/distribution/distribution-target-policy.js';

describe('P8-C distribution target policy', () => {
  it('accepts bounded user/approved-discovery context only for community draft targets', () => {
    expect(normalizeDistributionTargetContext({
      platform: 'REDDIT',
      mode: 'COMMUNITY_DRAFT',
      context: {
        sourceType: 'USER',
        question: 'How can a primary source explain this tradition?',
        topicUrl: 'https://www.reddit.com/r/example/comments/abc/topic',
        includeBrandLink: false
      }
    })).toEqual({
      sourceType: 'USER',
      question: 'How can a primary source explain this tradition?',
      topicUrl: 'https://www.reddit.com/r/example/comments/abc/topic',
      includeBrandLink: false
    });

    expect(normalizeDistributionTargetContext({
      platform: 'QUORA',
      mode: 'COMMUNITY_DRAFT',
      context: {
        sourceType: 'APPROVED_DISCOVERY',
        question: 'What reliable sources explain this topic?',
        includeBrandLink: true
      }
    })).toEqual({
      sourceType: 'APPROVED_DISCOVERY',
      question: 'What reliable sources explain this topic?',
      topicUrl: null,
      includeBrandLink: true
    });
  });

  it('rejects unsafe or unbounded community context', () => {
    expect(() => normalizeDistributionTargetContext({
      platform: 'REDDIT',
      mode: 'COMMUNITY_DRAFT',
      context: {
        sourceType: 'USER',
        question: 'x'.repeat(4001),
        includeBrandLink: false
      }
    })).toThrow();

    expect(() => normalizeDistributionTargetContext({
      platform: 'REDDIT',
      mode: 'COMMUNITY_DRAFT',
      context: {
        sourceType: 'USER',
        question: 'Question',
        topicUrl: 'javascript:alert(1)',
        includeBrandLink: false
      }
    })).toThrow();

    expect(() => normalizeDistributionTargetContext({
      platform: 'MEDIUM',
      mode: 'CANONICAL_REPOST',
      context: {
        sourceType: 'USER',
        question: 'Question',
        includeBrandLink: false
      }
    })).toThrowError(/COMMUNITY_DRAFT/);
  });

  it('locks community platforms to COMMUNITY_DRAFT and manual handoff', () => {
    for (const platform of [
      'REDDIT',
      'QUORA',
      'ZHIHU',
      'JIANSHU',
      'TIEBA',
      'PTT',
      'DCARD',
      'MOBILE01'
    ] as const) {
      expect(() => assertDistributionTargetPolicy({
        planLevel: 'ADVANCED',
        platform,
        mode: 'COMMUNITY_DRAFT'
      })).not.toThrow();
      expect(resolveDistributionCapability(platform as never, {
        trustedPublishAdapterConfigured: true
      })).toBe('MANUAL_HANDOFF');
    }

    expect(() => assertDistributionTargetPolicy({
      planLevel: 'ADVANCED',
      platform: 'REDDIT',
      mode: 'SUMMARY'
    })).toThrowError(/COMMUNITY_DRAFT/);
  });

  it('locks entity targets to ENTITY_SUGGESTION, PREPARE_ONLY and Enterprise', () => {
    for (const platform of ['WIKIDATA', 'WIKIPEDIA', 'BAIDU_BAIKE'] as const) {
      expect(resolveDistributionCapability(platform, {
        trustedPublishAdapterConfigured: true
      })).toBe('PREPARE_ONLY');

      expect(() => assertDistributionTargetPolicy({
        planLevel: 'ADVANCED',
        platform,
        mode: 'ENTITY_SUGGESTION'
      })).toThrowError(/Enterprise/);

      expect(() => assertDistributionTargetPolicy({
        planLevel: 'ENTERPRISE',
        platform,
        mode: 'ENTITY_SUGGESTION'
      })).not.toThrow();
    }
  });

  it('rejects community/entity modes on ordinary article platforms', () => {
    expect(() => assertDistributionTargetPolicy({
      planLevel: 'ADVANCED',
      platform: 'MEDIUM',
      mode: 'COMMUNITY_DRAFT'
    })).toThrowError(/not allowed/);

    expect(() => assertDistributionTargetPolicy({
      planLevel: 'ENTERPRISE',
      platform: 'WORDPRESS',
      mode: 'ENTITY_SUGGESTION'
    })).toThrowError(/not allowed/);
  });
});
