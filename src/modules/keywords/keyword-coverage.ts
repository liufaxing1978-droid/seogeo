import { normalizeKeywordText } from './keyword-normalize.js';
import type {
  CoveragePageFact,
  KeywordCoverageEmptyReason,
  KeywordCoverageEvidence,
  KeywordCoverageResult,
} from './keyword.types.js';

const WEIGHTS = {
  title: 4,
  h1: 4,
  metaDescription: 2,
  path: 1,
} as const;

function contains(value: string | null, normalizedKeyword: string): boolean {
  return value ? normalizeKeywordText(value).includes(normalizedKeyword) : false;
}

function safeDecodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function scoreKeywordAgainstPage(
  keywordText: string,
  page: CoveragePageFact,
): KeywordCoverageEvidence {
  const keyword = normalizeKeywordText(keywordText);
  const titleMatch = contains(page.title, keyword);
  const h1Match = contains(page.h1, keyword);
  const metaDescriptionMatch = contains(page.metaDescription, keyword);
  const pathMatch = contains(safeDecodePath(page.path), keyword);
  const score = Number(titleMatch) * WEIGHTS.title
    + Number(h1Match) * WEIGHTS.h1
    + Number(metaDescriptionMatch) * WEIGHTS.metaDescription
    + Number(pathMatch) * WEIGHTS.path;

  return {
    pageId: page.pageId,
    url: page.url,
    titleMatch,
    h1Match,
    metaDescriptionMatch,
    pathMatch,
    score,
  };
}

export function resolveKeywordCoverage(
  keywordText: string,
  pages: CoveragePageFact[],
  emptyReason: KeywordCoverageEmptyReason = 'NO_ACTIVE_PAGE_EVIDENCE',
): KeywordCoverageResult {
  if (pages.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: emptyReason,
      matches: [],
    };
  }

  const evidence = pages
    .map((page) => scoreKeywordAgainstPage(keywordText, page))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  const matches = evidence.filter((item) => item.score > 0);

  if (matches.some((item) => item.score >= 4)) {
    return { status: 'STRONG', reason: 'MATCHED', matches };
  }
  if (matches.length > 0) {
    return { status: 'PARTIAL', reason: 'MATCHED', matches };
  }
  return { status: 'NONE', reason: 'NO_MATCH', matches: [] };
}
