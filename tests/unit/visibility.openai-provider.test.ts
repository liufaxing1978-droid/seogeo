import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import { OpenAIVisibilityProvider, type OpenAIVisibilityHttpRequest, type OpenAIVisibilityHttpResponse, type OpenAIVisibilityTransport } from '../../src/modules/visibility/providers/openai.provider.js';

class FixtureTransport implements OpenAIVisibilityTransport {
  calls: OpenAIVisibilityHttpRequest[] = [];
  constructor(private readonly response: OpenAIVisibilityHttpResponse) {}
  async send(request: OpenAIVisibilityHttpRequest) { this.calls.push(request); return this.response; }
}

const request: VisibilitySampleRequest = { prompt: 'Which websites explain Chinese folk religious traditions well?', model: 'gpt-5.4-mini', locale: 'en-US', country: 'US', groundingMode: 'WEB_SEARCH', providerOptions: { searchContextSize: 'medium' } };
function successBody() { return { id: 'resp_fixture_123', object: 'response', status: 'completed', output: [
  { type: 'web_search_call', id: 'ws_fixture_1', status: 'completed', action: { type: 'search', queries: ['hidden search query must not persist'], sources: [{ type: 'url', url: 'https://xingshantang.org/article' }, { type: 'url', url: 'https://example.org/reference' }] } },
  { type: 'reasoning', id: 'reasoning_fixture', summary: [{ type: 'summary_text', text: 'must not persist' }] },
  { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Xingshantang is one source. Another reference is also useful.', annotations: [
    { type: 'url_citation', url: 'https://xingshantang.org/article', title: 'Xingshantang Article', start_index: 0, end_index: 29 },
    { type: 'url_citation', url: 'https://example.org/reference', title: 'Reference', start_index: 30, end_index: 61 },
    { type: 'url_citation', url: 'https://xingshantang.org/article', title: 'Duplicate citation', start_index: 0, end_index: 29 }
  ] }] }
], usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 20 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 160 } }; }

describe('P6-A OpenAI web-grounded visibility adapter', () => {
  it('builds a Responses API web_search request and normalizes native URL citations', async () => {
    const transport = new FixtureTransport({ status: 200, body: successBody(), latencyMs: 42 });
    const adapter = new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport });
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(true);
    const result = await adapter.sample(request);
    expect(transport.calls).toHaveLength(1);
    expect(result).toEqual({
      status: 'COMPLETED', providerResponseId: 'resp_fixture_123', answerText: 'Xingshantang is one source. Another reference is also useful.',
      citations: [
        { url: 'https://xingshantang.org/article', title: 'Xingshantang Article', position: null, sourceType: 'url_citation' },
        { url: 'https://example.org/reference', title: 'Reference', position: null, sourceType: 'url_citation' }
      ],
      citationEvidenceState: 'KNOWN_PRESENT',
      searchMetadata: { webSearchCalls: [{ id: 'ws_fixture_1', status: 'completed', sourceUrls: ['https://xingshantang.org/article', 'https://example.org/reference'] }] },
      promptTokens: 120, completionTokens: 40, totalTokens: 160, searchUnits: 1, costMicros: null, costCurrency: null, pricingVersion: null, latencyMs: 42
    });
    expect(JSON.stringify(result)).not.toMatch(/hidden search query|reasoning_fixture|must not persist|reasoning_tokens/i);
  });

  it('marks explicit completed search with no native sources as KNOWN_EMPTY', async () => {
    const body = successBody();
    body.output = [
      { type: 'web_search_call', id: 'ws_empty', status: 'completed', action: { type: 'search', queries: [], sources: [] } },
      { type: 'message', id: 'msg_empty', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'No cited sources.', annotations: [] }] }
    ];
    await expect(new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body, latencyMs: 2 }) }).sample(request)).resolves.toMatchObject({ citationEvidenceState: 'KNOWN_EMPTY' });
  });

  it('normalizes refusal and incomplete states as UNKNOWN citation evidence', async () => {
    const refusal = new FixtureTransport({ status: 200, latencyMs: 11, body: { id: 'resp_refusal', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'Unable to answer.' }] }], usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } } });
    await expect(new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport: refusal }).sample(request)).resolves.toMatchObject({ status: 'REFUSED', citationEvidenceState: 'UNKNOWN' });
    const incomplete = new FixtureTransport({ status: 200, latencyMs: 8, body: { id: 'resp_incomplete', status: 'incomplete', output: [], usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 } } });
    await expect(new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport: incomplete }).sample(request)).resolves.toMatchObject({ status: 'INCOMPLETE', citationEvidenceState: 'UNKNOWN' });
  });

  it.each([[401, 'VISIBILITY_PROVIDER_AUTH_FAILED'], [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'], [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'], [500, 'VISIBILITY_PROVIDER_FAILED']])('maps HTTP %s to stable safe error %s', async (status, code) => {
    const adapter = new OpenAIVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status, latencyMs: 5, body: { error: { message: 'Authorization: Bearer SUPERSECRET raw provider body' } } }) });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code, httpStatus: status });
  });

  it('fails before network when no server-side API key is configured', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 1, body: successBody() });
    await expect(new OpenAIVisibilityProvider({ apiKey: '', transport }).sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });
});
