import { describe, expect, it } from 'vitest';
import { createDefaultVisibilityProviderRegistry } from '../../src/modules/visibility/providers/default-registry.js';

describe('P6-A default visibility provider registry', () => {
  it('registers all official API adapters plus explicit DeepSeek unsupported adapter', () => {
    const registry = createDefaultVisibilityProviderRegistry({
      openAiApiKey: 'openai-fixture',
      geminiApiKey: 'gemini-fixture',
      perplexityApiKey: 'perplexity-fixture',
      anthropicApiKey: 'anthropic-fixture'
    });

    expect(registry.list().map((adapter) => adapter.provider)).toEqual([
      'OPENAI',
      'GEMINI',
      'PERPLEXITY',
      'ANTHROPIC',
      'DEEPSEEK'
    ]);
    expect(registry.get('OPENAI', 'gpt-5.4-mini', 'API').provider).toBe('OPENAI');
    expect(registry.get('GEMINI', 'gemini-3.6-flash', 'API').provider).toBe('GEMINI');
    expect(registry.get('PERPLEXITY', 'sonar-pro', 'API').provider).toBe('PERPLEXITY');
    expect(registry.get('ANTHROPIC', 'claude-sonnet-4-20250514', 'API').provider).toBe('ANTHROPIC');
    expect(registry.get('DEEPSEEK', 'deepseek-v4-flash', 'API').provider).toBe('DEEPSEEK');
  });
});
