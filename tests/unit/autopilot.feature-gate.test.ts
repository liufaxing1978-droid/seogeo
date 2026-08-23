import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

const controlledAutopilot = 'CONTROLLED_AUTOPILOT' as Parameters<typeof hasFeature>[1];

describe('P9-C controlled autopilot entitlement', () => {
  it('is unavailable to STANDARD and available to ADVANCED/ENTERPRISE', () => {
    expect(hasFeature('STANDARD', controlledAutopilot)).toBe(false);
    expect(hasFeature('ADVANCED', controlledAutopilot)).toBe(true);
    expect(hasFeature('ENTERPRISE', controlledAutopilot)).toBe(true);
  });
});
