import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import {
  QwenVisibilityProvider,
  type QwenVisibilityHttpRequest,
  type QwenVisibilityHttpResponse,
  type QwenVisibilityTransport
} from '../../src/modules/visibility/providers/qwen.provider.js';

class FixtureTransport implements QwenVisibilityTransport {
  calls: QwenVisibilityHttpRequest[] = [];
  constructor(private readonly responses: QwenVisibilityHttpResponse[]) {}
  async send(request: QwenVisibilityHttpRequest) {
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('missing fixture response');
    return response;
  }
}

const request: VisibilitySampleRequest = {
  prompt: '哪些网站可以可靠介绍中国民间信仰？',
  model: 'qwen-plus',
  locale: 'zh-CN',
  country: 'CN',
  groundingMode: 'WEB_SEARCH',
  providerOptions: { workspaceId: 'ws-fixture', region: 'cn-beijing' }
};

function completedBody(searchResults: unknown[] = [
  { index: 1, title: '兴善堂', url: 'https://xingshantang.org/article' },
  { index: 2, title: '参考资料', url: 'https://example.cn/reference' },
  { index: 3, title: '重复资料', url: 'https://xingshantang.org/article' }
]) {
  return {
    request_id: 'qwen_req_123',
    output: {
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '兴善堂与参考资料均提供相关公开信息。' } }],
      search_info: { search_results: searchResults }
    },
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
  };
}

describe('P9-0E Alibaba Cloud Model Studio Qwen visibility adapter', () => {
  it('uses DashScope native web search and normalizes native sources', async () => {
    const transport = new FixtureTransport([{ status: 200, body: completedBody(), latencyMs: 31 }]);
    const adapter = new QwenVisibilityProvider({ apiKey: 'fixture-key', transport });

    expect(adapter.capabilities).toEqual(['WEB_GROUNDED', 'CITATION_NATIVE']);
    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(true);
    const result = await adapter.sample(request);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      url: 'https://ws-fixture.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      method: 'POST',
      headers: {
        Authorization: 'Bearer fixture-key',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'qwen-plus',
        input: { messages: [{ role: 'user', content: request.prompt }] },
        parameters: {
          result_format: 'message',
          enable_search: true,
          search_options: {
            enable_source: true,
            enable_citation: true,
            citation_format: '[ref_<number>]'
          }
        }
      }
    });
    expect(result).toEqual({
      status: 'COMPLETED',
      providerResponseId: 'qwen_req_123',
      answerText: '兴善堂与参考资料均提供相关公开信息。',
      citations: [
        { url: 'https://xingshantang.org/article', title: '兴善堂', position: 1, sourceType: 'qwen_search_result' },
        { url: 'https://example.cn/reference', title: '参考资料', position: 2, sourceType: 'qwen_search_result' }
      ],
      citationEvidenceState: 'KNOWN_PRESENT',
      searchMetadata: {
        surface: 'ALIBABA_CLOUD_MODEL_STUDIO_DASHSCOPE',
        webGroundingEnabled: true,
        region: 'cn-beijing'
      },
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      searchUnits: null,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: 31
    });
  });

  it('marks explicit empty search results as KNOWN_EMPTY', async () => {
    const adapter = new QwenVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport([{ status: 200, body: completedBody([]), latencyMs: 2 }]) });
    await expect(adapter.sample(request)).resolves.toMatchObject({ citations: [], citationEvidenceState: 'KNOWN_EMPTY' });
  });

  it('uses UNKNOWN when search_info is absent', async () => {
    const body = completedBody();
    delete (body.output as { search_info?: unknown }).search_info;
    const adapter = new QwenVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport([{ status: 200, body, latencyMs: 2 }]) });
    await expect(adapter.sample(request)).resolves.toMatchObject({ citationEvidenceState: 'UNKNOWN' });
  });

  it('fails before network for missing API key or workspaceId', async () => {
    const transport = new FixtureTransport([]);
    await expect(new QwenVisibilityProvider({ apiKey: '', transport }).sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    await expect(new QwenVisibilityProvider({ apiKey: 'fixture-key', transport }).sample({ ...request, providerOptions: { region: 'cn-beijing' } })).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects unsafe workspace and unsupported regions before network', async () => {
    const transport = new FixtureTransport([]);
    const adapter = new QwenVisibilityProvider({ apiKey: 'fixture-key', transport });
    await expect(adapter.sample({ ...request, providerOptions: { workspaceId: 'bad.example.com/x', region: 'cn-beijing' } })).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_FAILED' });
    await expect(adapter.sample({ ...request, providerOptions: { workspaceId: 'ws-fixture', region: 'us-west' } })).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    [401, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'],
    [500, 'VISIBILITY_PROVIDER_FAILED']
  ])('maps DashScope HTTP %s to stable safe error %s', async (status, code) => {
    const adapter = new QwenVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport([{ status, body: { message: 'sensitive upstream body' }, latencyMs: 2 }]) });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code, httpStatus: status });
  });

  it('maps transport failures and rejects malformed successful responses', async () => {
    const broken: QwenVisibilityTransport = { async send() { throw new Error('Authorization: Bearer SUPERSECRET timeout'); } };
    await expect(new QwenVisibilityProvider({ apiKey: 'fixture-key', transport: broken }).sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_FAILED' });
    const malformed = new QwenVisibilityProvider({ apiKey: 'fixture-key', transport: new FixtureTransport([{ status: 200, body: { request_id: 'qwen_req_123', output: { choices: [] } }, latencyMs: 2 }]) });
    await expect(malformed.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_MALFORMED_RESPONSE' });
  });

  it('returns UNSUPPORTED without network calls for non-web grounding modes', async () => {
    const transport = new FixtureTransport([]);
    const adapter = new QwenVisibilityProvider({ apiKey: 'fixture-key', transport });
    await expect(adapter.sample({ ...request, groundingMode: 'SONAR' })).resolves.toMatchObject({ status: 'UNSUPPORTED', citationEvidenceState: 'NOT_APPLICABLE' });
    expect(transport.calls).toHaveLength(0);
  });
});
