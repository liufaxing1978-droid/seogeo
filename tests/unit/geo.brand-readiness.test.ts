import { describe, expect, it } from 'vitest';
import { calculateBrandReadiness } from '../../src/modules/geo/brand-readiness.js';

describe('calculateBrandReadiness', () => {
  it('scores only factual owned-identity signals and normalizes unavailable consistency dimensions', () => {
    const result = calculateBrandReadiness({
      officialIdentityPresent: true,
      organizationSchemaPresent: true,
      sameAsCount: 4,
      publisherConsistency: 100,
      contactIdentityConsistency: null,
      aboutPagePresent: true
    });

    expect(result.overallScore).toBe(100);
    expect(result.contactIdentityConsistency).toBeNull();
    expect(result.availableWeight).toBe(90);
  });

  it('does not invent publisher or contact consistency when those facts are unavailable', () => {
    const result = calculateBrandReadiness({
      officialIdentityPresent: false,
      organizationSchemaPresent: false,
      sameAsCount: 0,
      publisherConsistency: null,
      contactIdentityConsistency: null,
      aboutPagePresent: false
    });

    expect(result.publisherConsistency).toBeNull();
    expect(result.contactIdentityConsistency).toBeNull();
    expect(result.availableWeight).toBe(75);
    expect(result.overallScore).toBe(0);
  });
});
