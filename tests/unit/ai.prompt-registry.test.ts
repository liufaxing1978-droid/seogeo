import { describe, expect, it } from 'vitest';
import {
  PROMPT_DEFINITIONS,
  getPromptDefinition
} from '../../src/modules/ai/prompts/prompt-registry.js';

describe('versioned AI prompt registry', () => {
  it('defines immutable v1 prompt identities for P4 through P6 intelligence', () => {
    expect(PROMPT_DEFINITIONS.map((prompt) => prompt.id)).toEqual([
      'seo-audit-analysis-v1',
      'geo-readiness-analysis-v1',
      'entity-enrichment-v1',
      'content-brief-v1',
      'content-optimization-v1',
      'competitor-gap-v1',
      'project-report-summary-v1',
      'visibility-trend-analysis-v1'
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

  it('uses FAST only for bounded SEO analysis and REASONING for semantic P4-P6 work', () => {
    expect(getPromptDefinition('seo-audit-analysis-v1').mode).toBe('FAST');
    for (const promptId of [
      'geo-readiness-analysis-v1',
      'entity-enrichment-v1',
      'content-brief-v1',
      'content-optimization-v1',
      'competitor-gap-v1',
      'project-report-summary-v1',
      'visibility-trend-analysis-v1'
    ] as const) {
      expect(getPromptDefinition(promptId).mode).toBe('REASONING');
    }
  });

  it('fails closed for an unknown prompt id', () => {
    expect(() => getPromptDefinition('unknown-v1')).toThrow(/unknown AI prompt/i);
  });
});
