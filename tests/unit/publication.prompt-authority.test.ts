import { describe, expect, it } from 'vitest';
import { getPromptDefinition } from '../../src/modules/ai/prompts/prompt-registry.js';
import {
  PUBLICATION_ARTICLE_GENERATION_PROMPT_ID,
  PUBLICATION_CONTENT_BRIEF_PROMPT_ID
} from '../../src/modules/publication/publication-ai.js';

describe('P8-A publication AI prompt authority', () => {
  it('keeps the content brief explicitly advisory and source-bounded', () => {
    const prompt = getPromptDefinition(PUBLICATION_CONTENT_BRIEF_PROMPT_ID);
    const authority = `${prompt.system}\n${prompt.buildUserMessage({ sourceReferences: ['CONTENT_SOURCE_REFERENCE:fixture'] })}`.toLowerCase();

    expect(prompt.mode).toBe('REASONING');
    expect(prompt.responseFormat).toBe('JSON');
    expect(authority).toMatch(/advisory/);
    expect(authority).toMatch(/supplied facts/);
    expect(authority).toMatch(/supplied source/);
    expect(authority).toMatch(/do not invent/);
    expect(authority).toMatch(/historical|history/);
    expect(authority).toMatch(/lineage|transmission/);
    expect(authority).toMatch(/author|authorship/);
    expect(authority).toMatch(/date/);
    expect(authority).toMatch(/ritual/);
    expect(authority).toMatch(/uncertain|uncertainty/);
    expect(authority).toMatch(/source reference/);
  });

  it('keeps article generation advisory and forbids unsupported authoritative-sounding claims', () => {
    const prompt = getPromptDefinition(PUBLICATION_ARTICLE_GENERATION_PROMPT_ID);
    const authority = `${prompt.system}\n${prompt.buildUserMessage({ sourceReferences: ['CONTENT_SOURCE_REFERENCE:fixture'] })}`.toLowerCase();

    expect(prompt.mode).toBe('FAST');
    expect(prompt.responseFormat).toBe('JSON');
    expect(authority).toMatch(/advisory/);
    expect(authority).toMatch(/supplied facts/);
    expect(authority).toMatch(/supplied source/);
    expect(authority).toMatch(/do not invent/);
    expect(authority).toMatch(/historical|history/);
    expect(authority).toMatch(/lineage|transmission/);
    expect(authority).toMatch(/author|authorship/);
    expect(authority).toMatch(/date/);
    expect(authority).toMatch(/ritual/);
    expect(authority).toMatch(/uncertain|uncertainty/);
    expect(authority).toMatch(/verified|authoritative/);
    expect(authority).toMatch(/source reference/);
  });
});
