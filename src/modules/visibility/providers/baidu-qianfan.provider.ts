import type { CitationEvidenceState, VisibilityGroundingMode } from '@prisma/client';
import {
  VisibilityProviderError,
  type VisibilityCitationSource,
  type VisibilityProviderAdapter,
  type VisibilitySampleRequest,
  type VisibilitySampleResponse
} from './provider.js';

const BAIDU_QIANFAN_WEB_SUMMARY_URL = 'https://qianfan.baidubce.com/v2/ai_search/web_summary';
const BAIDU_QIANFAN_INSTRUCTION = 'Answer using current web search evidence and preserve source attribution.';

export interface BaiduQianfanVisibilityHttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface BaiduQianfanVisibilityHttpResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export interface BaiduQianfanVisibilityTransport {
  send(request: BaiduQianfanVisibilityHttpRequest): Promise<BaiduQianfanVisibilityHttpResponse>;
}

class FetchBaiduQianfanVisibilityTransport implements BaiduQianfanVisibilityTransport {
  async send(request: BaiduQianfanVisibilityHttpRequest): Promise<BaiduQianfanVisibilityHttpResponse> {
    const startedAt = Date.now();
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body)
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return {
      status: response.status,
      body,
      latencyMs: Date.now() - startedAt
    };
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function unsupportedResponse(): VisibilitySampleResponse {
  return {
    status: 'UNSUPPORTED',
    providerResponseId: null,
    answerText: null,
    citations: [],
    citationEvidenceState: 'NOT_APPLICABLE',
    searchMetadata: {},
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    searchUnits: null,
    costMicros: null,
    costCurrency: null,
    pricingVersion: null,
    latencyMs: null
  };
}

function providerHttpError(status: number): VisibilityProviderError {
  if (status === 401 || status === 403) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_AUTH_FAILED',
      `Baidu Qianfan visibility request failed with HTTP ${status}`,
      { httpStatus: status, retryable: false }
    );
  }
  if (status === 429) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_RATE_LIMITED',
      'Baidu Qianfan visibility request was rate limited',
      { httpStatus: status, retryable: false }
    );
  }
  return new VisibilityProviderError(
    'VISIBILITY_PROVIDER_FAILED',
    `Baidu Qianfan visibility request failed with HTTP ${status}`,
    { httpStatus: status, retryable: false }
  );
}

function answerText(choices: unknown[]): string | null {
  for (const choice of choices) {
    const message = record(record(choice)?.message);
    const content = stringValue(message?.content);
    if (content) return content;
  }
  return null;
}

function normalizeCitations(rawReferences: unknown): VisibilityCitationSource[] {
  if (!Array.isArray(rawReferences)) return [];
  const citations: VisibilityCitationSource[] = [];
  const seen = new Set<string>();

  for (const reference of rawReferences) {
    const value = record(reference);
    const url = stringValue(value?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      url,
      title: stringValue(value?.title),
      position: positiveInteger(value?.id),
      sourceType: 'baidu_qianfan_reference'
    });
  }

  return citations;
}

function citationEvidenceState(
  rawReferences: unknown,
  citations: VisibilityCitationSource[]
): CitationEvidenceState {
  if (citations.length > 0) return 'KNOWN_PRESENT';
  if (Array.isArray(rawReferences) && rawReferences.length === 0) return 'KNOWN_EMPTY';
  return 'UNKNOWN';
}

export class BaiduQianfanVisibilityProvider implements VisibilityProviderAdapter {
  readonly provider = 'BAIDU_QIANFAN' as const;
  readonly channel = 'API' as const;
  readonly capabilities = ['WEB_GROUNDED', 'SEARCH_API', 'CITATION_NATIVE'] as const;

  private readonly apiKey: string;
  private readonly transport: BaiduQianfanVisibilityTransport;

  constructor(options: { apiKey?: string; transport?: BaiduQianfanVisibilityTransport } = {}) {
    this.apiKey = options.apiKey ?? process.env.BAIDU_QIANFAN_API_KEY ?? '';
    this.transport = options.transport ?? new FetchBaiduQianfanVisibilityTransport();
  }

  supportsWebGrounding(mode: VisibilityGroundingMode) {
    return mode === 'WEB_SEARCH';
  }

  estimateCostMicros(_request: VisibilitySampleRequest): number | null {
    return null;
  }

  async sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    if (!this.apiKey.trim()) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_AUTH_FAILED',
        'Baidu Qianfan API key is not configured',
        { retryable: false }
      );
    }

    if (!this.supportsWebGrounding(request.groundingMode)) {
      return unsupportedResponse();
    }

    let response: BaiduQianfanVisibilityHttpResponse;
    try {
      response = await this.transport.send({
        url: BAIDU_QIANFAN_WEB_SUMMARY_URL,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: {
          instruction: BAIDU_QIANFAN_INSTRUCTION,
          messages: [{ role: 'user', content: request.prompt }],
          stream: false
        }
      });
    } catch (error) {
      if (error instanceof VisibilityProviderError) throw error;
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_FAILED',
        'Baidu Qianfan visibility request failed',
        { retryable: false }
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw providerHttpError(response.status);
    }

    const body = record(response.body);
    const providerResponseId = stringValue(body?.request_id);
    const choices = Array.isArray(body?.choices) ? body.choices : null;
    const normalizedAnswer = choices ? answerText(choices) : null;
    if (!body || !providerResponseId || choices === null || !normalizedAnswer) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_MALFORMED_RESPONSE',
        'Baidu Qianfan returned a malformed visibility response',
        { httpStatus: response.status, retryable: false }
      );
    }

    const rawReferences = body.references;
    const citations = normalizeCitations(rawReferences);

    return {
      status: 'COMPLETED',
      providerResponseId,
      answerText: normalizedAnswer,
      citations,
      citationEvidenceState: citationEvidenceState(rawReferences, citations),
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
      latencyMs: response.latencyMs
    };
  }
}
