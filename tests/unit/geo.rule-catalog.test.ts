import { describe, expect, it } from 'vitest';
import { BUILTIN_GEO_RULES } from '../../src/modules/geo/rule-catalog.js';

describe('P3 GEO rule catalog', () => {
  it('publishes unique versioned deterministic rules across all readiness dimensions', () => {
    const codes = BUILTIN_GEO_RULES.map((rule) => rule.ruleCode);

    expect(new Set(codes).size).toBe(codes.length);
    expect(BUILTIN_GEO_RULES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(BUILTIN_GEO_RULES.map((rule) => rule.dimension))).toEqual(
      new Set(['CITABILITY', 'ENTITY', 'BRAND', 'AI_CRAWLER', 'CONTENT_GEO'])
    );

    for (const rule of BUILTIN_GEO_RULES) {
      expect(rule.version).toBeGreaterThanOrEqual(1);
      expect(rule.weight).toBeGreaterThan(0);
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(rule.severity);
      expect(['PAGE_FACT', 'CRAWL_FACT', 'PROJECT_AGGREGATE', 'ENTITY_FACT']).toContain(
        rule.detectionType
      );
      expect(rule.geoImpact.length).toBeGreaterThan(10);
      expect(rule.fixGuide.length).toBeGreaterThan(10);
    }
  });

  it('contains the approved stable readiness identities without claiming live AI visibility', () => {
    const codes = new Set<string>(BUILTIN_GEO_RULES.map((rule) => rule.ruleCode));

    for (const code of [
      'CITABILITY_NO_CLEAR_H1',
      'CITABILITY_NO_SOURCE_LINKS',
      'ENTITY_ORGANIZATION_MISSING',
      'ENTITY_SAMEAS_MISSING',
      'BRAND_SITE_NAME_INCONSISTENT',
      'BRAND_ABOUT_PAGE_MISSING',
      'AI_CRAWLER_ROBOTS_BLOCKED',
      'CONTENT_GEO_STRUCTURED_DATA_MISSING'
    ]) {
      expect(codes.has(code)).toBe(true);
    }

    const serialized = JSON.stringify(BUILTIN_GEO_RULES).toLowerCase();
    expect(serialized).not.toContain('ai visibility score');
    expect(serialized).not.toContain('share of voice');
    expect(serialized).not.toContain('chatgpt mention');
    expect(serialized).not.toContain('gemini mention');
  });
});
