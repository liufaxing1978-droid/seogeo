import { describe, expect, it } from 'vitest';
import type {
  VisibilityProviderAdapter,
  VisibilitySampleRequest,
  VisibilitySampleResponse
} from '../../src/modules/visibility/providers/provider.js';
import { VisibilityProviderError } from '../../src/modules/visibility/providers/provider.js';
import { VisibilityProviderRegistry } from '../../src/modules/visibility/providers/provider-registry.js';

class FixtureOpenAiAdapter implements VisibilityProviderAdapter {
  readonly provider = 'OPENAI' as const;
  readonly channel = 'API' as const;
  supportsWebGrounding(mode: VisibilitySampleRequest['groundingMode']) { return mode === 'WEB_SEARCH'; }
  estimateCostMicros(_request: VisibilitySampleRequest) { return 1200; }
  async sample(_request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    return {
      status: 'COMPLETED',
      providerResponseId: 'fixture-response',
      answerText: 'Fixture answer',
      citations: [],
      citationEvidenceState: 'UNKNOWN',
      searchMetadata: {},
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      searchUnits: 1,
      costMicros: 1200,
      costCurrency: 'USD',
      pricingVersion: 'fixture-1',
      latencyMs: 15
    };
  }
}

class FixtureUnsupportedDeepSeekAdapter implements VisibilityProviderAdapter {
  readonly provider = 'DEEPSEEK' as const;
  readonly channel = 'API' as const;
  supportsWebGrounding(_mode: VisibilitySampleRequest['groundingMode']) { return false; }
  estimateCostMicros(_request: VisibilitySampleRequest) { return null; }
  async sample(_request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    return {
      status: 'UNSUPPORTED',
      providerResponseId: null,
      answerText: null,
      citations: [],
      citationEvidenceState: 'NOT_APPLICABLE',
      searchMetadata: {},
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      searchUnits: null,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: null
    };
  }
}

describe('P6-A visibility provider contract and registry', () => {
  it('returns the registered API adapter for a provider/model request', () => {
    const adapter = new FixtureOpenAiAdapter();
    const registry = new VisibilityProviderRegistry([adapter]);
    expect(registry.get('OPENAI', 'gpt-5-mini', 'API')).toBe(adapter);
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(true);
    expect(adapter.supportsWebGrounding('SONAR')).toBe(false);
  });

  it('rejects duplicate provider/channel adapters at construction time', () => {
    expect(() => new VisibilityProviderRegistry([new FixtureOpenAiAdapter(), new FixtureOpenAiAdapter()]))
      .toThrowError(expect.objectContaining({ code: 'VISIBILITY_PROVIDER_DUPLICATE_ADAPTER' }));
  });

  it('fails closed for an unregistered provider without leaking request details', () => {
    const registry = new VisibilityProviderRegistry([]);
    expect(() => registry.get('OPENAI', 'gpt-5-mini', 'API')).toThrowError(expect.objectContaining({ code: 'VISIBILITY_PROVIDER_UNAVAILABLE' }));
  });

  it('supports an explicit zero-network unsupported grounding adapter', async () => {
    const adapter = new FixtureUnsupportedDeepSeekAdapter();
    const registry = new VisibilityProviderRegistry([adapter]);
    const request: VisibilitySampleRequest = { prompt: 'Which sites explain Chinese folk religion?', model: 'deepseek-chat', locale: 'en-US', country: 'US', groundingMode: 'UNSUPPORTED_WEB_GROUNDING', providerOptions: {} };
    expect(registry.get('DEEPSEEK', request.model, 'API')).toBe(adapter);
    expect(adapter.supportsWebGrounding(request.groundingMode)).toBe(false);
    await expect(adapter.sample(request)).resolves.toMatchObject({ status: 'UNSUPPORTED', citationEvidenceState: 'NOT_APPLICABLE' });
  });

  it('exposes stable provider error codes with bounded safe messages', () => {
    const error = new VisibilityProviderError('VISIBILITY_PROVIDER_RATE_LIMITED', 'Provider rate limit reached', { httpStatus: 429, retryable: false });
    expect(error).toMatchObject({ code: 'VISIBILITY_PROVIDER_RATE_LIMITED', httpStatus: 429, retryable: false });
    expect(error.message).not.toContain('Authorization');
    expect(error.message).not.toContain('api_key');
  });
});
