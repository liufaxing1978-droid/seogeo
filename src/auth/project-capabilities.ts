import type { ProjectRole } from '@prisma/client';

export type ProjectCapability =
  | 'PROJECT_READ'
  | 'PROJECT_SETTINGS_WRITE'
  | 'PROJECT_MEMBER_READ'
  | 'PROJECT_MEMBER_MANAGE_BASIC'
  | 'PROJECT_MEMBER_MANAGE_ALL'
  | 'CRAWL_RUN'
  | 'SEO_RUN'
  | 'GEO_RUN'
  | 'AI_RUN'
  | 'CONTENT_WRITE'
  | 'PUBLICATION_PREPARE'
  | 'PUBLICATION_EXECUTE'
  | 'DISTRIBUTION_EXECUTE'
  | 'OPTIMIZATION_RUN'
  | 'AUTOPILOT_POLICY_REVISE'
  | 'EXPERIMENT_READ'
  | 'FEEDBACK_READ';

const viewerCapabilities = new Set<ProjectCapability>([
  'PROJECT_READ',
  'EXPERIMENT_READ',
  'FEEDBACK_READ',
]);

const operatorCapabilities = new Set<ProjectCapability>([
  ...viewerCapabilities,
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

const adminCapabilities = new Set<ProjectCapability>([
  ...operatorCapabilities,
  'PROJECT_SETTINGS_WRITE',
  'PROJECT_MEMBER_READ',
  'PROJECT_MEMBER_MANAGE_BASIC',
]);

const ownerCapabilities = new Set<ProjectCapability>([
  ...adminCapabilities,
  'PROJECT_MEMBER_MANAGE_ALL',
]);

const capabilitiesByRole: Record<ProjectRole, ReadonlySet<ProjectCapability>> = {
  VIEWER: viewerCapabilities,
  OPERATOR: operatorCapabilities,
  ADMIN: adminCapabilities,
  OWNER: ownerCapabilities,
};

export function hasProjectCapability(
  role: ProjectRole,
  capability: ProjectCapability,
): boolean {
  return capabilitiesByRole[role].has(capability);
}
