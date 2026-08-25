import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

const hasOperationsFeature = hasFeature as unknown as (
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE',
  feature: string,
) => boolean;

describe('P9-F Operations Center feature availability', () => {
  it('is unavailable to Standard and available to Advanced and Enterprise', () => {
    expect(hasOperationsFeature('STANDARD', 'OPTIMIZATION_OPERATIONS_CENTER')).toBe(false);
    expect(hasOperationsFeature('ADVANCED', 'OPTIMIZATION_OPERATIONS_CENTER')).toBe(true);
    expect(hasOperationsFeature('ENTERPRISE', 'OPTIMIZATION_OPERATIONS_CENTER')).toBe(true);
  });
});
