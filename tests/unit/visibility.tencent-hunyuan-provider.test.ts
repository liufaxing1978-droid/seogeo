import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import {
  TencentHunyuanVisibilityProvider,
  type TencentHunyuanVisibilityHttpRequest,
  type TencentHunyuanVisibilityHttpResponse,
  type TencentHunyuanVisibilityTransport
} from '../../src/modules/visibility/providers/tencent-hunyuan.provider.js';

class FixtureTransport implements TencentHunyuanVisibilityTransport {
  calls: TencentHunyuanVisibilityHttpRequest[] = [];
  constructor(private readonly responses: TencentHunyuanVisibilityHttpResponse[]) {}
  async send(request: TencentHunyuanVisibilityHttpRequest) {
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('missing fixture response');
    return response;
  }
}

const request: VisibilitySampleRequest = {
  prompt: '哪些网站可以可靠介绍中国民间信仰？',
  model: 'hy3',
  locale: 'zh-CN',
  country: 'CN',
  groundingMode: 'WEB_SEARCH',
  providerOptions: { searchContextSize: 'medium' }
};

function completedBody(annotations: unknown[] | null = [
  { type: 'url_citation', index: 1, url: 'https://xingshantang.org/article', title: '兴善堂', start_index: 20, end_index: 23 },
  { type: 'url_citation', index: 2, url: 'https://example.cn/reference', title: '参考资料', start_index: 24, end_index: 27 },
  { type: 'url_citation', index: 3, url: 'https://xingshantang.org/article', title: '重复资料', start_index: 28, end_index: 31 }
]) {
  const outputText: Record<string, unknown> = {
    type: 'output_text',
    text: '兴善堂与参考资料均提供相关公开信息。[1][2]'
  };
  if (annotations !== null) outputText.annotations = annotations;
  return {
    id: 'resp_tencent_123',
    output: [
      { id: 'search_1', type: 'web_search_call', status: 'completed', action: { type: 'search', query: '中国民间信仰 可靠资料' } },
      { id: 'msg_1', type: 'message', role: 'assistant', content: [outputText] },
      { id: 'reasoning_1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'must never be normalized or persisted' }] }
    ],
    usage: {
      prompt_tokens: 41,
      completion_tokens: 19,
      total_tokens: 60,
      tool_usage: { web_search_call: 1 }
    }
  };
}

describe('P9-0E Tencent Hunyuan TokenHub visibility adapter', () => {
  it('calls the official TokenHub Responses web-search API and normalizes native URL citations', async () => {
    const transport = new FixtureTransport([{ status: 200, body: completedBody(), latencyMs: 31 }]);
    const adapter = new TencentHunyuanVisibilityProvider({ apiKey: 'fixture-key', transport });

    expect(adapter.capabilities).toEqual(['WEB_GROUNDED', 'CITATION_NATIVE']);
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(true);
    const result = await adapter.sample(request);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      url: 'https://tokenhub.tencentmaas.com/v1/responses',
      method: 'POST',
      headers: {
        Authorization: 'Bearer fixture-key',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'hy3',
        input: request.prompt,
        tools: [{ type: 'web_search', search_context_size: 'medium' }]
      }
    });
    expect(result).toEqual({
      status: 'COMPLETED',
      providerResponseId: 'resp_tencent_123',
      answerText: '兴善堂与参考资料均提供相关公开信息。[1][2]',
      citations: [
        { url: 'https://xingshantang.org/article', title: '兴善堂', position: 1, sourceType: 'tencent_tokenhub_url_citation' },
        { url: 'https://example.cn/reference', title: '参考资料', position: 2, sourceType: 'tencent_tokenhub_url_citation' }
      ],
      citationEvidenceState: 'KNOWN_PRESENT',
      searchMetadata: {
        surface: 'TENCENT_TOKENHUB',
        groundingProvider: 'TOKENHUB_WEB_SEARCH',
        webGroundingEnabled: true,
        requestedModel: 'hy3'
      },
      promptTokens: 41,
      completionTokens: 19,
      totalTokens: 60,
      searchUnits: 1,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: 31
    });
    expect(JSON.stringify(result.searchMetadata)).not.toMatch(/reasoning|query/i);
  });

  it('defaults searchContextSize to medium', async () => {
    const transport = new FixtureTransport([{ status: 200, body: completedBody([]), latencyMs: 2 }]);
    const adapter = new TencentHunyuanVisibilityProvider({ apiKey: 'fixture-key', transport });
    await adapter.sample({ ...request, providerOptions: {} });
    expect(transport.calls[0]?.body).toMatchObject({
      tools: [{ type: 'web_search', search_context_size: 'medium' }]
    });
  });

  it.each(['low', 'medium', 'high'])('accepts supported searchContextSize %s', async (searchContextSize) => {
    const transport = new FixtureTransport([{ status: 200, body: completedBody([]), latencyMs: 2 }]);
    const adapter = new TencentHunyuanVisibilityProvider({ apiKey: 'fixture-key', transport });
    await adapter.sample({ ...request, providerOptions: { searchContextSize } });
    expect(transport.calls[0]?.body).toMatchObject({
      tools: [{ type: 'web_search', search_context_size: searchContextSize }]
    });
  });

  it('marks explicit empty annotations as KNOWN_EMPTY', async () => {
    const adapter = new TencentHunyuanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status: 200, body: completedBody([]), latencyMs: 3 }])
    });
    await expect(adapter.sample(request)).resolves.toMatchObject({
      status: 'COMPLETED',
      citations: [],
      citationEvidenceState: 'KNOWN_EMPTY'
    });
  });

  it('uses UNKNOWN when a successful response omits annotations', async () => {
    const adapter = new TencentHunyuanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status: 200, body: completedBody(null), latencyMs: 3 }])
    });
    await expect(adapter.sample(request)).resolves.toMatchObject({ citationEvidenceState: 'UNKNOWN' });
  });

  it('uses explicit web_search_call output as a safe search-unit fallback when usage omits tool_usage', async () => {
    const body = completedBody([]);
    delete (body.usage as { tool_usage?: unknown }).tool_usage;
    const adapter = new TencentHunyuanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status: 200, body, latencyMs: 3 }])
    });
    await expect(adapter.sample(request)).resolves.toMatchObject({ searchUnits: 1 });
  });

  it('fails before network when the TokenHub API key is not configured', async () => {
    const transport = new FixtureTransport([]);
    await expect(new TencentHunyuanVisibilityProvider({ apiKey: '', transport }).sample(request))
      .rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    [401, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'],
    [500, 'VISIBILITY_PROVIDER_FAILED']
  ])('maps TokenHub HTTP %s to stable safe error %s', async (status, code) => {
    const adapter = new TencentHunyuanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status, body: { error: { message: 'sensitive upstream body' } }, latencyMs: 2 }])
    });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code, httpStatus: status });
  });

  it('rejects unsupported searchContextSize values before network', async () => {
    const transport = new FixtureTransport([]);
    const adapter = new TencentHunyuanVisibilityProvider({ apiKey: 'fixture-key', transport });
    await expect(adapter.sample({ ...request, providerOptions: { searchContextSize: 'consumer-ui' } }))
      .rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });

  it('maps transport failures to the stable provider failure code', async () => {
    const transport: TencentHunyuanVisibilityTransport = {
      async send() { throw new Error('Authorization: Bearer SUPERSECRET transport failure'); }
    };
    const adapter = new TencentHunyuanVisibilityProvider({ apiKey: 'fixture-key', transport });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_FAILED' });
  });

  it('rejects malformed successful responses deterministically', async () => {
    const adapter = new TencentHunyuanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status: 200, body: { id: 'resp_tencent_123', output: [] }, latencyMs: 2 }])
    });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_MALFORMED_RESPONSE' });
  });

  it('returns UNSUPPORTED without network calls for non-web grounding modes', async () => {
    const transport = new FixtureTransport([]);
    const adapter = new TencentHunyuanVisibilityProvider({ apiKey: 'fixture-key', transport });
    await expect(adapter.sample({ ...request, groundingMode: 'SONAR' })).resolves.toMatchObject({
      status: 'UNSUPPORTED',
      citationEvidenceState: 'NOT_APPLICABLE'
    });
    expect(transport.calls).toHaveLength(0);
  });
});
