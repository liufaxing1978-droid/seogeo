import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import {
  OpenAIVisibilityProvider,
  type OpenAIVisibilityHttpRequest,
  type OpenAIVisibilityHttpResponse,
  type OpenAIVisibilityTransport
} from '../../src/modules/visibility/providers/openai.provider.js';

class FixtureTransport implements OpenAIVisibilityTransport {
  calls: OpenAIVisibilityHttpRequest[] = [];

  constructor(private readonly response: OpenAIVisibilityHttpResponse) {}

  async send(request: OpenAIVisibilityHttpRequest) {
    this.calls.push(request);
    return this.response;
  }
}

const request: VisibilitySampleRequest = {
  prompt: 'Which websites explain Chinese folk religious traditions well?',
  model: 'gpt-5.4-mini',
  locale: 'en-US',
  country: 'US',
  groundingMode: 'WEB_SEARCH',
  providerOptions: { searchContextSize: 'medium' }
};

function successBody() {
  return {
    id: 'resp_fixture_123',
    object: 'response',
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        id: 'ws_fixture_1',
        status: 'completed',
        action: {
          type: 'search',
          queries: ['hidden search query must not persist'],
          sources: [
            { type: 'url', url: 'https://xingshantang.org/article' },
            { type: 'url', url: 'https://example.org/reference' }
          ]
        }
      },
      {
        type: 'reasoning',
        id: 'reasoning_fixture',
        summary: [{ type: 'summary_text', text: 'must not persist' }]
      },
      {
        type: 'message',
        id: 'msg_fixture',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: 'Xingshantang is one source. Another reference is also useful.',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://xingshantang.org/article',
                title: 'Xingshantang Article',
                start_index: 0,
                end_index: 29
              },
              {
                type: 'url_citation',
                url: 'https://example.org/reference',
                title: 'Reference',
                start_index: 30,
                end_index: 61
              },
              {
                type: 'url_citation',
                url: 'https://xingshantang.org/article',
                title: 'Duplicate citation',
                start_index: 0,
                end_index: 29
              }
            ]
          }
        ]
      }
    ],
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 40,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 160
    }
  };
}

describe('P6-A OpenAI web-grounded visibility adapter', () => {
  it('builds a Responses API web_search request and normalizes native URL citations', async () => {
    const transport = new FixtureTransport({ status: 200, body: successBody(), latencyMs: 42 });
    const adapter = new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport });

    expect(adapter.provider).toBe('OPENAI');
    expect(adapter.channel).toBe('API');
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(true);
    expect(adapter.supportsWebGrounding('SONAR')).toBe(false);
    expect(adapter.estimateCostMicros(request)).toBeNull();

    const result = await adapter.sample(request);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({
      url: 'https://api.openai.com/v1/responses',
      method: 'POST',
      headers: {
        Authorization: 'Bearer fixture-key',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'gpt-5.4-mini',
        input: request.prompt,
        store: false,
        tools: [
          {
            type: 'web_search',
            search_context_size: 'medium',
            user_location: { type: 'approximate', country: 'US' }
          }
        ]
      }
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      providerResponseId: 'resp_fixture_123',
      answerText: 'Xingshantang is one source. Another reference is also useful.',
      citations: [
        { url: 'https://xingshantang.org/article', title: 'Xingshantang Article', position: null, sourceType: 'url_citation' },
        { url: 'https://example.org/reference', title: 'Reference', position: null, sourceType: 'url_citation' }
      ],
      searchMetadata: {
        webSearchCalls: [
          {
            id: 'ws_fixture_1',
            status: 'completed',
            sourceUrls: ['https://xingshantang.org/article', 'https://example.org/reference']
          }
        ]
      },
      promptTokens: 120,
      completionTokens: 40,
      totalTokens: 160,
      searchUnits: 1,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: 42
    });
    expect(JSON.stringify(result)).not.toMatch(/hidden search query|reasoning_fixture|must not persist|reasoning_tokens/i);
  });

  it('normalizes a provider refusal without treating it as a completed answer', async () => {
    const transport = new FixtureTransport({
      status: 200,
      latencyMs: 11,
      body: {
        id: 'resp_refusal',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'refusal', refusal: 'Unable to answer.' }]
          }
        ],
        usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 }
      }
    });
    const result = await new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport }).sample(request);

    expect(result).toMatchObject({
      status: 'REFUSED',
      providerResponseId: 'resp_refusal',
      answerText: null,
      citations: [],
      promptTokens: 20,
      completionTokens: 5,
      totalTokens: 25,
      latencyMs: 11
    });
  });

  it('normalizes an incomplete Responses API result as INCOMPLETE', async () => {
    const transport = new FixtureTransport({
      status: 200,
      latencyMs: 8,
      body: {
        id: 'resp_incomplete',
        status: 'incomplete',
        output: [],
        usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 }
      }
    });
    await expect(new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport }).sample(request)).resolves.toMatchObject({
      status: 'INCOMPLETE',
      providerResponseId: 'resp_incomplete',
      answerText: null
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
      latencyMs: 5,
      body: { error: { message: 'Authorization: Bearer SUPERSECRET raw provider body' } }
    });
    const adapter = new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport });

    await expect(adapter.sample(request)).rejects.toMatchObject({ code, httpStatus: status });
    await expect(adapter.sample(request)).rejects.not.toThrow(/SUPERSECRET|raw provider body/);
  });

  it('fails closed on malformed successful response data', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 3, body: { unexpected: true } });
    const adapter = new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport });

    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_MALFORMED_RESPONSE' });
  });

  it('fails before network when no server-side API key is configured', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 1, body: successBody() });
    const adapter = new OpenAIVisibilityProvider({ apiKey: '', transport });

    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });
});
