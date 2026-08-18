import type { CrawlRuleEvaluator, RuleEvaluation, SeoCrawlFact } from '../seo.types.js';

const PASS: RuleEvaluation = { outcome: 'PASS', evidence: {} };
const UNKNOWN: RuleEvaluation = { outcome: 'UNKNOWN', evidence: {} };
const NOT_APPLICABLE: RuleEvaluation = { outcome: 'NOT_APPLICABLE', evidence: {} };

function fail(evidence: Record<string, unknown>): RuleEvaluation {
  return { outcome: 'FAIL', evidence };
}

function firstRobots(fact: SeoCrawlFact) {
  return fact.robots[0] ?? null;
}

export const evaluateRobotsFetchFailed: CrawlRuleEvaluator = (fact) => {
  const robots = firstRobots(fact);
  if (!robots) return UNKNOWN;
  if (robots.statusCode !== null) return PASS;
  return robots.parseError
    ? fail({ parseError: robots.parseError })
    : UNKNOWN;
};

export const evaluateRobotsServerError: CrawlRuleEvaluator = (fact) => {
  const robots = firstRobots(fact);
  if (!robots || robots.statusCode === null) return UNKNOWN;
  return robots.statusCode >= 500 && robots.statusCode <= 599
    ? fail({ statusCode: robots.statusCode })
    : PASS;
};

function usableSitemaps(fact: SeoCrawlFact) {
  return fact.sitemaps.filter(
    (source) =>
      source.statusCode !== null &&
      source.statusCode >= 200 &&
      source.statusCode <= 299 &&
      source.parseError === null &&
      source.type !== null
  );
}

export const evaluateSitemapUnavailable: CrawlRuleEvaluator = (fact) => {
  const usable = usableSitemaps(fact);
  if (usable.length > 0) return PASS;

  return fail({
    sourceCount: fact.sitemaps.length,
    statuses: fact.sitemaps.map((source) => source.statusCode)
  });
};

export const evaluateSitemapParseError: CrawlRuleEvaluator = (fact) => {
  const parseErrors = fact.sitemaps
    .filter(
      (source) =>
        source.statusCode !== null &&
        source.statusCode >= 200 &&
        source.statusCode <= 299 &&
        source.parseError !== null
    )
    .map((source) => ({
      statusCode: source.statusCode,
      parseError: source.parseError
    }));

  if (parseErrors.length > 0) return fail({ parseErrors });

  const fetched2xx = fact.sitemaps.some(
    (source) =>
      source.statusCode !== null &&
      source.statusCode >= 200 &&
      source.statusCode <= 299
  );
  return fetched2xx ? PASS : NOT_APPLICABLE;
};

export const evaluateSitemapEmpty: CrawlRuleEvaluator = (fact) => {
  const urlSets = usableSitemaps(fact).filter((source) => source.type === 'URLSET');
  if (urlSets.length === 0) return NOT_APPLICABLE;

  const emptySources = urlSets.filter((source) => source.discoveredUrlCount === 0).length;
  return emptySources > 0 ? fail({ emptySources }) : PASS;
};
