import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

describe('P8 publication feature matrix', () => {
  it('gives every plan the bounded publication workspace', () => {
    expect(hasFeature('STANDARD', 'PUBLICATION_WORKSPACE')).toBe(true);
    expect(hasFeature('ADVANCED', 'PUBLICATION_WORKSPACE')).toBe(true);
    expect(hasFeature('ENTERPRISE', 'PUBLICATION_WORKSPACE')).toBe(true);
  });

  it('gates Git execution to Advanced and Enterprise', () => {
    expect(hasFeature('STANDARD', 'PUBLICATION_GIT_EXECUTION')).toBe(false);
    expect(hasFeature('ADVANCED', 'PUBLICATION_GIT_EXECUTION')).toBe(true);
    expect(hasFeature('ENTERPRISE', 'PUBLICATION_GIT_EXECUTION')).toBe(true);
  });

  it('gates distribution to Advanced and Enterprise', () => {
    expect(hasFeature('STANDARD', 'PUBLICATION_DISTRIBUTION')).toBe(false);
    expect(hasFeature('ADVANCED', 'PUBLICATION_DISTRIBUTION')).toBe(true);
    expect(hasFeature('ENTERPRISE', 'PUBLICATION_DISTRIBUTION')).toBe(true);
  });

  it('reserves enterprise governance for Enterprise', () => {
    expect(hasFeature('STANDARD', 'PUBLICATION_ENTERPRISE_GOVERNANCE')).toBe(false);
    expect(hasFeature('ADVANCED', 'PUBLICATION_ENTERPRISE_GOVERNANCE')).toBe(false);
    expect(hasFeature('ENTERPRISE', 'PUBLICATION_ENTERPRISE_GOVERNANCE')).toBe(true);
  });
});
