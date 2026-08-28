import { describe, expect, it } from 'vitest';
import {
  KeywordExpansionOutputSchema,
  parseKeywordExpansionOutput,
} from '../../src/modules/keywords/keyword-ai.js';

describe('keyword expansion structured output', () => {
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
});
