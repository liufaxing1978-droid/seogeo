import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

describe('plan feature matrix', () => {
  it('keeps AI Visibility out of STANDARD', () => {
    expect(hasFeature('STANDARD', 'SEO_AUDIT')).toBe(true);
    expect(hasFeature('STANDARD', 'GEO_AUDIT')).toBe(true);
    expect(hasFeature('STANDARD', 'CONTENT_AI')).toBe(true);
    expect(hasFeature('STANDARD', 'AI_VISIBILITY')).toBe(false);
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
