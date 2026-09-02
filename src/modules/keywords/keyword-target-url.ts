import { isInProjectScope, normalizeCrawlUrl } from '../crawler/url-normalizer.js';

export type EffectiveTargetUrlResult =
  | { state: 'DIRECT' | 'INHERITED'; url: string; urls: string[] }
  | { state: 'UNMAPPED' | 'AMBIGUOUS'; url: null; urls: string[] };

export function normalizeProjectTargetUrl(value: string, primaryDomain: string): string {
  const normalized = normalizeCrawlUrl(value);
  if (!isInProjectScope(new URL(normalized), primaryDomain)) {
    throw new Error('Target URL must be within the project primary domain');
  }
  return normalized;
}

export function resolveEffectiveTargetUrl(input: { direct: string | null; inherited: readonly string[] }): EffectiveTargetUrlResult {
  if (input.direct) return { state: 'DIRECT', url: input.direct, urls: [input.direct] };
  const urls = [...new Set(input.inherited)].sort((a, b) => a.localeCompare(b));
  if (urls.length === 0) return { state: 'UNMAPPED', url: null, urls };
  if (urls.length === 1) return { state: 'INHERITED', url: urls[0]!, urls };
  return { state: 'AMBIGUOUS', url: null, urls };
}
