import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import { AnthropicVisibilityProvider, type AnthropicVisibilityHttpRequest, type AnthropicVisibilityHttpResponse, type AnthropicVisibilityTransport } from '../../src/modules/visibility/providers/anthropic.provider.js';

class FixtureTransport implements AnthropicVisibilityTransport {
  calls: AnthropicVisibilityHttpRequest[] = [];
  constructor(private readonly response: AnthropicVisibilityHttpResponse) {}
  async send(request: AnthropicVisibilityHttpRequest) { this.calls.push(request); return this.response; }
}
const request: VisibilitySampleRequest = { prompt: 'Which websites explain Chinese folk religious traditions well?', model: 'claude-sonnet-4-20250514', locale: 'en-US', country: 'US', groundingMode: 'WEB_SEARCH_TOOL', providerOptions: { maxUses: 3 } };
function successBody() { return {
  id: 'msg_fixture_123', content: [
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'hidden query' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://xingshantang.org/article', title: 'Xingshantang Article' }, { type: 'web_search_result', url: 'https://example.org/reference', title: 'Reference' }] },
    { type: 'thinking', thinking: 'private reasoning' },
    { type: 'text', text: 'Xingshantang is one source. Another reference is also useful.', citations: [
      { type: 'web_search_result_location', url: 'https://xingshantang.org/article', title: 'Xingshantang Article' },
      { type: 'web_search_result_location', url: 'https://example.org/reference', title: 'Reference' }
    ] }
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 105, output_tokens: 6039, server_tool_use: { web_search_requests: 1 } }
}; }

describe('P6-A Anthropic web-search visibility adapter', () => {
  it('normalizes native web citations as KNOWN_PRESENT', async () => {
    const result = await new AnthropicVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body: successBody(), latencyMs: 44 }) }).sample(request);
    expect(result).toMatchObject({ status: 'COMPLETED', providerResponseId: 'msg_fixture_123', citationEvidenceState: 'KNOWN_PRESENT', promptTokens: 105, completionTokens: 6039, totalTokens: 6144, searchUnits: 1 });
    expect(result.citations).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/hidden query|private reasoning/i);
  });

  it('marks explicit empty web_search_tool_result as KNOWN_EMPTY', async () => {
    const body = { id: 'msg_empty', content: [{ type: 'web_search_tool_result', tool_use_id: 'tool_empty', content: [] }, { type: 'text', text: 'No cited sources.', citations: [] }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3, server_tool_use: { web_search_requests: 1 } } };
    await expect(new AnthropicVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: 200, body, latencyMs: 4 }) }).sample(request)).resolves.toMatchObject({ citationEvidenceState: 'KNOWN_EMPTY' });
  });

  it.each([['pause_turn', 'INCOMPLETE'], ['max_tokens', 'INCOMPLETE'], ['refusal', 'REFUSED']])('maps stop_reason %s to %s with UNKNOWN evidence', async (stopReason, status) => {
    const body = { id: `msg_${stopReason}`, content: [], stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 2, server_tool_use: { web_search_requests: 1 } } };
    const transport = new FixtureTransport({ status: 200, body, latencyMs: 8 });
    await expect(new AnthropicVisibilityProvider({ apiKey: 'fixture-key', transport }).sample(request)).resolves.toMatchObject({ status, providerResponseId: `msg_${stopReason}`, citationEvidenceState: 'UNKNOWN' });
    expect(transport.calls).toHaveLength(1);
  });

  it.each([[401, 'VISIBILITY_PROVIDER_AUTH_FAILED'], [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'], [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'], [500, 'VISIBILITY_PROVIDER_FAILED']])('maps HTTP %s safely', async (httpStatus, code) => {
    await expect(new AnthropicVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport({ status: httpStatus, latencyMs: 4, body: { error: { message: 'secret' } } }) }).sample(request)).rejects.toMatchObject({ code, httpStatus });
  });

  it('fails before network without API key', async () => {
    const transport = new FixtureTransport({ status: 200, latencyMs: 1, body: successBody() });
    await expect(new AnthropicVisibilityProvider({ apiKey: '', transport }).sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });
});
