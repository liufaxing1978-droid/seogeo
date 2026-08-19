import type { VisibilityGroundingMode } from '@prisma/client';
import {
  VisibilityProviderError,
  type VisibilityCitationSource,
  type VisibilityProviderAdapter,
  type VisibilitySampleRequest,
  type VisibilitySampleResponse
} from './provider.js';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicVisibilityHttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface AnthropicVisibilityHttpResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export interface AnthropicVisibilityTransport {
  send(request: AnthropicVisibilityHttpRequest): Promise<AnthropicVisibilityHttpResponse>;
}

class FetchAnthropicVisibilityTransport implements AnthropicVisibilityTransport {
  async send(request: AnthropicVisibilityHttpRequest): Promise<AnthropicVisibilityHttpResponse> {
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
  const inputTokens = nonNegativeInteger(usage?.input_tokens);
  const outputTokens = nonNegativeInteger(usage?.output_tokens);
  const serverToolUse = record(usage?.server_tool_use);
  return {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    searchUnits: nonNegativeInteger(serverToolUse?.web_search_requests)
  };
}

function normalizeAnswer(content: unknown[]): string | null {
  const texts: string[] = [];
  for (const block of content) {
    const blockRecord = record(block);
    if (blockRecord?.type !== 'text') continue;
    const text = stringValue(blockRecord.text);
    if (text) texts.push(text);
  }
  return texts.length ? texts.join('\n') : null;
}

function normalizeCitations(content: unknown[]): VisibilityCitationSource[] {
  const citations: VisibilityCitationSource[] = [];
  const seen = new Set<string>();

  for (const block of content) {
    const blockRecord = record(block);
    if (blockRecord?.type !== 'text' || !Array.isArray(blockRecord.citations)) continue;
    for (const citation of blockRecord.citations) {
      const citationRecord = record(citation);
      if (citationRecord?.type !== 'web_search_result_location') continue;
      const url = stringValue(citationRecord.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      citations.push({
        url,
        title: stringValue(citationRecord.title),
        position: citations.length + 1,
        sourceType: 'web_search_result_location'
      });
    }
  }

  return citations;
}

function normalizeSearchMetadata(content: unknown[]) {
  const results: Array<{ toolUseId: string | null; sourceUrls: string[] }> = [];

  for (const block of content) {
    const blockRecord = record(block);
    if (blockRecord?.type !== 'web_search_tool_result' || !Array.isArray(blockRecord.content)) continue;
    const sourceUrls: string[] = [];
    const seen = new Set<string>();
    for (const source of blockRecord.content) {
      const sourceRecord = record(source);
      if (sourceRecord?.type !== 'web_search_result') continue;
      const url = stringValue(sourceRecord.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sourceUrls.push(url);
    }
    results.push({
      toolUseId: stringValue(blockRecord.tool_use_id),
      sourceUrls
    });
  }

  return { webSearchResults: results };
}

function providerHttpError(status: number): VisibilityProviderError {
  if (status === 401 || status === 403) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_AUTH_FAILED',
      `Anthropic visibility request failed with HTTP ${status}`,
      { httpStatus: status, retryable: false }
    );
  }
  if (status === 429) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_RATE_LIMITED',
      'Anthropic visibility request was rate limited',
      { httpStatus: status, retryable: false }
    );
  }
  return new VisibilityProviderError(
    'VISIBILITY_PROVIDER_FAILED',
    `Anthropic visibility request failed with HTTP ${status}`,
    { httpStatus: status, retryable: false }
  );
}

function maxUses(options: Record<string, unknown>): number {
  const value = options.maxUses;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20
    ? value
    : 3;
}

export class AnthropicVisibilityProvider implements VisibilityProviderAdapter {
  readonly provider = 'ANTHROPIC' as const;
  readonly channel = 'API' as const;

  private readonly apiKey: string;
  private readonly transport: AnthropicVisibilityTransport;

  constructor(options: { apiKey?: string; transport?: AnthropicVisibilityTransport } = {}) {
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    this.transport = options.transport ?? new FetchAnthropicVisibilityTransport();
  }

  supportsWebGrounding(mode: VisibilityGroundingMode) {
    return mode === 'WEB_SEARCH_TOOL';
  }

  estimateCostMicros(_request: VisibilitySampleRequest): number | null {
    return null;
  }

  async sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    if (!this.apiKey.trim()) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_AUTH_FAILED',
        'Anthropic API key is not configured',
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

    let response: AnthropicVisibilityHttpResponse;
    try {
      response = await this.transport.send({
        url: ANTHROPIC_MESSAGES_URL,
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json'
        },
        body: {
          model: request.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: request.prompt }],
          tools: [{
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: maxUses(request.providerOptions)
          }]
        }
      });
    } catch (error) {
      if (error instanceof VisibilityProviderError) throw error;
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_FAILED',
        'Anthropic visibility request failed',
        { retryable: false }
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw providerHttpError(response.status);
    }

    const body = record(response.body);
    const id = stringValue(body?.id);
    const content = Array.isArray(body?.content) ? body.content : null;
    const stopReason = stringValue(body?.stop_reason);
    if (!body || !id || content === null || !stopReason) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_MALFORMED_RESPONSE',
        'Anthropic returned a malformed visibility response',
        { httpStatus: response.status, retryable: false }
      );
    }

    const usage = normalizeUsage(body.usage);
    const searchMetadata = normalizeSearchMetadata(content);

    if (stopReason === 'refusal') {
      return {
        status: 'REFUSED',
        providerResponseId: id,
        answerText: null,
        citations: [],
        searchMetadata,
        ...usage,
        costMicros: null,
        costCurrency: null,
        pricingVersion: null,
        latencyMs: response.latencyMs
      };
    }
    if (stopReason === 'pause_turn' || stopReason === 'max_tokens') {
      return {
        status: 'INCOMPLETE',
        providerResponseId: id,
        answerText: null,
        citations: [],
        searchMetadata,
        ...usage,
        costMicros: null,
        costCurrency: null,
        pricingVersion: null,
        latencyMs: response.latencyMs
      };
    }
    if (stopReason !== 'end_turn' && stopReason !== 'stop_sequence') {
      return {
        status: 'INCOMPLETE',
        providerResponseId: id,
        answerText: null,
        citations: [],
        searchMetadata,
        ...usage,
        costMicros: null,
        costCurrency: null,
        pricingVersion: null,
        latencyMs: response.latencyMs
      };
    }

    const answerText = normalizeAnswer(content);
    return {
      status: answerText ? 'COMPLETED' : 'INCOMPLETE',
      providerResponseId: id,
      answerText,
      citations: answerText ? normalizeCitations(content) : [],
      searchMetadata,
      ...usage,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: response.latencyMs
    };
  }
}
