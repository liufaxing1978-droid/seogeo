import { normalizeKeywordText } from './keyword-normalize.js';

export interface KeywordBulkCandidate {
  line: number;
  text: string;
  normalizedText: string;
}

export interface KeywordBulkDuplicate extends KeywordBulkCandidate {
  reason: 'ALREADY_EXISTS' | 'DUPLICATE_IN_REQUEST';
}

export interface KeywordBulkPlan {
  candidates: KeywordBulkCandidate[];
  duplicates: KeywordBulkDuplicate[];
}

export function planKeywordBulkCreate(input: {
  text: string;
  existingNormalized: ReadonlySet<string>;
}): KeywordBulkPlan {
  const candidates: KeywordBulkCandidate[] = [];
  const duplicates: KeywordBulkDuplicate[] = [];
  const seen = new Set<string>();

  input.text.split(/\r?\n/u).forEach((rawText, index) => {
    const text = rawText.trim();
    if (!text) return;
    const normalizedText = normalizeKeywordText(text);
    const candidate = { line: index + 1, text, normalizedText };

    if (input.existingNormalized.has(normalizedText)) {
      duplicates.push({ ...candidate, reason: 'ALREADY_EXISTS' });
      return;
    }
    if (seen.has(normalizedText)) {
      duplicates.push({ ...candidate, reason: 'DUPLICATE_IN_REQUEST' });
      return;
    }

    seen.add(normalizedText);
    candidates.push(candidate);
  });

  return { candidates, duplicates };
}
