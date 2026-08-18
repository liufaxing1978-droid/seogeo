import type { CrawlRuleEvaluator, PageRuleEvaluator } from './seo.types.js';
import {
  evaluateRobotsFetchFailed,
  evaluateRobotsServerError,
  evaluateSitemapEmpty,
  evaluateSitemapParseError,
  evaluateSitemapUnavailable
} from './rules/crawl-rules.js';
import {
  evaluateCanonicalMissing,
  evaluateH1Missing,
  evaluateH1Multiple,
  evaluateHtmlTooLarge,
  evaluateHttp4xx,
  evaluateHttp5xx,
  evaluateHttpRedirect,
  evaluateImageAltMissing,
  evaluateMetaDescriptionMissing,
  evaluateMetaDescriptionTooLong,
  evaluateSlowResponse,
  evaluateThinContent,
  evaluateTitleMissing,
  evaluateTitleTooLong,
  evaluateTitleTooShort
} from './rules/page-rules.js';

const PAGE_RULE_EVALUATORS: Readonly<Record<string, PageRuleEvaluator>> = {
  HTTP_5XX: evaluateHttp5xx,
  HTTP_4XX: evaluateHttp4xx,
  HTTP_REDIRECT: evaluateHttpRedirect,
  TITLE_MISSING: evaluateTitleMissing,
  TITLE_TOO_SHORT: evaluateTitleTooShort,
  TITLE_TOO_LONG: evaluateTitleTooLong,
  META_DESCRIPTION_MISSING: evaluateMetaDescriptionMissing,
  META_DESCRIPTION_TOO_LONG: evaluateMetaDescriptionTooLong,
  H1_MISSING: evaluateH1Missing,
  H1_MULTIPLE: evaluateH1Multiple,
  CANONICAL_MISSING: evaluateCanonicalMissing,
  THIN_CONTENT: evaluateThinContent,
  IMAGE_ALT_MISSING: evaluateImageAltMissing,
  SLOW_RESPONSE: evaluateSlowResponse,
  HTML_TOO_LARGE: evaluateHtmlTooLarge
};

const CRAWL_RULE_EVALUATORS: Readonly<Record<string, CrawlRuleEvaluator>> = {
  ROBOTS_FETCH_FAILED: evaluateRobotsFetchFailed,
  ROBOTS_SERVER_ERROR: evaluateRobotsServerError,
  SITEMAP_UNAVAILABLE: evaluateSitemapUnavailable,
  SITEMAP_PARSE_ERROR: evaluateSitemapParseError,
  SITEMAP_EMPTY: evaluateSitemapEmpty
};

export function getPageRuleEvaluator(ruleCode: string): PageRuleEvaluator {
  const evaluator = PAGE_RULE_EVALUATORS[ruleCode];
  if (!evaluator) throw new Error(`Unknown SEO page rule: ${ruleCode}`);
  return evaluator;
}

export function getCrawlRuleEvaluator(ruleCode: string): CrawlRuleEvaluator {
  const evaluator = CRAWL_RULE_EVALUATORS[ruleCode];
  if (!evaluator) throw new Error(`Unknown SEO crawl rule: ${ruleCode}`);
  return evaluator;
}
