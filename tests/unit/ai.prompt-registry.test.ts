import { describe, expect, it } from 'vitest';
import {
  PROMPT_DEFINITIONS,
  getPromptDefinition
} from '../../src/modules/ai/prompts/prompt-registry.js';

describe('P4 prompt registry', () => {
  it('defines immutable v1 prompt identities for SEO, GEO and entity intelligence', () => {
    expect(PROMPT_DEFINITIONS.map((prompt) => prompt.id)).toEqual([
      'seo-audit-analysis-v1',
      'geo-readiness-analysis-v1',
      'entity-enrichment-v1'
    ]);
    expect(new Set(PROMPT_DEFINITIONS.map((prompt) => prompt.id)).size).toBe(PROMPT_DEFINITIONS.length);
    expect(PROMPT_DEFINITIONS.every((prompt) => prompt.version === 'v1')).toBe(true);
  });

  it('requires every JSON prompt to explicitly demand JSON, show an output example, and forbid invented facts', () => {
    for (const prompt of PROMPT_DEFINITIONS) {
      expect(prompt.responseFormat).toBe('JSON');
      expect(prompt.system).toMatch(/JSON/);
      expect(prompt.system).toMatch(/example/i);
      expect(prompt.system).toMatch(/supplied facts/i);
      expect(prompt.system).toMatch(/do not invent/i);
      expect(prompt.system).toMatch(/crawl/i);
      expect(prompt.system).toMatch(/HTTP/i);
      expect(prompt.system).toMatch(/ranking/i);
      expect(prompt.system).toMatch(/citation/i);
      expect(prompt.system).toMatch(/visibility/i);
      expect(prompt.system).toMatch(/traffic/i);
      expect(prompt.system).toMatch(/fixed/i);

      const userMessage = prompt.buildUserMessage({ fixture: true });
      expect(userMessage).toContain('JSON');
      expect(userMessage).toContain('{');
    }
  });

  it('uses FAST for bounded SEO analysis and REASONING for GEO/entity semantic work', () => {
    expect(getPromptDefinition('seo-audit-analysis-v1').mode).toBe('FAST');
    expect(getPromptDefinition('geo-readiness-analysis-v1').mode).toBe('REASONING');
    expect(getPromptDefinition('entity-enrichment-v1').mode).toBe('REASONING');
  });

  it('fails closed for an unknown prompt id', () => {
    expect(() => getPromptDefinition('unknown-v1')).toThrow(/unknown AI prompt/i);
  });
});
