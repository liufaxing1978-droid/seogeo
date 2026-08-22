import { describe, expect, it } from 'vitest';
import { AnthropicVisibilityProvider } from '../../src/modules/visibility/providers/anthropic.provider.js';
import { DeepSeekVisibilityProvider } from '../../src/modules/visibility/providers/deepseek.provider.js';
import { GeminiVisibilityProvider } from '../../src/modules/visibility/providers/gemini.provider.js';
import { MicrosoftVisibilityProvider } from '../../src/modules/visibility/providers/microsoft.provider.js';
import { OpenAIVisibilityProvider } from '../../src/modules/visibility/providers/openai.provider.js';
import { PerplexityVisibilityProvider } from '../../src/modules/visibility/providers/perplexity.provider.js';

describe('P9-0E visibility provider capability contract', () => {
  it('declares exact server-authored capabilities for existing adapters', () => {
    const adapters = [
      new OpenAIVisibilityProvider({ apiKey: 'fixture' }),
      new GeminiVisibilityProvider({ apiKey: 'fixture' }),
      new PerplexityVisibilityProvider({ apiKey: 'fixture' }),
      new AnthropicVisibilityProvider({ apiKey: 'fixture' }),
      new DeepSeekVisibilityProvider(),
      new MicrosoftVisibilityProvider({ accessToken: 'fixture' })
    ];

    expect(adapters.map((adapter) => [adapter.provider, adapter.capabilities])).toEqual([
      ['OPENAI', ['WEB_GROUNDED', 'CITATION_NATIVE']],
      ['GEMINI', ['WEB_GROUNDED', 'CITATION_NATIVE']],
      ['PERPLEXITY', ['WEB_GROUNDED', 'CITATION_NATIVE']],
      ['ANTHROPIC', ['WEB_GROUNDED', 'CITATION_NATIVE']],
      ['DEEPSEEK', ['MODEL_ONLY']],
      ['MICROSOFT', ['WEB_GROUNDED', 'CITATION_NATIVE']]
    ]);
  });

  it('does not claim consumer observation capability for API adapters', () => {
    const adapters = [
      new OpenAIVisibilityProvider({ apiKey: 'fixture' }),
      new GeminiVisibilityProvider({ apiKey: 'fixture' }),
      new PerplexityVisibilityProvider({ apiKey: 'fixture' }),
      new AnthropicVisibilityProvider({ apiKey: 'fixture' }),
      new DeepSeekVisibilityProvider(),
      new MicrosoftVisibilityProvider({ accessToken: 'fixture' })
    ];

    for (const adapter of adapters) {
      expect(adapter.capabilities).not.toContain('CONSUMER_OBSERVATION');
    }
  });
});
