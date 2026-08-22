import { describe, expect, it } from 'vitest';
import { createDefaultVisibilityProviderRegistry } from '../../src/modules/visibility/providers/default-registry.js';

describe('P9-0E default visibility provider registry', () => {
  it('registers all nine API visibility adapters with server-owned capability semantics', () => {
    const registry = createDefaultVisibilityProviderRegistry({
      openAiApiKey: 'openai-fixture',
      geminiApiKey: 'gemini-fixture',
      perplexityApiKey: 'perplexity-fixture',
      anthropicApiKey: 'anthropic-fixture',
      microsoftWorkIqAccessToken: 'microsoft-fixture'
    });

    expect(registry.list().map((adapter) => adapter.provider)).toEqual([
      'OPENAI',
      'GEMINI',
      'PERPLEXITY',
      'ANTHROPIC',
      'DEEPSEEK',
      'MICROSOFT',
      'BAIDU_QIANFAN',
      'QWEN',
      'TENCENT_HUNYUAN'
    ]);

    expect(registry.get('BAIDU_QIANFAN', 'ai-search', 'API').capabilities).toEqual([
      'WEB_GROUNDED',
      'SEARCH_API',
      'CITATION_NATIVE'
    ]);
    expect(registry.get('QWEN', 'qwen-max', 'API').capabilities).toEqual([
      'WEB_GROUNDED',
      'CITATION_NATIVE'
    ]);
    expect(registry.get('TENCENT_HUNYUAN', 'hy3', 'API').capabilities).toEqual([
      'WEB_GROUNDED',
      'CITATION_NATIVE'
    ]);

    expect(registry.list().some((adapter) => adapter.capabilities.includes('CONSUMER_OBSERVATION'))).toBe(false);
  });
});
