import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import {
  GeminiVisibilityProvider,
  type GeminiVisibilityHttpRequest,
  type GeminiVisibilityHttpResponse,
  type GeminiVisibilityTransport
} from '../../src/modules/visibility/providers/gemini.provider.js';

class FixtureTransport implements GeminiVisibilityTransport {
  calls: GeminiVisibilityHttpRequest[] = [];

  constructor(private readonly response: GeminiVisibilityHttpResponse) {}

  async send(request: GeminiVisibilityHttpRequest) {
    this.calls.push(request);
    return this.response;
  }
}

const request: VisibilitySampleRequest = {
  prompt: 'Which websites explain Chinese folk religious traditions well?',
  model: 'gemini-3.6-flash',
  locale: 'en-US',
  country: 'US',
  groundingMode: 'SEARCH_GROUNDING',
  providerOptions: {}
};

function successBody() {
  return {
    id: 'int_fixture_123',
    object: 'interaction',
    model: 'gemini-3.6-flash',
    status: 'completed',
    steps: [
      {
        type: 'thought',
        signature: 'thought-signature-must-not-persist',
        content: 'private thought must not persist'
      },
      {
        type: 'google_search_call',
        id: 'search_call_1',
        arguments: { queries: ['hidden Gemini search query'] },
        signature: 'search-signature-must-not-persist'
      },
      {
        type: 'google_search_result',
        call_id: 'search_call_1',
        result: [
          { title: 'Xingshantang', url: 'https://xingshantang.org/article', snippet: 'hidden snippet' },
          { title: 'Reference', url: 'https://example.org/reference', snippet: 'another hidden snippet' },
          { title: 'Duplicate', url: 'https://xingshantang.org/article', snippet: 'duplicate hidden snippet' }
        ]
      },
      {
        type: 'model_output',
        content: [
          {
            type: 'text',
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
      total_input_tokens: 110,
      total_output_tokens: 35,
      total_thought_tokens: 12,
      total_tokens: 157,
      grounding_tool_count: [{ tool: 'google_search', count: 1 }]
    }
  };
}

describe('P6-A Gemini grounded-search visibility adapter', () => {
  it('builds the Interactions API google_search request and normalizes native citations', async () => {
    const transport = new FixtureTransport({ status: 200, body: successBody(), latencyMs: 37 });
    const adapter = new GeminiVisibilityProvider({ apiKey: 'fixture-key', transport });

    expect(adapter.provider).toBe('GEMINI');
    expect(adapter.channel).toBe('API');
    expect(adapter.supportsWebGrounding('SEARCH_GROUNDING')).toBe(true);
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(false);
    expect(adapter.estimateCostMicros(request)).toBeNull();

    const result = await adapter.sample(request);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      url: 'https://generativelanguage.googleapis.com/v1beta/interactions',
      method: 'POST',
      headers: {
        'x-goog-api-key': 'fixture-key',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'gemini-3.6-flash',
        input: request.prompt,
        tools: [{ type: 'google_search' }]
      }
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      providerResponseId: 'int_fixture_123',
      answerText: 'Xingshantang is one source. Another reference is also useful.',
      citations: [
        { url: 'https://xingshantang.org/article', title: 'Xingshantang Article', position: null, sourceType: 'url_citation' },
        { url: 'https://example.org/reference', title: 'Reference', position: null, sourceType: 'url_citation' }
      ],
      searchMetadata: {
        googleSearchResults: [
          {
            callId: 'search_call_1',
            sourceUrls: ['https://xingshantang.org/article', 'https://example.org/reference']
          }
        ]
      },
      promptTokens: 110,
      completionTokens: 35,
      totalTokens: 157,
      searchUnits: 1,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: 37
    });
    expect(JSON.stringify(result)).not.toMatch(/hidden Gemini search query|private thought|thought-signature|search-signature|hidden snippet|total_thought_tokens/i);
  });

  it('normalizes an incomplete interaction without inventing an answer', async () => {
    const transport = new FixtureTransport({
      status: 200,
      latencyMs: 9,
      body: {
        id: 'int_incomplete',
        status: 'incomplete',
        steps: [],
        usage: { total_input_tokens: 10, total_output_tokens: 0, total_tokens: 10 }
      }
    });

    await expect(new GeminiVisibilityProvider({ apiKey: 'fixture-key', transport }).sample(request)).resolves.toMatchObject({
      status: 'INCOMPLETE',
      providerResponseId: 'int_incomplete',
      answerText: null,
      promptTokens: 10,
      completionTokens: 0,
      totalTokens: 10
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
      body: { error: { message: 'x-goog-api-key: SUPERSECRET raw provider body' } }
    });
    const adapter = new GeminiVisibilityProvider({ apiKey: 'fixture-key', transport });

    await expect(adapter.sample(request)).rejects.toMatchObject({ code, httpStatus: status });
    await expect(adapter.sample(request)).rejects.not.toThrow(/SUPERSECRET|raw provider body/);
  });

  it('fails closed on malformed successful interaction data', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 3, body: { unexpected: true } });
    await expect(new GeminiVisibilityProvider({ apiKey: 'fixture-key', transport }).sample(request)).rejects.toMatchObject({
      code: 'VISIBILITY_PROVIDER_MALFORMED_RESPONSE'
    });
  });

  it('fails before network when no server-side Gemini API key is configured', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 1, body: successBody() });
    const adapter = new GeminiVisibilityProvider({ apiKey: '', transport });

    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });
});
