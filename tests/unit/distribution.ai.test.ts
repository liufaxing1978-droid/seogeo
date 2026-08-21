import { describe, expect, it } from 'vitest';
import { getPromptDefinition } from '../../src/modules/ai/prompts/prompt-registry.js';

const distributionAiModulePath = '../../src/modules/distribution/distribution-ai.js';

async function loadDistributionAi() {
  const module = await import(distributionAiModulePath).catch(() => null);
  expect(module, 'distribution-ai module must exist for P8-B Task 18').not.toBeNull();
  if (!module) throw new Error('distribution AI module missing');
  return module as any;
}

const originalUrl = 'https://xingshantang.org/culture/source-v7';
const suppliedRefs = [
  { type: 'PUBLICATION_EXECUTION', id: 'publication-1' },
  { type: 'CONTENT_DRAFT_VERSION', id: 'draft-1:v7' }
];

function output(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: '兴善堂平台版本',
    body: '平台原生正文。',
    summary: '平台摘要。',
    tags: ['六壬文化', '民间信仰'],
    originalUrl,
    canonicalUrl: originalUrl,
    sourceRefs: ['PUBLICATION_EXECUTION:publication-1', 'CONTENT_DRAFT_VERSION:draft-1:v7'],
    platformMetadata: { subtitle: '平台副标题' },
    ...overrides
  });
}

describe('P8-B platform-native distribution AI policy', () => {
  it('maps the three approved modes to stable prompt IDs with advisory/source-bounded authority', async () => {
    const module = await loadDistributionAi();
    const cases = [
      ['CANONICAL_REPOST', 'distribution-canonical-repost-v1'],
      ['ADAPTED_ARTICLE', 'distribution-adapted-article-v1'],
      ['SUMMARY', 'distribution-summary-v1']
    ] as const;

    for (const [mode, promptId] of cases) {
      expect(module.promptIdForDistributionMode(mode)).toBe(promptId);
      const prompt = getPromptDefinition(promptId);
      const authority = `${prompt.system}\n${prompt.buildUserMessage({ originalUrl, sourceReferences: suppliedRefs })}`.toLowerCase();
      expect(prompt.responseFormat).toBe('JSON');
      expect(authority).toMatch(/supplied facts|supplied source/);
      expect(authority).toMatch(/do not invent|never invent/);
      expect(authority).toMatch(/original source|original url/);
      expect(authority).toMatch(/draft|advisory/);
      expect(authority).toMatch(/cannot publish|do not claim.*publish|never claim.*publish/);
    }
  });

  it('keeps canonical repost ownership exact and rejects changed original/canonical URLs', async () => {
    const module = await loadDistributionAi();
    const parsed = module.parseDistributionAdaptationOutput(
      output(),
      suppliedRefs,
      { mode: 'CANONICAL_REPOST', originalUrl }
    );
    expect(parsed).toMatchObject({ originalUrl, canonicalUrl: originalUrl });

    expect(() => module.parseDistributionAdaptationOutput(
      output({ originalUrl: 'https://example.com/not-the-primary' }),
      suppliedRefs,
      { mode: 'CANONICAL_REPOST', originalUrl }
    )).toThrow(/original|source/i);

    expect(() => module.parseDistributionAdaptationOutput(
      output({ canonicalUrl: 'https://example.com/canonical' }),
      suppliedRefs,
      { mode: 'CANONICAL_REPOST', originalUrl }
    )).toThrow(/canonical|source/i);
  });

  it('allows prose adaptation but never foreign source refs or a different claimed original source', async () => {
    const module = await loadDistributionAi();
    const parsed = module.parseDistributionAdaptationOutput(
      output({ title: 'LinkedIn 改写标题', body: '允许改写的正文。', summary: '允许改写的摘要。' }),
      suppliedRefs,
      { mode: 'ADAPTED_ARTICLE', originalUrl }
    );
    expect(parsed.title).toBe('LinkedIn 改写标题');
    expect(parsed.body).toBe('允许改写的正文。');
    expect(parsed.originalUrl).toBe(originalUrl);

    expect(() => module.parseDistributionAdaptationOutput(
      output({ sourceRefs: ['PUBLICATION_EXECUTION:publication-1', 'WEB_SOURCE:invented'] }),
      suppliedRefs,
      { mode: 'ADAPTED_ARTICLE', originalUrl }
    )).toThrow(/source/i);

    expect(() => module.parseDistributionAdaptationOutput(
      output({ originalUrl: 'https://other.example/source' }),
      suppliedRefs,
      { mode: 'SUMMARY', originalUrl }
    )).toThrow(/original|source/i);
  });

  it('binds request identity to publication, exact source version, platform, mode and prompt version', async () => {
    const module = await loadDistributionAi();
    const base = {
      publicationId: 'publication-1',
      sourceContentVersion: 7,
      platform: 'MEDIUM',
      mode: 'CANONICAL_REPOST',
      promptVersion: 'distribution-canonical-repost-v1'
    };
    const key = module.distributionAdaptationRequestKey(base);
    expect(key).toBe(module.distributionAdaptationRequestKey({ ...base }));

    for (const changed of [
      { ...base, publicationId: 'publication-2' },
      { ...base, sourceContentVersion: 8 },
      { ...base, platform: 'SUBSTACK' },
      { ...base, mode: 'SUMMARY' },
      { ...base, promptVersion: 'distribution-canonical-repost-v2' }
    ]) {
      expect(module.distributionAdaptationRequestKey(changed)).not.toBe(key);
    }
  });
});
