import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

const optimizationFeedback = 'OPTIMIZATION_FEEDBACK' as Parameters<typeof hasFeature>[1];

describe('P9-E feature gate', () => {
  it('is unavailable to STANDARD and available to ADVANCED/ENTERPRISE', () => {
    expect(hasFeature('STANDARD', optimizationFeedback)).toBe(false);
    expect(hasFeature('ADVANCED', optimizationFeedback)).toBe(true);
    expect(hasFeature('ENTERPRISE', optimizationFeedback)).toBe(true);
  });
});
