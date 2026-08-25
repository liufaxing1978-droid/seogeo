import type { ProjectRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  hasProjectCapability,
  type ProjectCapability,
} from '../../src/auth/project-capabilities.js';

const ALL_CAPABILITIES = [
  'PROJECT_READ',
  'PROJECT_SETTINGS_WRITE',
  'PROJECT_MEMBER_READ',
  'PROJECT_MEMBER_MANAGE_BASIC',
  'PROJECT_MEMBER_MANAGE_ALL',
  'CRAWL_RUN',
  'SEO_RUN',
  'GEO_RUN',
  'AI_RUN',
  'CONTENT_WRITE',
  'PUBLICATION_PREPARE',
  'PUBLICATION_EXECUTE',
  'DISTRIBUTION_EXECUTE',
  'OPTIMIZATION_RUN',
  'AUTOPILOT_POLICY_REVISE',
  'EXPERIMENT_READ',
  'FEEDBACK_READ',
] as const satisfies readonly ProjectCapability[];

const VIEWER = new Set<ProjectCapability>([
  'PROJECT_READ',
  'EXPERIMENT_READ',
  'FEEDBACK_READ',
]);

const OPERATOR = new Set<ProjectCapability>([
  ...VIEWER,
  'CRAWL_RUN',
  'SEO_RUN',
  'GEO_RUN',
  'AI_RUN',
  'CONTENT_WRITE',
  'PUBLICATION_PREPARE',
  'PUBLICATION_EXECUTE',
  'DISTRIBUTION_EXECUTE',
  'OPTIMIZATION_RUN',
  'AUTOPILOT_POLICY_REVISE',
]);

const ADMIN = new Set<ProjectCapability>([
  ...OPERATOR,
  'PROJECT_SETTINGS_WRITE',
  'PROJECT_MEMBER_READ',
  'PROJECT_MEMBER_MANAGE_BASIC',
]);

const OWNER = new Set<ProjectCapability>([
  ...ADMIN,
  'PROJECT_MEMBER_MANAGE_ALL',
]);

const EXPECTED: Record<ProjectRole, Set<ProjectCapability>> = {
  VIEWER,
  OPERATOR,
  ADMIN,
  OWNER,
};

describe('P10-A project capability matrix', () => {
  it.each(Object.entries(EXPECTED) as [ProjectRole, Set<ProjectCapability>][]) (
    '%s has exactly the approved capabilities',
    (role, expected) => {
      for (const capability of ALL_CAPABILITIES) {
        expect(
          hasProjectCapability(role, capability),
          `${role} -> ${capability}`,
        ).toBe(expected.has(capability));
      }
    },
  );

  it('keeps project administration capabilities out of OPERATOR', () => {
    expect(hasProjectCapability('OPERATOR', 'PROJECT_SETTINGS_WRITE')).toBe(false);
    expect(hasProjectCapability('OPERATOR', 'PROJECT_MEMBER_READ')).toBe(false);
    expect(hasProjectCapability('OPERATOR', 'PROJECT_MEMBER_MANAGE_BASIC')).toBe(false);
    expect(hasProjectCapability('OPERATOR', 'PROJECT_MEMBER_MANAGE_ALL')).toBe(false);
  });

  it('keeps full member management exclusive to OWNER', () => {
    expect(hasProjectCapability('ADMIN', 'PROJECT_MEMBER_MANAGE_ALL')).toBe(false);
    expect(hasProjectCapability('OWNER', 'PROJECT_MEMBER_MANAGE_ALL')).toBe(true);
  });
});
