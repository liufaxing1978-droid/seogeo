import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

describe('plan feature matrix', () => {
  it('enables P5 base intelligence for STANDARD while keeping P6 unavailable', () => {
    for (const feature of [
      'SEO_AUDIT',
      'GEO_AUDIT',
      'CONTENT_AI',
      'CONTENT_INTELLIGENCE',
      'COMPETITOR_INTELLIGENCE',
      'REPORTING',
      'AI_ANALYSIS'
    ] as const) {
      expect(hasFeature('STANDARD', feature)).toBe(true);
    }
    expect(hasFeature('STANDARD', 'AI_VISIBILITY')).toBe(false);
    expect(hasFeature('STANDARD', 'COMPETITOR_SOV')).toBe(false);
    expect(hasFeature('STANDARD', 'ADVANCED_REPORTS')).toBe(false);
  });

  it('enables advanced monitoring for ADVANCED', () => {
    for (const feature of ['AI_VISIBILITY','PROMPT_MONITOR','CITATION_MONITOR','COMPETITOR_SOV','ADVANCED_REPORTS'] as const) {
      expect(hasFeature('ADVANCED', feature)).toBe(true);
    }
    expect(hasFeature('ADVANCED', 'API_ACCESS')).toBe(false);
  });

  it('adds API access for ENTERPRISE', () => {
    expect(hasFeature('ENTERPRISE', 'API_ACCESS')).toBe(true);
  });
});
