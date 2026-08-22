import type { CitationEvidenceState, VisibilityGroundingMode } from '@prisma/client';
import {
  VisibilityProviderError,
  type VisibilityCitationSource,
  type VisibilityProviderAdapter,
  type VisibilitySampleRequest,
  type VisibilitySampleResponse
} from './provider.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const SEARCH_CONTEXT_SIZES = new Set(['low', 'medium', 'high']);

export interface OpenAIVisibilityHttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface OpenAIVisibilityHttpResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export interface OpenAIVisibilityTransport {
  send(request: OpenAIVisibilityHttpRequest): Promise<OpenAIVisibilityHttpResponse>;
}

class FetchOpenAIVisibilityTransport implements OpenAIVisibilityTransport {
  async send(request: OpenAIVisibilityHttpRequest): Promise<OpenAIVisibilityHttpResponse> {
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
    promptTokens: nonNegativeInteger(usage?.input_tokens),
    completionTokens: nonNegativeInteger(usage?.output_tokens),
    totalTokens: nonNegativeInteger(usage?.total_tokens)
  };
}

function normalizeCitations(output: unknown[]): VisibilityCitationSource[] {
  const citations: VisibilityCitationSource[] = [];
  const seen = new Set<string>();

  for (const item of output) {
    const itemRecord = record(item);
    if (itemRecord?.type !== 'message' || !Array.isArray(itemRecord.content)) continue;
    for (const content of itemRecord.content) {
      const contentRecord = record(content);
      if (contentRecord?.type !== 'output_text' || !Array.isArray(contentRecord.annotations)) continue;
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

function normalizeWebSearchMetadata(output: unknown[]) {
  const calls: Array<{ id: string | null; status: string | null; sourceUrls: string[] }> = [];

  for (const item of output) {
    const itemRecord = record(item);
    if (itemRecord?.type !== 'web_search_call') continue;
    const action = record(itemRecord.action);
    const sourceUrls: string[] = [];
    const seen = new Set<string>();
    if (Array.isArray(action?.sources)) {
      for (const source of action.sources) {
        const sourceRecord = record(source);
        const url = stringValue(sourceRecord?.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        sourceUrls.push(url);
      }
    }
    calls.push({
      id: stringValue(itemRecord.id),
      status: stringValue(itemRecord.status),
      sourceUrls
    });
  }

  return { webSearchCalls: calls };
}

function citationEvidenceState(output: unknown[], citations: VisibilityCitationSource[]): CitationEvidenceState {
  let sawSearchCall = false;
  let allSourceCollectionsExplicit = true;
  let sourceCount = 0;

  for (const item of output) {
    const itemRecord = record(item);
    if (itemRecord?.type !== 'web_search_call') continue;
    sawSearchCall = true;
    const action = record(itemRecord.action);
    if (!Array.isArray(action?.sources)) {
      allSourceCollectionsExplicit = false;
      continue;
    }
    sourceCount += action.sources.filter((source) => Boolean(stringValue(record(source)?.url))).length;
  }

  if (citations.length > 0 || sourceCount > 0) return 'KNOWN_PRESENT';
  if (sawSearchCall && allSourceCollectionsExplicit) return 'KNOWN_EMPTY';
  return 'UNKNOWN';
}

function normalizeAnswer(output: unknown[]): { status: 'COMPLETED' | 'REFUSED' | 'INCOMPLETE'; answerText: string | null } {
  const texts: string[] = [];
  let refused = false;

  for (const item of output) {
    const itemRecord = record(item);
    if (itemRecord?.type !== 'message' || !Array.isArray(itemRecord.content)) continue;
    for (const content of itemRecord.content) {
      const contentRecord = record(content);
      if (contentRecord?.type === 'refusal') {
        refused = true;
        continue;
      }
      if (contentRecord?.type === 'output_text') {
        const text = stringValue(contentRecord.text);
        if (text) texts.push(text);
      }
    }
  }

  if (refused) return { status: 'REFUSED', answerText: null };
  if (!texts.length) return { status: 'INCOMPLETE', answerText: null };
  return { status: 'COMPLETED', answerText: texts.join('\n') };
}

function providerHttpError(status: number): VisibilityProviderError {
  if (status === 401 || status === 403) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_AUTH_FAILED',
      `OpenAI visibility request failed with HTTP ${status}`,
      { httpStatus: status, retryable: false }
    );
  }
  if (status === 429) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_RATE_LIMITED',
      'OpenAI visibility request was rate limited',
      { httpStatus: status, retryable: false }
    );
  }
  return new VisibilityProviderError(
    'VISIBILITY_PROVIDER_FAILED',
    `OpenAI visibility request failed with HTTP ${status}`,
    { httpStatus: status, retryable: false }
  );
}

function searchContextSize(options: Record<string, unknown>): 'low' | 'medium' | 'high' {
  const value = options.searchContextSize;
  return typeof value === 'string' && SEARCH_CONTEXT_SIZES.has(value)
    ? value as 'low' | 'medium' | 'high'
    : 'medium';
}

export class OpenAIVisibilityProvider implements VisibilityProviderAdapter {
  readonly provider = 'OPENAI' as const;
  readonly channel = 'API' as const;
  readonly capabilities = ['WEB_GROUNDED', 'CITATION_NATIVE'] as const;

  private readonly apiKey: string;
  private readonly transport: OpenAIVisibilityTransport;

  constructor(options: { apiKey?: string; transport?: OpenAIVisibilityTransport } = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.transport = options.transport ?? new FetchOpenAIVisibilityTransport();
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
        'OpenAI API key is not configured',
        { retryable: false }
      );
    }
    if (!this.supportsWebGrounding(request.groundingMode)) {
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

    const webSearchTool: Record<string, unknown> = {
      type: 'web_search',
      search_context_size: searchContextSize(request.providerOptions)
    };
    if (request.country) {
      webSearchTool.user_location = {
        type: 'approximate',
        country: request.country
      };
    }

    let response: OpenAIVisibilityHttpResponse;
    try {
      response = await this.transport.send({
        url: OPENAI_RESPONSES_URL,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: {
          model: request.model,
          input: request.prompt,
          store: false,
          tools: [webSearchTool]
        }
      });
    } catch (error) {
      if (error instanceof VisibilityProviderError) throw error;
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_FAILED',
        'OpenAI visibility request failed',
        { retryable: false }
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw providerHttpError(response.status);
    }

    const body = record(response.body);
    const id = stringValue(body?.id);
    const status = stringValue(body?.status);
    const output = Array.isArray(body?.output) ? body.output : null;
    if (!body || !id || !status || output === null) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_MALFORMED_RESPONSE',
        'OpenAI returned a malformed visibility response',
        { httpStatus: response.status, retryable: false }
      );
    }

    const usage = normalizeUsage(body.usage);
    const searchMetadata = normalizeWebSearchMetadata(output);
    const searchUnits = searchMetadata.webSearchCalls.length;

    if (status === 'incomplete' || status === 'cancelled') {
      return {
        status: 'INCOMPLETE',
        providerResponseId: id,
        answerText: null,
        citations: [],
        citationEvidenceState: 'UNKNOWN',
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
        'OpenAI visibility response did not complete successfully',
        { httpStatus: response.status, retryable: false }
      );
    }

    const normalizedAnswer = normalizeAnswer(output);
    const citations = normalizedAnswer.status === 'COMPLETED' ? normalizeCitations(output) : [];
    return {
      status: normalizedAnswer.status,
      providerResponseId: id,
      answerText: normalizedAnswer.answerText,
      citations,
      citationEvidenceState: normalizedAnswer.status === 'COMPLETED'
        ? citationEvidenceState(output, citations)
        : 'UNKNOWN',
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
