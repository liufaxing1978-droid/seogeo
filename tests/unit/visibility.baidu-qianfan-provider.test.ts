import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import {
  BaiduQianfanVisibilityProvider,
  type BaiduQianfanVisibilityHttpRequest,
  type BaiduQianfanVisibilityHttpResponse,
  type BaiduQianfanVisibilityTransport
} from '../../src/modules/visibility/providers/baidu-qianfan.provider.js';

class FixtureTransport implements BaiduQianfanVisibilityTransport {
  calls: BaiduQianfanVisibilityHttpRequest[] = [];
  constructor(private readonly responses: BaiduQianfanVisibilityHttpResponse[]) {}
  async send(request: BaiduQianfanVisibilityHttpRequest) {
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('missing fixture response');
    return response;
  }
}

const request: VisibilitySampleRequest = {
  prompt: '哪些网站可以可靠介绍中国民间信仰？',
  model: 'baidu-ai-search',
  locale: 'zh-CN',
  country: 'CN',
  groundingMode: 'WEB_SEARCH',
  providerOptions: {}
};

function completedBody(references: unknown[] = [
  { id: 1, title: '兴善堂', url: 'https://xingshantang.org/article', type: 'web', website: '兴善堂' },
  { id: 2, title: '参考资料', url: 'https://example.cn/reference', type: 'web', website: 'Example' },
  { id: 3, title: '重复资料', url: 'https://xingshantang.org/article', type: 'web', website: '兴善堂' }
]) {
  return {
    request_id: 'baidu_req_123',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '兴善堂与参考资料均提供相关公开信息。' } }],
    references
  };
}

describe('P9-0E Baidu Qianfan AI Search visibility adapter', () => {
  it('calls the official web summary API and normalizes native references', async () => {
    const transport = new FixtureTransport([{ status: 200, body: completedBody(), latencyMs: 26 }]);
    const adapter = new BaiduQianfanVisibilityProvider({ apiKey: 'fixture-key', transport });

    expect(adapter.capabilities).toEqual(['WEB_GROUNDED', 'SEARCH_API', 'CITATION_NATIVE']);
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(true);
    const result = await adapter.sample(request);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      url: 'https://qianfan.baidubce.com/v2/ai_search/web_summary',
      method: 'POST',
      headers: {
        Authorization: 'Bearer fixture-key',
        'Content-Type': 'application/json'
      },
      body: {
        instruction: 'Answer using current web search evidence and preserve source attribution.',
        messages: [{ role: 'user', content: request.prompt }],
        stream: false
      }
    });
    expect(result).toEqual({
      status: 'COMPLETED',
      providerResponseId: 'baidu_req_123',
      answerText: '兴善堂与参考资料均提供相关公开信息。',
      citations: [
        { url: 'https://xingshantang.org/article', title: '兴善堂', position: 1, sourceType: 'baidu_qianfan_reference' },
        { url: 'https://example.cn/reference', title: '参考资料', position: 2, sourceType: 'baidu_qianfan_reference' }
      ],
      citationEvidenceState: 'KNOWN_PRESENT',
      searchMetadata: {
        surface: 'BAIDU_QIANFAN_AI_SEARCH_WEB_SUMMARY',
        webGroundingEnabled: true,
        searchApi: true
      },
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      searchUnits: null,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: 26
    });
  });

  it('marks an explicit empty references array as KNOWN_EMPTY', async () => {
    const adapter = new BaiduQianfanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status: 200, body: completedBody([]), latencyMs: 3 }])
    });
    await expect(adapter.sample(request)).resolves.toMatchObject({
      status: 'COMPLETED',
      citations: [],
      citationEvidenceState: 'KNOWN_EMPTY'
    });
  });

  it('uses UNKNOWN when the success body omits the reference collection', async () => {
    const body = completedBody();
    delete (body as { references?: unknown[] }).references;
    const adapter = new BaiduQianfanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status: 200, body, latencyMs: 3 }])
    });
    await expect(adapter.sample(request)).resolves.toMatchObject({ citationEvidenceState: 'UNKNOWN' });
  });

  it('fails before network when the API key is not configured', async () => {
    const transport = new FixtureTransport([]);
    await expect(new BaiduQianfanVisibilityProvider({ apiKey: '', transport }).sample(request))
      .rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    [401, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'],
    [500, 'VISIBILITY_PROVIDER_FAILED']
  ])('maps Qianfan HTTP %s to stable safe error %s', async (status, code) => {
    const adapter = new BaiduQianfanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status, body: { message: 'sensitive upstream body' }, latencyMs: 2 }])
    });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code, httpStatus: status });
  });

  it('maps transport failures to the stable provider failure code', async () => {
    const transport: BaiduQianfanVisibilityTransport = {
      async send() { throw new Error('Authorization: Bearer SUPERSECRET transport failure'); }
    };
    const adapter = new BaiduQianfanVisibilityProvider({ apiKey: 'fixture-key', transport });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_FAILED' });
  });

  it('rejects malformed successful responses deterministically', async () => {
    const adapter = new BaiduQianfanVisibilityProvider({
      apiKey: 'fixture-key',
      transport: new FixtureTransport([{ status: 200, body: { request_id: 'baidu_req_123', choices: [] }, latencyMs: 2 }])
    });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_MALFORMED_RESPONSE' });
  });

  it('returns UNSUPPORTED without network calls for non-web grounding modes', async () => {
    const transport = new FixtureTransport([]);
    const adapter = new BaiduQianfanVisibilityProvider({ apiKey: 'fixture-key', transport });
    await expect(adapter.sample({ ...request, groundingMode: 'SONAR' })).resolves.toMatchObject({
      status: 'UNSUPPORTED',
      citationEvidenceState: 'NOT_APPLICABLE'
    });
    expect(transport.calls).toHaveLength(0);
  });
});
