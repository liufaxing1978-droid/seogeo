export type SeoRuleOutcome = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type SeoSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface SeoPageFact {
  pageId: string;
  normalizedUrl: string;
  statusCode: number | null;
  contentType: string | null;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  metaRobots: string | null;
  h1: string | null;
  h1Count: number;
  wordCount: number;
  imagesCount: number;
  imagesWithoutAlt: number;
  responseTimeMs: number | null;
  htmlSizeBytes: number | null;
  indexable: boolean | null;
  redirectCount: number;
}

export interface SeoRobotsFact {
  statusCode: number | null;
  parseError: string | null;
}

export interface SeoSitemapFact {
  statusCode: number | null;
  type: string | null;
  parseError: string | null;
  discoveredUrlCount: number;
}

export interface SeoCrawlFact {
  robots: SeoRobotsFact[];
  sitemaps: SeoSitemapFact[];
}

export interface RuleEvaluation {
  outcome: SeoRuleOutcome;
  evidence: Record<string, unknown>;
}

export type PageRuleEvaluator = (fact: SeoPageFact) => RuleEvaluation;
export type CrawlRuleEvaluator = (fact: SeoCrawlFact) => RuleEvaluation;

export interface SeoRuleDefinition {
  ruleCode: string;
  name: string;
  category: string;
  description: string;
  version: number;
  severity: SeoSeverity;
  weight: number;
  detectionType: 'PAGE_FACT' | 'CRAWL_FACT';
  detectionConfig?: Record<string, unknown>;
  seoImpact: string;
  fixGuide: string;
}
