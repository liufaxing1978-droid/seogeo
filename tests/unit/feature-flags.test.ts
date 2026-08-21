import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

const feature = (value: string) => value as Parameters<typeof hasFeature>[1];

describe('plan feature matrix', () => {
  it('enables P5 base intelligence and P7-A basic Search/Growth for STANDARD', () => {
    for (const name of [
      'SEO_AUDIT',
      'GEO_AUDIT',
      'CONTENT_AI',
      'CONTENT_INTELLIGENCE',
      'COMPETITOR_INTELLIGENCE',
      'REPORTING',
      'AI_ANALYSIS',
      'SEARCH_CONSOLE',
      'GROWTH_OPPORTUNITIES'
    ]) {
      expect(hasFeature('STANDARD', feature(name))).toBe(true);
    }
    for (const name of [
      'AI_VISIBILITY',
      'COMPETITOR_SOV',
      'ADVANCED_REPORTS',
      'GROWTH_TOPIC_CLUSTERS',
      'GROWTH_CANNIBALIZATION',
      'GROWTH_NEW_CONTENT',
      'GROWTH_AI_EXPLANATION',
      'PORTFOLIO_GROWTH'
    ]) {
      expect(hasFeature('STANDARD', feature(name))).toBe(false);
    }
  });

  it('enables full project Growth intelligence for ADVANCED but not portfolio Growth', () => {
    for (const name of [
      'AI_VISIBILITY',
      'PROMPT_MONITOR',
      'CITATION_MONITOR',
      'COMPETITOR_SOV',
      'ADVANCED_REPORTS',
      'SEARCH_CONSOLE',
      'GROWTH_OPPORTUNITIES',
      'GROWTH_TOPIC_CLUSTERS',
      'GROWTH_CANNIBALIZATION',
      'GROWTH_NEW_CONTENT',
      'GROWTH_AI_EXPLANATION'
    ]) {
      expect(hasFeature('ADVANCED', feature(name))).toBe(true);
    }
    expect(hasFeature('ADVANCED', 'API_ACCESS')).toBe(false);
    expect(hasFeature('ADVANCED', feature('PORTFOLIO_GROWTH'))).toBe(false);
  });

  it('adds API access and portfolio Growth for ENTERPRISE', () => {
    expect(hasFeature('ENTERPRISE', 'API_ACCESS')).toBe(true);
    expect(hasFeature('ENTERPRISE', feature('PORTFOLIO_GROWTH'))).toBe(true);
  });
});