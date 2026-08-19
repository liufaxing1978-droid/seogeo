import type { VisibilityGroundingMode } from '@prisma/client';
import {
  VisibilityProviderError,
  type VisibilityCitationSource,
  type VisibilityProviderAdapter,
  type VisibilitySampleRequest,
  type VisibilitySampleResponse
} from './provider.js';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export interface GeminiVisibilityHttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface GeminiVisibilityHttpResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export interface GeminiVisibilityTransport {
  send(request: GeminiVisibilityHttpRequest): Promise<GeminiVisibilityHttpResponse>;
}

class FetchGeminiVisibilityTransport implements GeminiVisibilityTransport {
  async send(request: GeminiVisibilityHttpRequest): Promise<GeminiVisibilityHttpResponse> {
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
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeUsage(value: unknown) {
  const usage = record(value);
  return {
    promptTokens: nonNegativeInteger(usage?.total_input_tokens),
    completionTokens: nonNegativeInteger(usage?.total_output_tokens),
    totalTokens: nonNegativeInteger(usage?.total_tokens)
  };
}

function normalizeAnswer(steps: unknown[]): string | null {
  const texts: string[] = [];
  for (const step of steps) {
    const stepRecord = record(step);
    if (stepRecord?.type !== 'model_output' || !Array.isArray(stepRecord.content)) continue;
    for (const content of stepRecord.content) {
      const contentRecord = record(content);
      if (contentRecord?.type !== 'text') continue;
      const text = stringValue(contentRecord.text);
      if (text) texts.push(text);
    }
  }
  return texts.length ? texts.join('\n') : null;
}

function normalizeCitations(steps: unknown[]): VisibilityCitationSource[] {
  const citations: VisibilityCitationSource[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    const stepRecord = record(step);
    if (stepRecord?.type !== 'model_output' || !Array.isArray(stepRecord.content)) continue;
    for (const content of stepRecord.content) {
      const contentRecord = record(content);
      if (contentRecord?.type !== 'text' || !Array.isArray(contentRecord.annotations)) continue;
      for (const annotation of contentRecord.annotations) {
        const annotationRecord = record(annotation);
        if (annotationRecord?.type !== 'url_citation') continue;
        const url = stringValue(annotationRecord.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        citations.push({
          url,
          title: stringValue(annotationRecord.title),
          position: null,
          sourceType: 'url_citation'
        });
      }
    }
  }

  return citations;
}

function normalizeSearchMetadata(steps: unknown[]) {
  const results: Array<{ callId: string | null; sourceUrls: string[] }> = [];

  for (const step of steps) {
    const stepRecord = record(step);
    if (stepRecord?.type !== 'google_search_result') continue;
    const sourceUrls: string[] = [];
    const seen = new Set<string>();
    if (Array.isArray(stepRecord.result)) {
      for (const item of stepRecord.result) {
        const itemRecord = record(item);
        const url = stringValue(itemRecord?.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        sourceUrls.push(url);
      }
    }
    results.push({
      callId: stringValue(stepRecord.call_id),
      sourceUrls
    });
  }

  return { googleSearchResults: results };
}

function countSearchCalls(steps: unknown[]) {
  return steps.filter((step) => record(step)?.type === 'google_search_call').length;
}

function providerHttpError(status: number): VisibilityProviderError {
  if (status === 401 || status === 403) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_AUTH_FAILED',
      `Gemini visibility request failed with HTTP ${status}`,
      { httpStatus: status, retryable: false }
    );
  }
  if (status === 429) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_RATE_LIMITED',
      'Gemini visibility request was rate limited',
      { httpStatus: status, retryable: false }
    );
  }
  return new VisibilityProviderError(
    'VISIBILITY_PROVIDER_FAILED',
    `Gemini visibility request failed with HTTP ${status}`,
    { httpStatus: status, retryable: false }
  );
}

export class GeminiVisibilityProvider implements VisibilityProviderAdapter {
  readonly provider = 'GEMINI' as const;
  readonly channel = 'API' as const;

  private readonly apiKey: string;
  private readonly transport: GeminiVisibilityTransport;

  constructor(options: { apiKey?: string; transport?: GeminiVisibilityTransport } = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? '';
    this.transport = options.transport ?? new FetchGeminiVisibilityTransport();
  }

  supportsWebGrounding(mode: VisibilityGroundingMode) {
    return mode === 'SEARCH_GROUNDING';
  }

  estimateCostMicros(_request: VisibilitySampleRequest): number | null {
    return null;
  }

  async sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    if (!this.apiKey.trim()) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_AUTH_FAILED',
        'Gemini API key is not configured',
        { retryable: false }
      );
    }
    if (!this.supportsWebGrounding(request.groundingMode)) {
      return {
        status: 'UNSUPPORTED',
        providerResponseId: null,
        answerText: null,
        citations: [],
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

    let response: GeminiVisibilityHttpResponse;
    try {
      response = await this.transport.send({
        url: GEMINI_INTERACTIONS_URL,
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: {
          model: request.model,
          input: request.prompt,
          tools: [{ type: 'google_search' }]
        }
      });
    } catch (error) {
      if (error instanceof VisibilityProviderError) throw error;
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_FAILED',
        'Gemini visibility request failed',
        { retryable: false }
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw providerHttpError(response.status);
    }

    const body = record(response.body);
    const id = stringValue(body?.id);
    const status = stringValue(body?.status);
    const steps = Array.isArray(body?.steps) ? body.steps : null;
    if (!body || !id || !status || steps === null) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_MALFORMED_RESPONSE',
        'Gemini returned a malformed visibility response',
        { httpStatus: response.status, retryable: false }
      );
    }

    const usage = normalizeUsage(body.usage);
    const searchMetadata = normalizeSearchMetadata(steps);
    const searchUnits = countSearchCalls(steps);

    if (status === 'incomplete' || status === 'cancelled') {
      return {
        status: 'INCOMPLETE',
        providerResponseId: id,
        answerText: null,
        citations: [],
        searchMetadata,
        ...usage,
        searchUnits,
        costMicros: null,
        costCurrency: null,
        pricingVersion: null,
        latencyMs: response.latencyMs
      };
    }
    if (status !== 'completed') {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_FAILED',
        'Gemini visibility interaction did not complete successfully',
        { httpStatus: response.status, retryable: false }
      );
    }

    const answerText = normalizeAnswer(steps);
    return {
      status: answerText ? 'COMPLETED' : 'INCOMPLETE',
      providerResponseId: id,
      answerText,
      citations: answerText ? normalizeCitations(steps) : [],
      searchMetadata,
      ...usage,
      searchUnits,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: response.latencyMs
    };
  }
}
