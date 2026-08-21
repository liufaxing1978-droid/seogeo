import { describe, expect, it } from 'vitest';
import { getPromptDefinition } from '../../src/modules/ai/prompts/prompt-registry.js';

const modulePath = '../../src/modules/distribution/entity-suggestion.js';

async function loadModule() {
  const module = await import(modulePath).catch(() => null);
  expect(module, 'entity-suggestion module must exist for P8-C Task 24').not.toBeNull();
  if (!module) throw new Error('entity suggestion module missing');
  return module as any;
}

const suppliedRefs = [
  { type: 'CONTENT_SOURCE_REFERENCE', id: 'source-1' },
  { type: 'CONTENT_SOURCE_REFERENCE', id: 'source-2' }
];

function output(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    entityName: '兴善堂',
    labels: [{ language: 'zh-CN', value: '兴善堂' }],
    descriptions: [{ language: 'zh-CN', value: '传统文化资料整理项目。' }],
    attributes: [{
      property: 'officialWebsite',
      value: 'https://xingshantang.org',
      sourceRefs: ['CONTENT_SOURCE_REFERENCE:source-1']
    }],
    sameAs: [{
      url: 'https://example.org/entity/xingshantang',
      sourceRefs: ['CONTENT_SOURCE_REFERENCE:source-2']
    }],
    relationships: [],
    reliableSourceRefs: [
      'CONTENT_SOURCE_REFERENCE:source-1',
      'CONTENT_SOURCE_REFERENCE:source-2'
    ],
    missingData: ['foundingDate'],
    policyReminders: ['Human review required; avoid promotional or conflict-of-interest editing.'],
    humanChecklist: ['Verify every factual claim against the cited reliable source before editing.'],
    ...overrides
  });
}

describe('P8-C entity / knowledge-graph suggestion contract', () => {
  it('registers one source-bounded semantic prompt that cannot claim platform submission or approval', () => {
    const prompt = getPromptDefinition('distribution-entity-suggestion-v1');
    const authority = `${prompt.system}\n${prompt.buildUserMessage({ sourceReferences: suppliedRefs })}`;
    expect(prompt.mode).toBe('REASONING');
    expect(prompt.responseFormat).toBe('JSON');
    expect(authority).toMatch(/reliable|source/i);
    expect(authority).toMatch(/missing|unknown|unavailable/i);
    expect(authority).toMatch(/human|review|checklist/i);
    expect(authority).toMatch(/conflict.of.interest|promotional|policy/i);
    expect(authority).toMatch(/must not claim|never claim/i);
    expect(authority).toMatch(/submit|publish|approval|accepted/i);
  });

  it('accepts the strict bounded output and renders a deterministic review body', async () => {
    const module = await loadModule();
    const parsed = module.parseEntitySuggestionOutput(output(), suppliedRefs);
    expect(parsed).toMatchObject({
      entityName: '兴善堂',
      labels: [{ language: 'zh-CN', value: '兴善堂' }],
      reliableSourceRefs: [
        'CONTENT_SOURCE_REFERENCE:source-1',
        'CONTENT_SOURCE_REFERENCE:source-2'
      ],
      missingData: ['foundingDate']
    });
    const rendered = module.renderEntitySuggestionBody(parsed);
    expect(rendered).toContain('兴善堂');
    expect(rendered).toContain('officialWebsite');
    expect(rendered).toContain('foundingDate');
    expect(rendered).toContain('Human review required');
  });

  it('rejects unsupported factual attributes and SameAs candidates', async () => {
    const module = await loadModule();
    expect(() => module.parseEntitySuggestionOutput(output({
      attributes: [{ property: 'foundingDate', value: '1978', sourceRefs: ['CONTENT_SOURCE_REFERENCE:invented'] }]
    }), suppliedRefs)).toThrow(/source/i);

    expect(() => module.parseEntitySuggestionOutput(output({
      sameAs: [{ url: 'https://example.org/entity/unsupported', sourceRefs: [] }]
    }), suppliedRefs)).toThrow(/same.?as|source/i);

    expect(() => module.parseEntitySuggestionOutput(output({
      reliableSourceRefs: [],
      attributes: [{ property: 'officialWebsite', value: 'https://xingshantang.org', sourceRefs: ['CONTENT_SOURCE_REFERENCE:source-1'] }]
    }), suppliedRefs)).toThrow(/reliable|source/i);
  });

  it('rejects unbounded, unsafe URL and provider-controlled submission fields', async () => {
    const module = await loadModule();
    expect(() => module.parseEntitySuggestionOutput(output({
      labels: Array.from({ length: 51 }, (_, index) => ({ language: 'zh-CN', value: `label-${index}` }))
    }), suppliedRefs)).toThrow();
    expect(() => module.parseEntitySuggestionOutput(output({
      sameAs: [{ url: 'javascript:alert(1)', sourceRefs: ['CONTENT_SOURCE_REFERENCE:source-1'] }]
    }), suppliedRefs)).toThrow();
    expect(() => module.parseEntitySuggestionOutput(output({
      submissionStatus: 'published'
    }), suppliedRefs)).toThrow(/schema|output/i);
  });
});
