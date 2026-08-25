import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

const optimizationExperiments = 'OPTIMIZATION_EXPERIMENTS' as Parameters<typeof hasFeature>[1];

describe('P9-D feature gate', () => {
  it('is unavailable to STANDARD and available to ADVANCED/ENTERPRISE', () => {
    expect(hasFeature('STANDARD', optimizationExperiments)).toBe(false);
    expect(hasFeature('ADVANCED', optimizationExperiments)).toBe(true);
    expect(hasFeature('ENTERPRISE', optimizationExperiments)).toBe(true);
  });
});
