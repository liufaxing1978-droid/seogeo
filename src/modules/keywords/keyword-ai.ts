import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseStructuredOutput } from '../ai/structured-output.js';
import { normalizeKeywordText } from './keyword-normalize.js';

export const KEYWORD_EXPANSION_PROMPT_ID = 'keyword-expansion-v1';

export const KeywordExpansionOutputSchema = z.object({
  suggestions: z.array(z.object({
    text: z.string().trim().min(1).max(160),
    type: z.enum(['LONG_TAIL', 'QUESTION', 'LOCAL', 'COMMERCIAL', 'BRAND']),
    intent: z.enum([
      'INFORMATIONAL',
      'NAVIGATIONAL',
      'COMMERCIAL_INVESTIGATION',
      'TRANSACTIONAL',
      'LOCAL',
      'UNKNOWN',
    ]),
    rationale: z.string().trim().min(1).max(300),
  })).max(20),
});

export type KeywordExpansionOutput = z.infer<typeof KeywordExpansionOutputSchema>;

export interface KeywordExpansionSeedFact {
  id: string;
  text: string;
  normalizedText: string;
  type: string;
  intent: string | null;
  language: string | null;
  targetCountry: string | null;
}

export interface KeywordExpansionChildFact {
  id: string;
  text: string;
  normalizedText: string;
  type: string;
  intent: string | null;
}

export interface KeywordExpansionProjectContext {
  defaultLanguage: string;
  targetCountry: string;
  industry: string | null;
}

export interface KeywordExpansionFactSnapshot {
  seedKeyword: KeywordExpansionSeedFact;
  context: KeywordExpansionProjectContext;
  existingAcceptedChildren: KeywordExpansionChildFact[];
}

export function parseKeywordExpansionOutput(content: string, seedText: string): KeywordExpansionOutput {
  const parsed = parseStructuredOutput(content, KeywordExpansionOutputSchema);
  const normalizedSeed = normalizeKeywordText(seedText);
  const seen = new Set<string>();

  return {
    suggestions: parsed.suggestions.filter((suggestion) => {
      const normalized = normalizeKeywordText(suggestion.text);
      if (normalized === normalizedSeed || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    }),
  };
}

export function buildKeywordExpansionFactSnapshot(input: {
  seedKeyword: KeywordExpansionSeedFact;
  projectContext: KeywordExpansionProjectContext;
  existingAcceptedChildren: KeywordExpansionChildFact[];
}): KeywordExpansionFactSnapshot {
  return {
    seedKeyword: {
      id: input.seedKeyword.id,
      text: input.seedKeyword.text,
      normalizedText: input.seedKeyword.normalizedText,
      type: input.seedKeyword.type,
      intent: input.seedKeyword.intent,
      language: input.seedKeyword.language,
      targetCountry: input.seedKeyword.targetCountry,
    },
    context: {
      defaultLanguage: input.projectContext.defaultLanguage,
      targetCountry: input.projectContext.targetCountry,
      industry: input.projectContext.industry,
    },
    existingAcceptedChildren: [...input.existingAcceptedChildren]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((child) => ({
        id: child.id,
        text: child.text,
        normalizedText: child.normalizedText,
        type: child.type,
        intent: child.intent,
      })),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function keywordExpansionRequestKey(snapshot: KeywordExpansionFactSnapshot): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest('hex');
  return `keyword-expansion:${hash}`;
}
