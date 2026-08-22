import type { CitationEvidenceState, VisibilityGroundingMode } from '@prisma/client';
import {
  VisibilityProviderError,
  type VisibilityCitationSource,
  type VisibilityProviderAdapter,
  type VisibilitySampleRequest,
  type VisibilitySampleResponse
} from './provider.js';

const MICROSOFT_WORK_IQ_BASE_URL = 'https://workiq.svc.cloud.microsoft/rest';

export interface MicrosoftVisibilityHttpRequest {
  url: string;
  method: 'POST';
  body: Record<string, unknown>;
}

export interface MicrosoftVisibilityHttpResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export interface MicrosoftVisibilityTransport {
  send(
    request: MicrosoftVisibilityHttpRequest,
    accessToken: string
  ): Promise<MicrosoftVisibilityHttpResponse>;
}

class FetchMicrosoftVisibilityTransport implements MicrosoftVisibilityTransport {
  async send(
    request: MicrosoftVisibilityHttpRequest,
    accessToken: string
  ): Promise<MicrosoftVisibilityHttpResponse> {
    const startedAt = Date.now();
    const response = await fetch(request.url, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
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
      `Microsoft Work IQ visibility request failed with HTTP ${status}`,
      { httpStatus: status, retryable: false }
    );
  }
  if (status === 429) {
    return new VisibilityProviderError(
      'VISIBILITY_PROVIDER_RATE_LIMITED',
      'Microsoft Work IQ visibility request was rate limited',
      { httpStatus: status, retryable: false }
    );
  }
  return new VisibilityProviderError(
    'VISIBILITY_PROVIDER_FAILED',
    `Microsoft Work IQ visibility request failed with HTTP ${status}`,
    { httpStatus: status, retryable: false }
  );
}

function normalizeCitations(attributions: unknown[]): VisibilityCitationSource[] {
  const citations: VisibilityCitationSource[] = [];
  const seen = new Set<string>();

  for (const attribution of attributions) {
    const value = record(attribution);
    if (value?.attributionType !== 'citation') continue;
    const url = stringValue(value.seeMoreWebUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      url,
      title: stringValue(value.providerDisplayName),
      position: null,
      sourceType: 'microsoft_attribution'
    });
  }

  return citations;
}

function evidenceState(
  rawAttributions: unknown,
  citations: VisibilityCitationSource[]
): CitationEvidenceState {
  if (citations.length > 0) return 'KNOWN_PRESENT';
  if (Array.isArray(rawAttributions) && rawAttributions.length === 0) return 'KNOWN_EMPTY';
  return 'UNKNOWN';
}

function timeZone(options: Record<string, unknown>): string {
  const value = options.timeZone;
  return typeof value === 'string' && value.trim().length > 0 ? value : 'UTC';
}

export class MicrosoftVisibilityProvider implements VisibilityProviderAdapter {
  readonly provider = 'MICROSOFT' as const;
  readonly channel = 'API' as const;
  readonly capabilities = ['WEB_GROUNDED', 'CITATION_NATIVE'] as const;

  private readonly accessToken: string;
  private readonly transport: MicrosoftVisibilityTransport;

  constructor(options: { accessToken?: string; transport?: MicrosoftVisibilityTransport } = {}) {
    this.accessToken = options.accessToken ?? process.env.MICROSOFT_WORK_IQ_ACCESS_TOKEN ?? '';
    this.transport = options.transport ?? new FetchMicrosoftVisibilityTransport();
  }

  supportsWebGrounding(mode: VisibilityGroundingMode) {
    return mode === 'WEB_SEARCH';
  }

  estimateCostMicros(_request: VisibilitySampleRequest): number | null {
    return null;
  }

  async sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    if (!this.accessToken.trim()) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_AUTH_FAILED',
        'Microsoft Work IQ delegated access token is not configured',
        { retryable: false }
      );
    }

    if (!this.supportsWebGrounding(request.groundingMode)) {
      return unsupportedResponse();
    }

    let createResponse: MicrosoftVisibilityHttpResponse;
    try {
      createResponse = await this.transport.send({
        url: `${MICROSOFT_WORK_IQ_BASE_URL}/conversations`,
        method: 'POST',
        body: {}
      }, this.accessToken);
    } catch (error) {
      if (error instanceof VisibilityProviderError) throw error;
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_FAILED',
        'Microsoft Work IQ visibility request failed',
        { retryable: false }
      );
    }

    if (createResponse.status < 200 || createResponse.status >= 300) {
      throw providerHttpError(createResponse.status);
    }

    const createBody = record(createResponse.body);
    const conversationId = stringValue(createBody?.id);
    if (!conversationId) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_MALFORMED_RESPONSE',
        'Microsoft Work IQ returned a malformed conversation response',
        { httpStatus: createResponse.status, retryable: false }
      );
    }

    let chatResponse: MicrosoftVisibilityHttpResponse;
    try {
      chatResponse = await this.transport.send({
        url: `${MICROSOFT_WORK_IQ_BASE_URL}/conversations/${encodeURIComponent(conversationId)}/chat`,
        method: 'POST',
        body: {
          message: { text: request.prompt },
          locationHint: { timeZone: timeZone(request.providerOptions) },
          contextualResources: {
            webContext: { isWebEnabled: true }
          }
        }
      }, this.accessToken);
    } catch (error) {
      if (error instanceof VisibilityProviderError) throw error;
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_FAILED',
        'Microsoft Work IQ visibility request failed',
        { retryable: false }
      );
    }

    if (chatResponse.status < 200 || chatResponse.status >= 300) {
      throw providerHttpError(chatResponse.status);
    }

    const chatBody = record(chatResponse.body);
    const messages = Array.isArray(chatBody?.messages) ? chatBody.messages : null;
    if (!chatBody || !messages || messages.length === 0) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_MALFORMED_RESPONSE',
        'Microsoft Work IQ returned a malformed chat response',
        { httpStatus: chatResponse.status, retryable: false }
      );
    }

    const assistantMessage = record(messages[messages.length - 1]);
    const answerText = stringValue(assistantMessage?.text);
    if (!assistantMessage || !answerText) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_MALFORMED_RESPONSE',
        'Microsoft Work IQ returned a chat response without answer text',
        { httpStatus: chatResponse.status, retryable: false }
      );
    }

    const rawAttributions = assistantMessage.attributions;
    const attributions = Array.isArray(rawAttributions) ? rawAttributions : [];
    const citations = normalizeCitations(attributions);

    return {
      status: 'COMPLETED',
      providerResponseId: conversationId,
      answerText,
      citations,
      citationEvidenceState: evidenceState(rawAttributions, citations),
      searchMetadata: {
        surface: 'MICROSOFT_365_COPILOT_WORK_IQ',
        groundingProvider: 'BING_WEB_SEARCH',
        webGroundingEnabled: true,
        requestedModel: request.model
      },
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      searchUnits: null,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: createResponse.latencyMs + chatResponse.latencyMs
    };
  }
}
