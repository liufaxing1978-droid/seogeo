import type { PlanLevel } from '@prisma/client';

export type Feature =
  | 'SEO_AUDIT'
  | 'GEO_AUDIT'
  | 'CONTENT_AI'
  | 'CONTENT_INTELLIGENCE'
  | 'COMPETITOR_INTELLIGENCE'
  | 'REPORTING'
  | 'AI_ANALYSIS'
  | 'AI_VISIBILITY'
  | 'PROMPT_MONITOR'
  | 'CITATION_MONITOR'
  | 'COMPETITOR_SOV'
  | 'ADVANCED_REPORTS'
  | 'API_ACCESS'
  | 'SEARCH_CONSOLE'
  | 'GROWTH_OPPORTUNITIES'
  | 'GROWTH_TOPIC_CLUSTERS'
  | 'GROWTH_CANNIBALIZATION'
  | 'GROWTH_NEW_CONTENT'
  | 'GROWTH_AI_EXPLANATION'
  | 'PORTFOLIO_GROWTH';

const standardFeatures = new Set<Feature>([
  'SEO_AUDIT',
  'GEO_AUDIT',
  'CONTENT_AI',
  'CONTENT_INTELLIGENCE',
  'COMPETITOR_INTELLIGENCE',
  'REPORTING',
  'AI_ANALYSIS',
  'SEARCH_CONSOLE',
  'GROWTH_OPPORTUNITIES'
]);

const advancedFeatures = new Set<Feature>([
  ...standardFeatures,
  'AI_VISIBILITY',
  'PROMPT_MONITOR',
  'CITATION_MONITOR',
  'COMPETITOR_SOV',
  'ADVANCED_REPORTS',
  'GROWTH_TOPIC_CLUSTERS',
  'GROWTH_CANNIBALIZATION',
  'GROWTH_NEW_CONTENT',
  'GROWTH_AI_EXPLANATION'
]);

const enterpriseFeatures = new Set<Feature>([
  ...advancedFeatures,
  'API_ACCESS',
  'PORTFOLIO_GROWTH'
]);

const featureMatrix: Record<PlanLevel, Set<Feature>> = {
  STANDARD: standardFeatures,
  ADVANCED: advancedFeatures,
  ENTERPRISE: enterpriseFeatures
};

export function hasFeature(planLevel: PlanLevel, feature: Feature): boolean {
  return featureMatrix[planLevel].has(feature);
}
