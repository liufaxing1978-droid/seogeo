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
  providerOptions: { searchSource: 'standard' }
};

function completedBody(searchResults: unknown[] = [
  { index: 1, url: 'https://xingshantang.org/article', name: '兴善堂', snippet: '公开资料', site: '兴善堂' },
  { index: 2, url: 'https://example.cn/reference', name: '参考资料', snippet: '参考内容', site: 'Example' },
  { index: 3, url: 'https://xingshantang.org/article', name: '重复资料', snippet: '重复', site: '兴善堂' }
]) {
  return {
    id: 'chatcmpl_tencent_123',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: '兴善堂与参考资料均提供相关公开信息。[1][2]',
        reasoning_content: 'must never be normalized into search metadata',
        search_results: searchResults
      },
      finish_reason: 'stop'
    }],
    usage: {
      prompt_tokens: 41,
      completion_tokens: 19,
      total_tokens: 60,
      tool_usage: { web_search_call: 1 }
    }
  };
}

describe('P9-0E Tencent Hunyuan TokenHub visibility adapter', () => {
  it('calls the official TokenHub Chat web-search API and normalizes native search results', async () => {
    const transport = new FixtureTransport([{ status: 200, body: completedBody(), latencyMs: 31 }]);
    const adapter = new TencentHunyuanVisibilityProvider({ apiKey: 'fixture-key', transport });

    expect(adapter.capabilities).toEqual(['WEB_GROUNDED', 'CITATION_NATIVE']);
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(true);
    const result = await adapter.sample(request);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      url: 'https://tokenhub.tencentmaas.com/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer fixture-key',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'hy3',
        messages: [{ role: 'user', content: request.prompt }],
        stream: false,
        web_search_options: {
          enable: true,
          search_source: 'standard'
        }
      }
    });
    expect(result).toEqual({
      status: 'COMPLETED',
      providerResponseId: 'chatcmpl_tencent_123',
      answerText: '兴善堂与参考资料均提供相关公开信息。[1][2]',
      citations: [
        { url: 'https://xingshantang.org/article', title: '兴善堂', position: 1, sourceType: 'tencent_tokenhub_search_result' },
        { url: 'https://example.cn/reference', title: '参考资料', position: 2, sourceType: 'tencent_tokenhub_search_result' }
      ],
      citationEvidenceState: 'KNOWN_PRESENT',
      searchMetadata: {
        surface: 'TENCENT_TOKENHUB_CHAT_WEB_SEARCH',
        webGroundingEnabled: true,
        searchSource: 'standard'
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
    expect(JSON.stringify(result.searchMetadata)).not.toContain('reasoning');
  });

  it('marks an explicit empty search_results array as KNOWN_EMPTY', async () => {
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

  it('uses UNKNOWN when a successful response omits search_results', async () => {
    const body = completedBody();
    delete (body.choices[0].message as { search_results?: unknown[] }).search_results;
    const adapter = new TencentHunyuanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status: 200, body, latencyMs: 3 }])
    });
    await expect(adapter.sample(request)).resolves.toMatchObject({ citationEvidenceState: 'UNKNOWN' });
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

  it('rejects unsupported searchSource values before network', async () => {
    const transport = new FixtureTransport([]);
    const adapter = new TencentHunyuanVisibilityProvider({ apiKey: 'fixture-key', transport });
    await expect(adapter.sample({ ...request, providerOptions: { searchSource: 'consumer-ui' } }))
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
      transport: new FixtureTransport([{ status: 200, body: { id: 'chatcmpl_tencent_123', choices: [] }, latencyMs: 2 }])
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
