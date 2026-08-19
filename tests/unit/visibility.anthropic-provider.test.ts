import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import {
  AnthropicVisibilityProvider,
  type AnthropicVisibilityHttpRequest,
  type AnthropicVisibilityHttpResponse,
  type AnthropicVisibilityTransport
} from '../../src/modules/visibility/providers/anthropic.provider.js';

class FixtureTransport implements AnthropicVisibilityTransport {
  calls: AnthropicVisibilityHttpRequest[] = [];

  constructor(private readonly response: AnthropicVisibilityHttpResponse) {}

  async send(request: AnthropicVisibilityHttpRequest) {
    this.calls.push(request);
    return this.response;
  }
}

const request: VisibilitySampleRequest = {
  prompt: 'Which websites explain Chinese folk religious traditions well?',
  model: 'claude-sonnet-4-20250514',
  locale: 'en-US',
  country: 'US',
  groundingMode: 'WEB_SEARCH_TOOL',
  providerOptions: { maxUses: 3 }
};

function successBody() {
  return {
    id: 'msg_fixture_123',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    content: [
      {
        type: 'server_tool_use',
        id: 'srvtoolu_1',
        name: 'web_search',
        input: { query: 'hidden Anthropic search query' }
      },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: [
          {
            type: 'web_search_result',
            url: 'https://xingshantang.org/article',
            title: 'Xingshantang Article',
            page_age: '1 day ago',
            encrypted_content: 'encrypted hidden source content'
          },
          {
            type: 'web_search_result',
            url: 'https://example.org/reference',
            title: 'Reference',
            page_age: '2 days ago',
            encrypted_content: 'another encrypted hidden source content'
          }
        ]
      },
      {
        type: 'thinking',
        thinking: 'private Anthropic reasoning must not persist',
        signature: 'thinking-signature-must-not-persist'
      },
      {
        type: 'text',
        text: 'Xingshantang is one source. Another reference is also useful.',
        citations: [
          {
            type: 'web_search_result_location',
            url: 'https://xingshantang.org/article',
            title: 'Xingshantang Article',
            cited_text: 'hidden cited source passage',
            encrypted_index: 'encrypted-index-1'
          },
          {
            type: 'web_search_result_location',
            url: 'https://example.org/reference',
            title: 'Reference',
            cited_text: 'another hidden cited source passage',
            encrypted_index: 'encrypted-index-2'
          },
          {
            type: 'web_search_result_location',
            url: 'https://xingshantang.org/article',
            title: 'Duplicate citation',
            cited_text: 'duplicate hidden passage',
            encrypted_index: 'encrypted-index-3'
          }
        ]
      }
    ],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 105,
      output_tokens: 6039,
      cache_read_input_tokens: 7123,
      cache_creation_input_tokens: 7345,
      server_tool_use: { web_search_requests: 1 }
    }
  };
}

describe('P6-A Anthropic web-search visibility adapter', () => {
  it('builds Messages API server web-search request and normalizes native web citations', async () => {
    const transport = new FixtureTransport({ status: 200, body: successBody(), latencyMs: 44 });
    const adapter = new AnthropicVisibilityProvider({ apiKey: 'fixture-key', transport });

    expect(adapter.provider).toBe('ANTHROPIC');
    expect(adapter.channel).toBe('API');
    expect(adapter.supportsWebGrounding('WEB_SEARCH_TOOL')).toBe(true);
    expect(adapter.supportsWebGrounding('SONAR')).toBe(false);
    expect(adapter.estimateCostMicros(request)).toBeNull();

    const result = await adapter.sample(request);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': 'fixture-key',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: request.prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
      }
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      providerResponseId: 'msg_fixture_123',
      answerText: 'Xingshantang is one source. Another reference is also useful.',
      citations: [
        { url: 'https://xingshantang.org/article', title: 'Xingshantang Article', position: 1, sourceType: 'web_search_result_location' },
        { url: 'https://example.org/reference', title: 'Reference', position: 2, sourceType: 'web_search_result_location' }
      ],
      searchMetadata: {
        webSearchResults: [
          { toolUseId: 'srvtoolu_1', sourceUrls: ['https://xingshantang.org/article', 'https://example.org/reference'] }
        ]
      },
      promptTokens: 105,
      completionTokens: 6039,
      totalTokens: 6144,
      searchUnits: 1,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: 44
    });
    expect(JSON.stringify(result)).not.toMatch(/hidden Anthropic search query|private Anthropic reasoning|thinking-signature|encrypted hidden|hidden cited source passage|encrypted-index|cache_read_input_tokens/i);
  });

  it.each([
    ['pause_turn', 'INCOMPLETE'],
    ['max_tokens', 'INCOMPLETE'],
    ['refusal', 'REFUSED']
  ])('maps stop_reason %s to %s without an automatic second paid request', async (stopReason, status) => {
    const transport = new FixtureTransport({
      status: 200,
      latencyMs: 8,
      body: {
        id: `msg_${stopReason}`,
        type: 'message',
        role: 'assistant',
        content: [],
        stop_reason: stopReason,
        usage: { input_tokens: 10, output_tokens: 2, server_tool_use: { web_search_requests: 1 } }
      }
    });
    const adapter = new AnthropicVisibilityProvider({ apiKey: 'fixture-key', transport });

    await expect(adapter.sample(request)).resolves.toMatchObject({
      status,
      providerResponseId: `msg_${stopReason}`,
      answerText: null,
      searchUnits: 1
    });
    expect(transport.calls).toHaveLength(1);
  });

  it.each([
    [401, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'],
    [500, 'VISIBILITY_PROVIDER_FAILED']
  ])('maps HTTP %s to stable safe error %s', async (httpStatus, code) => {
    const transport = new FixtureTransport({
      status: httpStatus,
      latencyMs: 4,
      body: { error: { message: 'x-api-key: SUPERSECRET raw provider body' } }
    });
    const adapter = new AnthropicVisibilityProvider({ apiKey: 'fixture-key', transport });

    await expect(adapter.sample(request)).rejects.toMatchObject({ code, httpStatus });
    await expect(adapter.sample(request)).rejects.not.toThrow(/SUPERSECRET|raw provider body/);
  });

  it('fails closed on malformed successful response data', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 3, body: { unexpected: true } });
    await expect(new AnthropicVisibilityProvider({ apiKey: 'fixture-key', transport }).sample(request)).rejects.toMatchObject({
      code: 'VISIBILITY_PROVIDER_MALFORMED_RESPONSE'
    });
  });

  it('fails before network when no server-side Anthropic API key is configured', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 1, body: successBody() });
    const adapter = new AnthropicVisibilityProvider({ apiKey: '', transport });

    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });
});
