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
  type: string;
  intent: string | null;
}

export interface KeywordExpansionChildFact {
  id: string;
  text: string;
}

export interface KeywordExpansionProjectContext {
  defaultLanguage: string;
  targetCountry: string;
  industry: string | null;
}

export interface KeywordExpansionFactSnapshot {
  seedKeyword: KeywordExpansionSeedFact;
  existingAcceptedChildren: string[];
  context: KeywordExpansionProjectContext;
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
      type: input.seedKeyword.type,
      intent: input.seedKeyword.intent,
    },
    existingAcceptedChildren: [...input.existingAcceptedChildren]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((child) => child.text),
    context: {
      industry: input.projectContext.industry,
      defaultLanguage: input.projectContext.defaultLanguage,
      targetCountry: input.projectContext.targetCountry,
    },
  };
}

export function keywordExpansionRequestKey(seed: { id: string; updatedAt: Date }): string {
  return `keyword-expand:${seed.id}:${seed.updatedAt.toISOString()}:${KEYWORD_EXPANSION_PROMPT_ID}`;
}
