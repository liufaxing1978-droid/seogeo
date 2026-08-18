import type { PlanLevel } from '@prisma/client';

export type Feature =
  | 'SEO_AUDIT'
  | 'GEO_AUDIT'
  | 'CONTENT_AI'
  | 'CONTENT_INTELLIGENCE'
  | 'COMPETITOR_INTELLIGENCE'
  | 'AI_ANALYSIS'
  | 'AI_VISIBILITY'
  | 'PROMPT_MONITOR'
  | 'CITATION_MONITOR'
  | 'COMPETITOR_SOV'
  | 'ADVANCED_REPORTS'
  | 'API_ACCESS';

const standardFeatures = new Set<Feature>(['SEO_AUDIT', 'GEO_AUDIT', 'CONTENT_AI', 'CONTENT_INTELLIGENCE', 'COMPETITOR_INTELLIGENCE', 'AI_ANALYSIS']);
const advancedFeatures = new Set<Feature>([
  ...standardFeatures,
  'AI_VISIBILITY',
  'PROMPT_MONITOR',
  'CITATION_MONITOR',
  'COMPETITOR_SOV',
  'ADVANCED_REPORTS'
]);
const enterpriseFeatures = new Set<Feature>([...advancedFeatures, 'API_ACCESS']);

const featureMatrix: Record<PlanLevel, Set<Feature>> = {
  STANDARD: standardFeatures,
  ADVANCED: advancedFeatures,
  ENTERPRISE: enterpriseFeatures
};

export function hasFeature(planLevel: PlanLevel, feature: Feature): boolean {
  return featureMatrix[planLevel].has(feature);
}
