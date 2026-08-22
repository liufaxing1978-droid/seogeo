import type { CitationEvidenceState, VisibilityGroundingMode } from '@prisma/client';
import {
  VisibilityProviderError,
  type VisibilityCitationSource,
  type VisibilityProviderAdapter,
  type VisibilitySampleRequest,
  type VisibilitySampleResponse
} from './provider.js';

const TOKENHUB_RESPONSES_URL = 'https://tokenhub.tencentmaas.com/v1/responses';
const SEARCH_CONTEXT_SIZES = new Set(['low', 'medium', 'high']);

type SearchContextSize = 'low' | 'medium' | 'high';

export interface TencentHunyuanVisibilityHttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface TencentHunyuanVisibilityHttpResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export interface TencentHunyuanVisibilityTransport {
  send(request: TencentHunyuanVisibilityHttpRequest): Promise<TencentHunyuanVisibilityHttpResponse>;
}

class FetchTencentHunyuanVisibilityTransport implements TencentHunyuanVisibilityTransport {
  async send(request: TencentHunyuanVisibilityHttpRequest): Promise<TencentHunyuanVisibilityHttpResponse> {
    const startedAt = Date.now();
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body)
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body, latencyMs: Date.now() - startedAt };
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

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
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
      `Tencent TokenHub visibility request failed with HTTP ${status}`,
      { httpStatus: status, retryable: false }
    );
  }
  if (status === 429) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_RATE_LIMITED',
      'Tencent TokenHub visibility request was rate limited',
      { httpStatus: status, retryable: false }
    );
  }
  return new VisibilityProviderError(
    'VISIBILITY_PROVIDER_FAILED',
    `Tencent TokenHub visibility request failed with HTTP ${status}`,
    { httpStatus: status, retryable: false }
  );
}

function resolveSearchContextSize(options: Record<string, unknown>): SearchContextSize {
  const value = options.searchContextSize;
  if (value === undefined) return 'medium';
  if (typeof value !== 'string' || !SEARCH_CONTEXT_SIZES.has(value)) {
    throw new VisibilityProviderError(
      'VISIBILITY_PROVIDER_FAILED',
      'Tencent TokenHub searchContextSize must be low, medium, or high',
      { retryable: false }
    );
  }
  return value as SearchContextSize;
}

interface NormalizedOutput {
  answerText: string | null;
  rawAnnotations: unknown;
  annotationsObserved: boolean;
  explicitSearchCalls: number;
}

function normalizeOutput(value: unknown): NormalizedOutput {
  if (!Array.isArray(value)) {
    return { answerText: null, rawAnnotations: undefined, annotationsObserved: false, explicitSearchCalls: 0 };
  }

  const answerParts: string[] = [];
  const annotations: unknown[] = [];
  let annotationsObserved = false;
  let explicitSearchCalls = 0;

  for (const item of value) {
    const outputItem = record(item);
    if (!outputItem) continue;
    if (outputItem.type === 'web_search_call') {
      explicitSearchCalls += 1;
      continue;
    }
    if (outputItem.type !== 'message' || !Array.isArray(outputItem.content)) continue;

    for (const contentItem of outputItem.content) {
      const content = record(contentItem);
      if (!content || content.type !== 'output_text') continue;
      const text = stringValue(content.text);
      if (text) answerParts.push(text);
      if (Object.prototype.hasOwnProperty.call(content, 'annotations')) {
        annotationsObserved = true;
        if (Array.isArray(content.annotations)) annotations.push(...content.annotations);
      }
    }
  }

  return {
    answerText: answerParts.length > 0 ? answerParts.join('\n') : null,
    rawAnnotations: annotationsObserved ? annotations : undefined,
    annotationsObserved,
    explicitSearchCalls
  };
}

function normalizeCitations(rawAnnotations: unknown): VisibilityCitationSource[] {
  if (!Array.isArray(rawAnnotations)) return [];
  const citations: VisibilityCitationSource[] = [];
  const seen = new Set<string>();

  for (const annotation of rawAnnotations) {
    const value = record(annotation);
    if (!value || value.type !== 'url_citation') continue;
    const url = stringValue(value.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      url,
      title: stringValue(value.title),
      position: nonNegativeInteger(value.index),
      sourceType: 'tencent_tokenhub_url_citation'
    });
  }

  return citations;
}

function evidenceState(
  annotationsObserved: boolean,
  citations: VisibilityCitationSource[]
): CitationEvidenceState {
  if (citations.length > 0) return 'KNOWN_PRESENT';
  if (annotationsObserved) return 'KNOWN_EMPTY';
  return 'UNKNOWN';
}

function normalizeUsage(value: unknown, explicitSearchCalls: number) {
  const usage = record(value);
  const toolUsage = record(usage?.tool_usage);
  const upstreamSearchUnits = nonNegativeInteger(toolUsage?.web_search_call);
  return {
    promptTokens: nonNegativeInteger(usage?.prompt_tokens),
    completionTokens: nonNegativeInteger(usage?.completion_tokens),
    totalTokens: nonNegativeInteger(usage?.total_tokens),
    searchUnits: upstreamSearchUnits ?? (explicitSearchCalls > 0 ? explicitSearchCalls : null)
  };
}

export class TencentHunyuanVisibilityProvider implements VisibilityProviderAdapter {
  readonly provider = 'TENCENT_HUNYUAN' as const;
  readonly channel = 'API' as const;
  readonly capabilities = ['WEB_GROUNDED', 'CITATION_NATIVE'] as const;

  private readonly apiKey: string;
  private readonly transport: TencentHunyuanVisibilityTransport;

  constructor(options: { apiKey?: string; transport?: TencentHunyuanVisibilityTransport } = {}) {
    this.apiKey = options.apiKey ?? process.env.TENCENT_TOKENHUB_API_KEY ?? '';
    this.transport = options.transport ?? new FetchTencentHunyuanVisibilityTransport();
  }

  supportsWebGrounding(mode: VisibilityGroundingMode) { return mode === 'WEB_SEARCH'; }
  estimateCostMicros(_request: VisibilitySampleRequest): number | null { return null; }

  async sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    if (!this.apiKey.trim()) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_AUTH_FAILED',
        'Tencent TokenHub API key is not configured',
        { retryable: false }
      );
    }
    if (!this.supportsWebGrounding(request.groundingMode)) return unsupportedResponse();

    const searchContextSize = resolveSearchContextSize(request.providerOptions);
    let response: TencentHunyuanVisibilityHttpResponse;
    try {
      response = await this.transport.send({
        url: TOKENHUB_RESPONSES_URL,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: {
          model: request.model,
          input: request.prompt,
          tools: [{ type: 'web_search', search_context_size: searchContextSize }]
        }
      });
    } catch (error) {
      if (error instanceof VisibilityProviderError) throw error;
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_FAILED',
        'Tencent TokenHub visibility request failed',
        { retryable: false }
      );
    }

    if (response.status < 200 || response.status >= 300) throw providerHttpError(response.status);

    const body = record(response.body);
    const providerResponseId = stringValue(body?.id);
    const normalized = normalizeOutput(body?.output);
    if (!body || !providerResponseId || !normalized.answerText) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_MALFORMED_RESPONSE',
        'Tencent TokenHub returned a malformed visibility response',
        { httpStatus: response.status, retryable: false }
      );
    }

    const citations = normalizeCitations(normalized.rawAnnotations);
    const usage = normalizeUsage(body.usage, normalized.explicitSearchCalls);

    return {
      status: 'COMPLETED',
      providerResponseId,
      answerText: normalized.answerText,
      citations,
      citationEvidenceState: evidenceState(normalized.annotationsObserved, citations),
      searchMetadata: {
        surface: 'TENCENT_TOKENHUB',
        groundingProvider: 'TOKENHUB_WEB_SEARCH',
        webGroundingEnabled: true,
        requestedModel: request.model
      },
      ...usage,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: response.latencyMs
    };
  }
}
