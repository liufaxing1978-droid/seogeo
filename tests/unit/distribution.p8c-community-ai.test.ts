import { describe, expect, it } from 'vitest';
import { getPromptDefinition } from '../../src/modules/ai/prompts/prompt-registry.js';

const modulePath = '../../src/modules/distribution/distribution-ai.js';

async function loadModule() {
  return import(modulePath) as Promise<any>;
}

const originalUrl = 'https://xingshantang.org/culture/original-v7';
const suppliedRefs = [
  { type: 'PUBLICATION_EXECUTION', id: 'publication-1' },
  { type: 'CONTENT_DRAFT_VERSION', id: 'draft-1:v7' },
  { type: 'CONTENT_SOURCE_REFERENCE', id: 'source-1' }
];

function communityOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: '如何从原始资料理解这一传统？',
    body: '可以先区分可核实的原始资料与后来的解释，再按来源逐项阅读。',
    summary: '基于原始资料的社区回答草稿。',
    tags: ['民间信仰', '资料阅读'],
    sourceRefs: ['CONTENT_SOURCE_REFERENCE:source-1'],
    promotionalLanguageDetected: false,
    brandLinkIncluded: false,
    originalUrl,
    canonicalUrl: null,
    ...overrides
  });
}

describe('P8-C community-native distribution AI', () => {
  it('maps COMMUNITY_DRAFT to a stable human-review prompt with anti-fabrication rules', async () => {
    const module = await loadModule();
    expect(module.promptIdForDistributionMode('COMMUNITY_DRAFT')).toBe('distribution-community-draft-v1');

    const prompt = getPromptDefinition('distribution-community-draft-v1');
    const authority = `${prompt.system}\n${prompt.buildUserMessage({
      question: 'How should this source be read?',
      includeBrandLink: false,
      sourceReferences: suppliedRefs
    })}`.toLowerCase();
    expect(prompt.responseFormat).toBe('JSON');
    expect(authority).toMatch(/question|topic/);
    expect(authority).toMatch(/human review|human-reviewed|review/);
    expect(authority).toMatch(/source reference|supplied source/);
    expect(authority).toMatch(/brand.*link|link.*brand/);
    expect(authority).toMatch(/endorsement|testimony|fake discussion/);
    expect(authority).toMatch(/never claim.*posted|cannot publish|do not claim.*posted/);
  });

  it('accepts only the strict source-backed community output contract', async () => {
    const module = await loadModule();
    const parsed = module.parseCommunityDistributionOutput(
      communityOutput(),
      suppliedRefs,
      { originalUrl, includeBrandLink: false }
    );
    expect(parsed).toMatchObject({
      canonicalUrl: null,
      originalUrl,
      promotionalLanguageDetected: false,
      brandLinkIncluded: false
    });

    expect(() => module.parseCommunityDistributionOutput(
      communityOutput({ sourceRefs: ['WEB_SOURCE:invented'] }),
      suppliedRefs,
      { originalUrl, includeBrandLink: false }
    )).toThrow(/source/i);

    expect(() => module.parseCommunityDistributionOutput(
      communityOutput({ originalUrl: 'https://other.example/source' }),
      suppliedRefs,
      { originalUrl, includeBrandLink: false }
    )).toThrow(/original|source/i);

    expect(() => module.parseCommunityDistributionOutput(
      communityOutput({ canonicalUrl: originalUrl }),
      suppliedRefs,
      { originalUrl, includeBrandLink: false }
    )).toThrow(/canonical/i);

    expect(() => module.parseCommunityDistributionOutput(
      communityOutput({ brandLinkIncluded: true }),
      suppliedRefs,
      { originalUrl, includeBrandLink: false }
    )).toThrow(/brand|link/i);

    expect(() => module.parseCommunityDistributionOutput(
      communityOutput({ body: 'x'.repeat(30_001) }),
      suppliedRefs,
      { originalUrl, includeBrandLink: false }
    )).toThrow();

    expect(() => module.parseCommunityDistributionOutput(
      communityOutput({ unexpectedControl: true }),
      suppliedRefs,
      { originalUrl, includeBrandLink: false }
    )).toThrow();
  });

  it('binds community request identity to normalized target context', async () => {
    const module = await loadModule();
    const base = {
      publicationId: 'publication-1',
      sourceContentVersion: 7,
      platform: 'REDDIT',
      mode: 'COMMUNITY_DRAFT',
      promptVersion: 'distribution-community-draft-v1',
      contextHash: 'context-a'
    };
    const key = module.distributionAdaptationRequestKey(base);
    expect(key).toBe(module.distributionAdaptationRequestKey({ ...base }));
    expect(module.distributionAdaptationRequestKey({ ...base, contextHash: 'context-b' })).not.toBe(key);
  });
});
