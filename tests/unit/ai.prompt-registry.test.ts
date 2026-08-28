import { describe, expect, it } from 'vitest';
import {
  PROMPT_DEFINITIONS,
  getPromptDefinition
} from '../../src/modules/ai/prompts/prompt-registry.js';

describe('versioned AI prompt registry', () => {
  it('defines immutable v1 prompt identities for P4 through P11 keyword intelligence', () => {
    expect(PROMPT_DEFINITIONS.map((prompt) => prompt.id)).toEqual([
      'seo-audit-analysis-v1',
      'geo-readiness-analysis-v1',
      'entity-enrichment-v1',
      'content-brief-v1',
      'content-optimization-v1',
      'competitor-gap-v1',
      'project-report-summary-v1',
      'visibility-trend-analysis-v1',
      'growth-opportunity-explanation-v1',
      'optimization-plan-ranking-v1',
      'keyword-expansion-v1',
      'publication-content-brief-v1',
      'publication-article-generation-v1',
      'distribution-canonical-repost-v1',
      'distribution-adapted-article-v1',
      'distribution-summary-v1',
      'distribution-community-draft-v1',
      'distribution-entity-suggestion-v1'
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

  it('uses FAST for bounded analysis/drafting/adaptation and REASONING for semantic work', () => {
    for (const promptId of [
      'seo-audit-analysis-v1',
      'keyword-expansion-v1',
      'publication-article-generation-v1',
      'distribution-canonical-repost-v1',
      'distribution-adapted-article-v1',
      'distribution-summary-v1',
      'distribution-community-draft-v1'
    ] as const) {
      expect(getPromptDefinition(promptId).mode).toBe('FAST');
    }
    for (const promptId of [
      'geo-readiness-analysis-v1',
      'entity-enrichment-v1',
      'content-brief-v1',
      'content-optimization-v1',
      'competitor-gap-v1',
      'project-report-summary-v1',
      'visibility-trend-analysis-v1',
      'growth-opportunity-explanation-v1',
      'optimization-plan-ranking-v1',
      'publication-content-brief-v1',
      'distribution-entity-suggestion-v1'
    ] as const) {
      expect(getPromptDefinition(promptId).mode).toBe('REASONING');
    }
  });

  it('keeps Growth explanation advisory and preserves deterministic authority in the prompt contract', () => {
    const prompt = getPromptDefinition('growth-opportunity-explanation-v1');
    expect(prompt.system).toMatch(/deterministic/i);
    expect(prompt.system).toMatch(/score/i);
    expect(prompt.system).toMatch(/priority/i);
    expect(prompt.system).toMatch(/lifecycle/i);
    expect(prompt.system).toMatch(/UNKNOWN/);
    expect(prompt.system).toMatch(/PARTIAL/);
    expect(prompt.system).toMatch(/advisory/i);
  });

  it('keeps keyword expansion bounded, advisory, and non-authoritative', () => {
    const prompt = getPromptDefinition('keyword-expansion-v1');
    expect(prompt.mode).toBe('FAST');
    expect(prompt.responseFormat).toBe('JSON');
    expect(prompt.system).toMatch(/advisory/i);
    expect(prompt.system).toMatch(/at most 20/i);
    expect(prompt.system).toMatch(/search volume/i);
    expect(prompt.system).toMatch(/ranking/i);
    expect(prompt.system).toMatch(/traffic/i);
    expect(prompt.system).toMatch(/commercial value/i);
    expect(prompt.system).toMatch(/seed keyword/i);
    expect(prompt.system).toMatch(/existing accepted children/i);
    expect(prompt.system).toMatch(/context/i);
    expect(prompt.system).toMatch(/authoritative strategy/i);
  });

  it('fails closed for an unknown prompt id', () => {
    expect(() => getPromptDefinition('unknown-v1')).toThrow(/unknown AI prompt/i);
  });
});
