import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

const orchestrationFeature = 'OPTIMIZATION_ORCHESTRATION' as Parameters<typeof hasFeature>[1];

describe('P9-B orchestration entitlement', () => {
  it('is unavailable to Standard and available to Advanced and Enterprise', () => {
    expect(hasFeature('STANDARD', orchestrationFeature)).toBe(false);
    expect(hasFeature('ADVANCED', orchestrationFeature)).toBe(true);
    expect(hasFeature('ENTERPRISE', orchestrationFeature)).toBe(true);
  });
});
