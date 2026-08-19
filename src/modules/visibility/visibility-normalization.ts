export type VisibilityOccurrenceMode = 'AUTO' | 'LATIN_BOUNDARY' | 'CJK_SUBSTRING' | 'DOMAIN';

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_CHAR_PATTERN = /[\p{L}\p{N}_]/u;
const DOMAIN_EDGE_CHAR_PATTERN = /[\p{L}\p{N}-]/u;

const PUNCTUATION_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-'],
  [/\u3001/g, ','],
  [/\u3002/g, '.']
];

function foldPunctuation(value: string): string {
  let result = value;
  for (const [pattern, replacement] of PUNCTUATION_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function foldWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function tightenPunctuationSpacing(value: string): string {
  return value
    .replace(/\s+([,.;:!?\)\]\}])/gu, '$1')
    .replace(/([\(\[\{])\s+/gu, '$1');
}

export function normalizeVisibilityText(text: string): string {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('en-US');
  return tightenPunctuationSpacing(foldWhitespace(foldPunctuation(normalized)));
}

export function normalizeVisibilityName(value: string): string {
  return normalizeVisibilityText(value);
}

export function normalizeVisibilityDomain(value: string): string | null {
  const raw = value.normalize('NFKC').trim().toLowerCase();
  if (!raw || /\s/u.test(raw)) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== '' && parsed.pathname !== '/') return null;
  if (parsed.search || parsed.hash) return null;
  if (parsed.port) return null;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '').replace(/^www\./u, '');
  if (!hostname || hostname.includes('/')) return null;
  return hostname;
}

export function isCjkText(value: string): boolean {
  return CJK_PATTERN.test(value.normalize('NFKC'));
}

function isWordChar(value: string | undefined): boolean {
  return Boolean(value && WORD_CHAR_PATTERN.test(value));
}

function hasLatinBoundary(text: string, index: number, length: number): boolean {
  return !isWordChar(text[index - 1]) && !isWordChar(text[index + length]);
}

function hasDomainBoundary(text: string, index: number, length: number): boolean {
  const before = text[index - 1];
  if (before && DOMAIN_EDGE_CHAR_PATTERN.test(before)) return false;
  if (before === '.') {
    const prefixStart = index - 4;
    if (prefixStart < 0 || text.slice(prefixStart, index) !== 'www.') return false;
    if (prefixStart > 0 && DOMAIN_EDGE_CHAR_PATTERN.test(text[prefixStart - 1] ?? '')) return false;
  }

  const after = text[index + length];
  if (after && DOMAIN_EDGE_CHAR_PATTERN.test(after)) return false;
  if (after === '.') {
    const next = text[index + length + 1];
    if (next && DOMAIN_EDGE_CHAR_PATTERN.test(next)) return false;
  }
  return true;
}

export function findDeterministicOccurrences(
  text: string,
  needle: string,
  mode: VisibilityOccurrenceMode = 'AUTO'
): number[] {
  const normalizedText = normalizeVisibilityText(text);
  const effectiveMode = mode === 'AUTO'
    ? (isCjkText(needle) ? 'CJK_SUBSTRING' : 'LATIN_BOUNDARY')
    : mode;

  const normalizedNeedle = effectiveMode === 'DOMAIN'
    ? normalizeVisibilityDomain(needle)
    : normalizeVisibilityName(needle);
  if (!normalizedNeedle) return [];

  const positions: number[] = [];
  let cursor = 0;
  while (cursor <= normalizedText.length - normalizedNeedle.length) {
    const index = normalizedText.indexOf(normalizedNeedle, cursor);
    if (index < 0) break;

    const eligible = effectiveMode === 'CJK_SUBSTRING'
      ? true
      : effectiveMode === 'DOMAIN'
        ? hasDomainBoundary(normalizedText, index, normalizedNeedle.length)
        : hasLatinBoundary(normalizedText, index, normalizedNeedle.length);

    if (eligible) positions.push(index);
    cursor = index + Math.max(normalizedNeedle.length, 1);
  }

  return positions;
}
