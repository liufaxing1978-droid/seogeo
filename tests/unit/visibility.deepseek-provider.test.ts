import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import { DeepSeekVisibilityProvider } from '../../src/modules/visibility/providers/deepseek.provider.js';

const request: VisibilitySampleRequest = {
  prompt: 'Which websites explain Chinese folk religious traditions well?',
  model: 'deepseek-v4-flash',
  locale: 'en-US',
  country: 'US',
  groundingMode: 'UNSUPPORTED_WEB_GROUNDING',
  providerOptions: {}
};

describe('P6-A DeepSeek visibility adapter', () => {
  it('is an explicit zero-network unsupported web-grounding adapter', async () => {
    const adapter = new DeepSeekVisibilityProvider();

    expect(adapter.provider).toBe('DEEPSEEK');
    expect(adapter.channel).toBe('API');
    expect(adapter.supportsWebGrounding('UNSUPPORTED_WEB_GROUNDING')).toBe(false);
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(false);
    expect(adapter.estimateCostMicros(request)).toBeNull();
    await expect(adapter.sample(request)).resolves.toEqual({
      status: 'UNSUPPORTED',
      providerResponseId: null,
      answerText: null,
      citations: [],
      searchMetadata: {},
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      searchUnits: null,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: null
    });
  });
});
