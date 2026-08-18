import type { PageRuleEvaluator, RuleEvaluation, SeoPageFact } from '../seo.types.js';

const PASS: RuleEvaluation = { outcome: 'PASS', evidence: {} };
const UNKNOWN: RuleEvaluation = { outcome: 'UNKNOWN', evidence: {} };
const NOT_APPLICABLE: RuleEvaluation = { outcome: 'NOT_APPLICABLE', evidence: {} };

function fail(evidence: Record<string, unknown>): RuleEvaluation {
  return { outcome: 'FAIL', evidence };
}

function is2xx(statusCode: number): boolean {
  return statusCode >= 200 && statusCode <= 299;
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase().split(';', 1)[0]?.trim();
  return normalized === 'text/html' || normalized === 'application/xhtml+xml';
}

function htmlEligibility(fact: SeoPageFact): RuleEvaluation | null {
  if (fact.statusCode === null) return UNKNOWN;
  if (!is2xx(fact.statusCode)) return NOT_APPLICABLE;
  if (fact.contentType === null) return UNKNOWN;
  if (!isHtml(fact.contentType)) return NOT_APPLICABLE;
  return null;
}

function indexableHtmlEligibility(fact: SeoPageFact): RuleEvaluation | null {
  const html = htmlEligibility(fact);
  if (html) return html;
  if (fact.indexable === null) return UNKNOWN;
  if (fact.indexable === false) return NOT_APPLICABLE;
  return null;
}

function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const evaluateHttp5xx: PageRuleEvaluator = (fact) => {
  if (fact.statusCode === null) return UNKNOWN;
  return fact.statusCode >= 500 && fact.statusCode <= 599
    ? fail({ statusCode: fact.statusCode })
    : PASS;
};

export const evaluateHttp4xx: PageRuleEvaluator = (fact) => {
  if (fact.statusCode === null) return UNKNOWN;
  return fact.statusCode >= 400 && fact.statusCode <= 499
    ? fail({ statusCode: fact.statusCode })
    : PASS;
};

export const evaluateHttpRedirect: PageRuleEvaluator = (fact) => {
  if (fact.statusCode === null) return UNKNOWN;
  return fact.redirectCount > 0 ? fail({ redirectCount: fact.redirectCount }) : PASS;
};

export const evaluateTitleMissing: PageRuleEvaluator = (fact) => {
  const eligibility = htmlEligibility(fact);
  if (eligibility) return eligibility;
  return isMissing(fact.title) ? fail({ title: fact.title }) : PASS;
};

export const evaluateTitleTooShort: PageRuleEvaluator = (fact) => {
  const eligibility = htmlEligibility(fact);
  if (eligibility) return eligibility;
  if (isMissing(fact.title)) return NOT_APPLICABLE;
  const length = fact.title!.trim().length;
  return length < 20 ? fail({ titleLength: length, minLength: 20 }) : PASS;
};

export const evaluateTitleTooLong: PageRuleEvaluator = (fact) => {
  const eligibility = htmlEligibility(fact);
  if (eligibility) return eligibility;
  if (isMissing(fact.title)) return NOT_APPLICABLE;
  const length = fact.title!.trim().length;
  return length > 60 ? fail({ titleLength: length, maxLength: 60 }) : PASS;
};

export const evaluateMetaDescriptionMissing: PageRuleEvaluator = (fact) => {
  const eligibility = htmlEligibility(fact);
  if (eligibility) return eligibility;
  return isMissing(fact.metaDescription) ? fail({ metaDescription: fact.metaDescription }) : PASS;
};

export const evaluateMetaDescriptionTooLong: PageRuleEvaluator = (fact) => {
  const eligibility = htmlEligibility(fact);
  if (eligibility) return eligibility;
  if (isMissing(fact.metaDescription)) return NOT_APPLICABLE;
  const length = fact.metaDescription!.trim().length;
  return length > 160 ? fail({ metaDescriptionLength: length, maxLength: 160 }) : PASS;
};

export const evaluateH1Missing: PageRuleEvaluator = (fact) => {
  const eligibility = htmlEligibility(fact);
  if (eligibility) return eligibility;
  return fact.h1Count === 0 ? fail({ h1Count: 0 }) : PASS;
};

export const evaluateH1Multiple: PageRuleEvaluator = (fact) => {
  const eligibility = htmlEligibility(fact);
  if (eligibility) return eligibility;
  return fact.h1Count > 1 ? fail({ h1Count: fact.h1Count }) : PASS;
};

export const evaluateCanonicalMissing: PageRuleEvaluator = (fact) => {
  const eligibility = indexableHtmlEligibility(fact);
  if (eligibility) return eligibility;
  return isMissing(fact.canonicalUrl) ? fail({ canonicalUrl: fact.canonicalUrl }) : PASS;
};

export const evaluateThinContent: PageRuleEvaluator = (fact) => {
  const eligibility = indexableHtmlEligibility(fact);
  if (eligibility) return eligibility;
  return fact.wordCount < 200 ? fail({ wordCount: fact.wordCount, minWords: 200 }) : PASS;
};

export const evaluateImageAltMissing: PageRuleEvaluator = (fact) => {
  const eligibility = htmlEligibility(fact);
  if (eligibility) return eligibility;
  return fact.imagesWithoutAlt > 0
    ? fail({ imagesCount: fact.imagesCount, imagesWithoutAlt: fact.imagesWithoutAlt })
    : PASS;
};

export const evaluateSlowResponse: PageRuleEvaluator = (fact) => {
  if (fact.statusCode === null || fact.responseTimeMs === null) return UNKNOWN;
  return fact.responseTimeMs > 3000
    ? fail({ responseTimeMs: fact.responseTimeMs, thresholdMs: 3000 })
    : PASS;
};

export const evaluateHtmlTooLarge: PageRuleEvaluator = (fact) => {
  const eligibility = htmlEligibility(fact);
  if (eligibility) return eligibility;
  if (fact.htmlSizeBytes === null) return UNKNOWN;
  return fact.htmlSizeBytes > 2_000_000
    ? fail({ htmlSizeBytes: fact.htmlSizeBytes, maxBytes: 2_000_000 })
    : PASS;
};
