import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import { PerplexityVisibilityProvider, type PerplexityVisibilityHttpRequest, type PerplexityVisibilityHttpResponse, type PerplexityVisibilityTransport } from '../../src/modules/visibility/providers/perplexity.provider.js';

class FixtureTransport implements PerplexityVisibilityTransport {
  calls: PerplexityVisibilityHttpRequest[] = [];
  constructor(private readonly response: PerplexityVisibilityHttpResponse) {}
  async send(request: PerplexityVisibilityHttpRequest) { this.calls.push(request); return this.response; }
}
const request: VisibilitySampleRequest = { prompt: 'Which websites explain Chinese folk religious traditions well?', model: 'sonar-pro', locale: 'en-US', country: 'US', groundingMode: 'SONAR', providerOptions: { searchDomainFilter: ['xingshantang.org', 'example.org'], searchRecencyFilter: 'month' } };
function successBody() { return {
  id: 'sonar_fixture_123', model: 'sonar-pro', object: 'chat.completion',
  choices: [{ message: { role: 'assistant', content: 'Xingshantang is one source.[1] Another reference is also useful.[2]' } }],
  usage: { prompt_tokens: 26, completion_tokens: 832, total_tokens: 858, num_search_queries: 2, reasoning_tokens: 999, cost: { total_cost: 0.018558 } },
  citations: ['https://xingshantang.org/article', 'https://example.org/reference'],
  search_results: [{ title: 'Xingshantang Article', url: 'https://xingshantang.org/article', date: '2026-08-18', last_updated: '2026-08-19', snippet: 'hidden' }, { title: 'Reference', url: 'https://example.org/reference', date: '2026-08-17', last_updated: '2026-08-18', snippet: 'hidden' }]
}; }

describe('P6-A Perplexity Sonar visibility adapter', () => {
  it('normalizes native citations/search results as KNOWN_PRESENT', async () => {
    const result = await new PerplexityVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body: successBody(), latencyMs: 31 }) }).sample(request);
    expect(result).toMatchObject({ status: 'COMPLETED', providerResponseId: 'sonar_fixture_123', citationEvidenceState: 'KNOWN_PRESENT', searchUnits: 2, costMicros: 18_558, costCurrency: 'USD' });
    expect(result.citations).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/reasoning_tokens|hidden/i);
  });

  it('marks explicit empty citation and search result arrays as KNOWN_EMPTY', async () => {
    const body = { id: 'sonar_empty', choices: [{ message: { role: 'assistant', content: 'No cited sources.' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }, citations: [], search_results: [] };
    await expect(new PerplexityVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body, latencyMs: 4 }) }).sample(request)).resolves.toMatchObject({ status: 'COMPLETED', citationEvidenceState: 'KNOWN_EMPTY' });
  });

  it('keeps missing citation metadata UNKNOWN', async () => {
    const body = { id: 'sonar_unknown', choices: [{ message: { role: 'assistant', content: 'Answer without source metadata.' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } };
    await expect(new PerplexityVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body, latencyMs: 4 }) }).sample(request)).resolves.toMatchObject({ status: 'COMPLETED', citationEvidenceState: 'UNKNOWN' });
  });

  it('keeps incomplete response evidence UNKNOWN', async () => {
    const body = { id: 'sonar_incomplete', choices: [], usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10, cost: { total_cost: 0.006 } }, citations: [], search_results: [] };
    await expect(new PerplexityVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body, latencyMs: 7 }) }).sample(request)).resolves.toMatchObject({ status: 'INCOMPLETE', citationEvidenceState: 'UNKNOWN', costMicros: 6000 });
  });

  it.each([[401, 'VISIBILITY_PROVIDER_AUTH_FAILED'], [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'], [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'], [500, 'VISIBILITY_PROVIDER_FAILED']])('maps HTTP %s safely', async (status, code) => {
    await expect(new PerplexityVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status, latencyMs: 4, body: { error: { message: 'secret' } } }) }).sample(request)).rejects.toMatchObject({ code, httpStatus: status });
  });

  it('fails before network without API key', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 1, body: successBody() });
    await expect(new PerplexityVisibilityProvider({ apiKey: '', transport }).sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });
});
