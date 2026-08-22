import type { CitationEvidenceState, VisibilityGroundingMode } from '@prisma/client';
import {
  VisibilityProviderError,
  type VisibilityCitationSource,
  type VisibilityProviderAdapter,
  type VisibilitySampleRequest,
  type VisibilitySampleResponse
} from './provider.js';

const SUPPORTED_REGION = 'cn-beijing';
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export interface QwenVisibilityHttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface QwenVisibilityHttpResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export interface QwenVisibilityTransport {
  send(request: QwenVisibilityHttpRequest): Promise<QwenVisibilityHttpResponse>;
}

class FetchQwenVisibilityTransport implements QwenVisibilityTransport {
  async send(request: QwenVisibilityHttpRequest): Promise<QwenVisibilityHttpResponse> {
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
    status: 'UNSUPPORTED', providerResponseId: null, answerText: null, citations: [],
    citationEvidenceState: 'NOT_APPLICABLE', searchMetadata: {}, promptTokens: null,
    completionTokens: null, totalTokens: null, searchUnits: null, costMicros: null,
    costCurrency: null, pricingVersion: null, latencyMs: null
  };
}

function providerHttpError(status: number): VisibilityProviderError {
  if (status === 401 || status === 403) {
    return new VisibilityProviderError('VISIBILITY_PROVIDER_AUTH_FAILED', `Qwen visibility request failed with HTTP ${status}`, { httpStatus: status, retryable: false });
  }
  if (status === 429) {
    return new VisibilityProviderError('VISIBILITY_PROVIDER_RATE_LIMITED', 'Qwen visibility request was rate limited', { httpStatus: status, retryable: false });
  }
  return new VisibilityProviderError('VISIBILITY_PROVIDER_FAILED', `Qwen visibility request failed with HTTP ${status}`, { httpStatus: status, retryable: false });
}

function answerText(output: Record<string, unknown>): string | null {
  if (!Array.isArray(output.choices)) return null;
  for (const choice of output.choices) {
    const content = stringValue(record(record(choice)?.message)?.content);
    if (content) return content;
  }
  return null;
}

function normalizeCitations(rawResults: unknown): VisibilityCitationSource[] {
  if (!Array.isArray(rawResults)) return [];
  const citations: VisibilityCitationSource[] = [];
  const seen = new Set<string>();
  for (const result of rawResults) {
    const value = record(result);
    const url = stringValue(value?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      url,
      title: stringValue(value?.title),
      position: nonNegativeInteger(value?.index),
      sourceType: 'qwen_search_result'
    });
  }
  return citations;
}

function evidenceState(rawResults: unknown, citations: VisibilityCitationSource[]): CitationEvidenceState {
  if (citations.length > 0) return 'KNOWN_PRESENT';
  if (Array.isArray(rawResults) && rawResults.length === 0) return 'KNOWN_EMPTY';
  return 'UNKNOWN';
}

function normalizeUsage(value: unknown) {
  const usage = record(value);
  return {
    promptTokens: nonNegativeInteger(usage?.input_tokens),
    completionTokens: nonNegativeInteger(usage?.output_tokens),
    totalTokens: nonNegativeInteger(usage?.total_tokens)
  };
}

function resolveWorkspaceOptions(options: Record<string, unknown>) {
  const workspaceId = stringValue(options.workspaceId);
  const region = stringValue(options.region) ?? SUPPORTED_REGION;
  if (!workspaceId || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new VisibilityProviderError('VISIBILITY_PROVIDER_FAILED', 'Qwen workspaceId is missing or invalid', { retryable: false });
  }
  if (region !== SUPPORTED_REGION) {
    throw new VisibilityProviderError('VISIBILITY_PROVIDER_FAILED', 'Qwen region is not supported by this adapter', { retryable: false });
  }
  return { workspaceId, region };
}

export class QwenVisibilityProvider implements VisibilityProviderAdapter {
  readonly provider = 'QWEN' as const;
  readonly channel = 'API' as const;
  readonly capabilities = ['WEB_GROUNDED', 'CITATION_NATIVE'] as const;

  private readonly apiKey: string;
  private readonly transport: QwenVisibilityTransport;

  constructor(options: { apiKey?: string; transport?: QwenVisibilityTransport } = {}) {
    this.apiKey = options.apiKey ?? process.env.DASHSCOPE_API_KEY ?? '';
    this.transport = options.transport ?? new FetchQwenVisibilityTransport();
  }

  supportsWebGrounding(mode: VisibilityGroundingMode) { return mode === 'WEB_SEARCH'; }
  estimateCostMicros(_request: VisibilitySampleRequest): number | null { return null; }

  async sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    if (!this.apiKey.trim()) {
      throw new VisibilityProviderError('VISIBILITY_PROVIDER_AUTH_FAILED', 'DashScope API key is not configured', { retryable: false });
    }
    if (!this.supportsWebGrounding(request.groundingMode)) return unsupportedResponse();

    const { workspaceId, region } = resolveWorkspaceOptions(request.providerOptions);
    let response: QwenVisibilityHttpResponse;
    try {
      response = await this.transport.send({
        url: `https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation`,
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: {
          model: request.model,
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
    } catch (error) {
      if (error instanceof VisibilityProviderError) throw error;
      throw new VisibilityProviderError('VISIBILITY_PROVIDER_FAILED', 'Qwen visibility request failed', { retryable: false });
    }

    if (response.status < 200 || response.status >= 300) throw providerHttpError(response.status);
    const body = record(response.body);
    const providerResponseId = stringValue(body?.request_id);
    const output = record(body?.output);
    const normalizedAnswer = output ? answerText(output) : null;
    if (!body || !providerResponseId || !output || !normalizedAnswer) {
      throw new VisibilityProviderError('VISIBILITY_PROVIDER_MALFORMED_RESPONSE', 'Qwen returned a malformed visibility response', { httpStatus: response.status, retryable: false });
    }

    const searchInfo = record(output.search_info);
    const rawResults = searchInfo?.search_results;
    const citations = normalizeCitations(rawResults);
    const usage = normalizeUsage(body.usage);

    return {
      status: 'COMPLETED',
      providerResponseId,
      answerText: normalizedAnswer,
      citations,
      citationEvidenceState: evidenceState(rawResults, citations),
      searchMetadata: {
        surface: 'ALIBABA_CLOUD_MODEL_STUDIO_DASHSCOPE',
        webGroundingEnabled: true,
        region
      },
      ...usage,
      searchUnits: null,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: response.latencyMs
    };
  }
}
