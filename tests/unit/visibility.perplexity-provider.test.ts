import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import {
  PerplexityVisibilityProvider,
  type PerplexityVisibilityHttpRequest,
  type PerplexityVisibilityHttpResponse,
  type PerplexityVisibilityTransport
} from '../../src/modules/visibility/providers/perplexity.provider.js';

class FixtureTransport implements PerplexityVisibilityTransport {
  calls: PerplexityVisibilityHttpRequest[] = [];

  constructor(private readonly response: PerplexityVisibilityHttpResponse) {}

  async send(request: PerplexityVisibilityHttpRequest) {
    this.calls.push(request);
    return this.response;
  }
}

const request: VisibilitySampleRequest = {
  prompt: 'Which websites explain Chinese folk religious traditions well?',
  model: 'sonar-pro',
  locale: 'en-US',
  country: 'US',
  groundingMode: 'SONAR',
  providerOptions: {
    searchDomainFilter: ['xingshantang.org', 'example.org'],
    searchRecencyFilter: 'month'
  }
};

function successBody() {
  return {
    id: 'sonar_fixture_123',
    model: 'sonar-pro',
    created: 1787100000,
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: 'Xingshantang is one source.[1] Another reference is also useful.[2]'
        }
      }
    ],
    usage: {
      prompt_tokens: 26,
      completion_tokens: 832,
      total_tokens: 858,
      search_context_size: 'low',
      num_search_queries: 2,
      reasoning_tokens: 999,
      citation_tokens: 111,
      cost: {
        input_tokens_cost: 0.000078,
        output_tokens_cost: 0.01248,
        request_cost: 0.006,
        reasoning_tokens_cost: 0.123,
        total_cost: 0.018558
      }
    },
    citations: [
      'https://xingshantang.org/article',
      'https://example.org/reference',
      'https://xingshantang.org/article'
    ],
    search_results: [
      {
        title: 'Xingshantang Article',
        url: 'https://xingshantang.org/article',
        date: '2026-08-18',
        last_updated: '2026-08-19',
        snippet: 'hidden source snippet must not persist',
        source: 'web'
      },
      {
        title: 'Reference',
        url: 'https://example.org/reference',
        date: '2026-08-17',
        last_updated: '2026-08-18',
        snippet: 'another hidden source snippet',
        source: 'web'
      }
    ],
    reasoning_steps: [
      { thought: 'private reasoning must not persist', type: 'web_search', web_search: { search_keywords: ['hidden query'] } }
    ]
  };
}

describe('P6-A Perplexity Sonar visibility adapter', () => {
  it('builds the Sonar request and normalizes provider-native citations, results, usage and reported USD cost', async () => {
    const transport = new FixtureTransport({ status: 200, body: successBody(), latencyMs: 31 });
    const adapter = new PerplexityVisibilityProvider({ apiKey: 'fixture-key', transport });

    expect(adapter.provider).toBe('PERPLEXITY');
    expect(adapter.channel).toBe('API');
    expect(adapter.supportsWebGrounding('SONAR')).toBe(true);
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(false);
    expect(adapter.estimateCostMicros(request)).toBeNull();

    const result = await adapter.sample(request);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      url: 'https://api.perplexity.ai/v1/sonar',
      method: 'POST',
      headers: {
        Authorization: 'Bearer fixture-key',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'sonar-pro',
        messages: [{ role: 'user', content: request.prompt }],
        search_domain_filter: ['xingshantang.org', 'example.org'],
        search_recency_filter: 'month'
      }
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      providerResponseId: 'sonar_fixture_123',
      answerText: 'Xingshantang is one source.[1] Another reference is also useful.[2]',
      citations: [
        { url: 'https://xingshantang.org/article', title: 'Xingshantang Article', position: 1, sourceType: 'citation' },
        { url: 'https://example.org/reference', title: 'Reference', position: 2, sourceType: 'citation' }
      ],
      searchMetadata: {
        searchResults: [
          { title: 'Xingshantang Article', url: 'https://xingshantang.org/article', date: '2026-08-18', lastUpdated: '2026-08-19', source: 'web' },
          { title: 'Reference', url: 'https://example.org/reference', date: '2026-08-17', lastUpdated: '2026-08-18', source: 'web' }
        ]
      },
      promptTokens: 26,
      completionTokens: 832,
      totalTokens: 858,
      searchUnits: 2,
      costMicros: 18_558,
      costCurrency: 'USD',
      pricingVersion: 'perplexity-reported-cost-v1',
      latencyMs: 31
    });
    expect(JSON.stringify(result)).not.toMatch(/reasoning_tokens|citation_tokens|private reasoning|hidden query|hidden source snippet|reasoning_steps/i);
  });

  it('returns INCOMPLETE when the response has no usable assistant answer', async () => {
    const transport = new FixtureTransport({
      status: 200,
      latencyMs: 7,
      body: {
        id: 'sonar_incomplete',
        model: 'sonar-pro',
        object: 'chat.completion',
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10, cost: { total_cost: 0.006 } },
        citations: [],
        search_results: []
      }
    });

    await expect(new PerplexityVisibilityProvider({ apiKey: 'fixture-key', transport }).sample(request)).resolves.toMatchObject({
      status: 'INCOMPLETE',
      providerResponseId: 'sonar_incomplete',
      answerText: null,
      costMicros: 6000,
      costCurrency: 'USD'
    });
  });

  it.each([
    [401, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'],
    [500, 'VISIBILITY_PROVIDER_FAILED']
  ])('maps HTTP %s to stable safe error %s', async (status, code) => {
    const transport = new FixtureTransport({
      status,
      latencyMs: 4,
      body: { error: { message: 'Authorization: Bearer SUPERSECRET raw provider body' } }
    });
    const adapter = new PerplexityVisibilityProvider({ apiKey: 'fixture-key', transport });

    await expect(adapter.sample(request)).rejects.toMatchObject({ code, httpStatus: status });
    await expect(adapter.sample(request)).rejects.not.toThrow(/SUPERSECRET|raw provider body/);
  });

  it('fails closed on malformed successful response data', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 3, body: { unexpected: true } });
    await expect(new PerplexityVisibilityProvider({ apiKey: 'fixture-key', transport }).sample(request)).rejects.toMatchObject({
      code: 'VISIBILITY_PROVIDER_MALFORMED_RESPONSE'
    });
  });

  it('fails before network when no server-side Perplexity API key is configured', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 1, body: successBody() });
    const adapter = new PerplexityVisibilityProvider({ apiKey: '', transport });

    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });
});
