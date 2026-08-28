import { AiTaskType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import * as keywordAiModule from '../../src/modules/keywords/keyword-ai.js';

const {
  KeywordExpansionOutputSchema,
  parseKeywordExpansionOutput,
} = keywordAiModule;

const keywordExpansionFacts = keywordAiModule as unknown as {
  buildKeywordExpansionFactSnapshot(input: {
    seedKeyword: {
      id: string;
      text: string;
      normalizedText: string;
      type: string;
      intent: string | null;
      language: string | null;
      targetCountry: string | null;
      notes?: string | null;
      priority?: string;
      status?: string;
      locked?: boolean;
    };
    projectContext: {
      defaultLanguage: string;
      targetCountry: string;
      industry: string | null;
      name?: string;
      slug?: string;
      primaryDomain?: string;
      timezone?: string;
    };
    existingAcceptedChildren: Array<{
      id: string;
      text: string;
      normalizedText: string;
      type: string;
      intent: string | null;
      language?: string | null;
      targetCountry?: string | null;
      notes?: string | null;
      source?: string;
      status?: string;
    }>;
  }): unknown;
  keywordExpansionRequestKey(snapshot: unknown): string;
};

describe('keyword expansion structured output', () => {
  it('has a durable KEYWORD_EXPANSION AI task type', () => {
    expect((AiTaskType as unknown as Record<string, string>).KEYWORD_EXPANSION).toBe('KEYWORD_EXPANSION');
  });

  it('de-duplicates normalized suggestions and excludes the seed', () => {
    const output = parseKeywordExpansionOutput(JSON.stringify({
      suggestions: [
        { text: '六壬符纸', type: 'LONG_TAIL', intent: 'INFORMATIONAL', rationale: '更窄的相关主题' },
        { text: ' 六壬符纸 ', type: 'LONG_TAIL', intent: 'INFORMATIONAL', rationale: '重复候选' },
        { text: '符纸', type: 'LONG_TAIL', intent: 'INFORMATIONAL', rationale: '重复种子词' },
      ],
    }), '符纸');

    expect(output.suggestions).toHaveLength(1);
    expect(output.suggestions[0]?.text).toBe('六壬符纸');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseKeywordExpansionOutput('{not-json', '符纸')).toThrow();
  });

  it('rejects more than twenty suggestions', () => {
    expect(() => KeywordExpansionOutputSchema.parse({
      suggestions: Array.from({ length: 21 }, (_, index) => ({
        text: `符纸长尾${index}`,
        type: 'LONG_TAIL',
        intent: 'INFORMATIONAL',
        rationale: 'bounded test',
      })),
    })).toThrow();
  });

  it('rejects invalid type and intent enums', () => {
    expect(() => KeywordExpansionOutputSchema.parse({
      suggestions: [{ text: '六壬符纸', type: 'CORE', intent: 'INVALID', rationale: 'bad enum test' }],
    })).toThrow();
  });

  it('rejects empty suggestion text or rationale', () => {
    expect(() => KeywordExpansionOutputSchema.parse({
      suggestions: [{ text: '   ', type: 'QUESTION', intent: 'INFORMATIONAL', rationale: 'valid' }],
    })).toThrow();
    expect(() => KeywordExpansionOutputSchema.parse({
      suggestions: [{ text: '符纸怎么用', type: 'QUESTION', intent: 'INFORMATIONAL', rationale: '   ' }],
    })).toThrow();
  });

  it('builds only the approved fact packet and a stable request key from authoritative keyword state', () => {
    const childA = {
      id: '00000000-0000-4000-8000-000000000001',
      text: '符纸用途',
      normalizedText: '符纸用途',
      type: 'LONG_TAIL',
      intent: 'INFORMATIONAL',
      language: 'zh-CN',
      targetCountry: 'CN',
      notes: 'must not enter AI facts',
      source: 'AI_ACCEPTED',
      status: 'ACTIVE',
    };
    const childB = {
      id: '00000000-0000-4000-8000-000000000002',
      text: '符纸历史',
      normalizedText: '符纸历史',
      type: 'LONG_TAIL',
      intent: 'INFORMATIONAL',
      language: 'zh-CN',
      targetCountry: 'CN',
      notes: 'also excluded',
      source: 'MANUAL',
      status: 'ACTIVE',
    };
    const baseInput = {
      seedKeyword: {
        id: '00000000-0000-4000-8000-000000000000',
        text: '符纸',
        normalizedText: '符纸',
        type: 'CORE',
        intent: 'INFORMATIONAL',
        language: 'zh-CN',
        targetCountry: 'CN',
        notes: 'private operator note',
        priority: 'HIGH',
        status: 'ACTIVE',
        locked: true,
      },
      projectContext: {
        defaultLanguage: 'zh-CN',
        targetCountry: 'CN',
        industry: '民间信仰',
        name: 'private project name',
        slug: 'private-slug',
        primaryDomain: 'example.com',
        timezone: 'Asia/Shanghai',
      },
      existingAcceptedChildren: [childB, childA],
    };

    const snapshot = keywordExpansionFacts.buildKeywordExpansionFactSnapshot(baseInput);

    expect(snapshot).toEqual({
      seedKeyword: {
        id: baseInput.seedKeyword.id,
        text: '符纸',
        normalizedText: '符纸',
        type: 'CORE',
        intent: 'INFORMATIONAL',
        language: 'zh-CN',
        targetCountry: 'CN',
      },
      context: {
        defaultLanguage: 'zh-CN',
        targetCountry: 'CN',
        industry: '民间信仰',
      },
      existingAcceptedChildren: [
        {
          id: childA.id,
          text: '符纸用途',
          normalizedText: '符纸用途',
          type: 'LONG_TAIL',
          intent: 'INFORMATIONAL',
        },
        {
          id: childB.id,
          text: '符纸历史',
          normalizedText: '符纸历史',
          type: 'LONG_TAIL',
          intent: 'INFORMATIONAL',
        },
      ],
    });

    const sameFactsDifferentInputOrder = keywordExpansionFacts.buildKeywordExpansionFactSnapshot({
      ...baseInput,
      existingAcceptedChildren: [childA, childB],
    });
    const key = keywordExpansionFacts.keywordExpansionRequestKey(snapshot);
    const sameKey = keywordExpansionFacts.keywordExpansionRequestKey(sameFactsDifferentInputOrder);
    expect(key).toMatch(/^keyword-expansion:[a-f0-9]{64}$/);
    expect(sameKey).toBe(key);

    const changedFacts = keywordExpansionFacts.buildKeywordExpansionFactSnapshot({
      ...baseInput,
      existingAcceptedChildren: [childA],
    });
    expect(keywordExpansionFacts.keywordExpansionRequestKey(changedFacts)).not.toBe(key);
  });
});
