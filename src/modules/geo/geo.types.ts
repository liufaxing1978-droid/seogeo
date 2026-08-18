export type GeoRuleOutcome = 'PASS' | 'FAIL' | 'UNKNOWN';
export type GeoDimension = 'CITABILITY' | 'ENTITY' | 'BRAND' | 'AI_CRAWLER' | 'CONTENT_GEO';
export type GeoPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type GeoDetectionType = 'PAGE_FACT' | 'CRAWL_FACT' | 'PROJECT_AGGREGATE' | 'ENTITY_FACT';

export interface GeoRuleDefinition {
  ruleCode: string;
  name: string;
  category: string;
  description: string;
  version: number;
  dimension: GeoDimension;
  severity: GeoPriority;
  weight: number;
  detectionType: GeoDetectionType;
  detectionConfig?: Record<string, unknown>;
  geoImpact: string;
  fixGuide: string;
}

export interface GeoRuleEvaluation {
  outcome: GeoRuleOutcome;
  evidence: Record<string, unknown>;
}
