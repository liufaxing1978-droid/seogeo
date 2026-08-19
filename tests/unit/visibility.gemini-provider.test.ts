import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import { GeminiVisibilityProvider, type GeminiVisibilityHttpRequest, type GeminiVisibilityHttpResponse, type GeminiVisibilityTransport } from '../../src/modules/visibility/providers/gemini.provider.js';

class FixtureTransport implements GeminiVisibilityTransport {
  calls: GeminiVisibilityHttpRequest[] = [];
  constructor(private readonly response: GeminiVisibilityHttpResponse) {}
  async send(request: GeminiVisibilityHttpRequest) { this.calls.push(request); return this.response; }
}
const request: VisibilitySampleRequest = { prompt: 'Which websites explain Chinese folk religious traditions well?', model: 'gemini-3.6-flash', locale: 'en-US', country: 'US', groundingMode: 'SEARCH_GROUNDING', providerOptions: {} };
function successBody() { return { id: 'int_fixture_123', status: 'completed', steps: [
  { type: 'thought', content: 'private thought must not persist' },
  { type: 'google_search_call', id: 'search_call_1', arguments: { queries: ['hidden query'] } },
  { type: 'google_search_result', call_id: 'search_call_1', result: [{ title: 'Xingshantang', url: 'https://xingshantang.org/article' }, { title: 'Reference', url: 'https://example.org/reference' }] },
  { type: 'model_output', content: [{ type: 'text', text: 'Xingshantang is one source. Another reference is also useful.', annotations: [
    { type: 'url_citation', url: 'https://xingshantang.org/article', title: 'Xingshantang Article' },
    { type: 'url_citation', url: 'https://example.org/reference', title: 'Reference' }
  ] }] }
], usage: { total_input_tokens: 110, total_output_tokens: 35, total_tokens: 157 } }; }

describe('P6-A Gemini grounded-search visibility adapter', () => {
  it('normalizes native citations as KNOWN_PRESENT', async () => {
    const result = await new GeminiVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body: successBody(), latencyMs: 37 }) }).sample(request);
    expect(result).toMatchObject({
      status: 'COMPLETED',
      providerResponseId: 'int_fixture_123',
      citationEvidenceState: 'KNOWN_PRESENT',
      citations: [
        { url: 'https://xingshantang.org/article', title: 'Xingshantang Article' },
        { url: 'https://example.org/reference', title: 'Reference' }
      ],
      searchUnits: 1
    });
    expect(JSON.stringify(result)).not.toMatch(/private thought|hidden query/i);
  });

  it('marks an explicit empty google_search_result as KNOWN_EMPTY', async () => {
    const body = { id: 'int_empty', status: 'completed', steps: [
      { type: 'google_search_call', id: 'call_empty' },
      { type: 'google_search_result', call_id: 'call_empty', result: [] },
      { type: 'model_output', content: [{ type: 'text', text: 'No cited sources.', annotations: [] }] }
    ], usage: { total_input_tokens: 10, total_output_tokens: 4, total_tokens: 14 } };
    await expect(new GeminiVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body, latencyMs: 4 }) }).sample(request)).resolves.toMatchObject({ citationEvidenceState: 'KNOWN_EMPTY' });
  });

  it('keeps incomplete evidence UNKNOWN', async () => {
    const body = { id: 'int_incomplete', status: 'incomplete', steps: [], usage: { total_input_tokens: 10, total_output_tokens: 0, total_tokens: 10 } };
    await expect(new GeminiVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body, latencyMs: 9 }) }).sample(request)).resolves.toMatchObject({ status: 'INCOMPLETE', citationEvidenceState: 'UNKNOWN' });
  });

  it.each([[401, 'VISIBILITY_PROVIDER_AUTH_FAILED'], [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'], [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'], [500, 'VISIBILITY_PROVIDER_FAILED']])('maps HTTP %s to stable safe error %s', async (status, code) => {
    await expect(new GeminiVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status, latencyMs: 4, body: { error: { message: 'secret' } } }) }).sample(request)).rejects.toMatchObject({ code, httpStatus: status });
  });

  it('fails before network when no API key is configured', async () => {
    const transport = new FixtureTransport({ status: 200, body: successBody(), latencyMs: 1 });
    await expect(new GeminiVisibilityProvider({ apiKey: '', transport }).sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });
});
