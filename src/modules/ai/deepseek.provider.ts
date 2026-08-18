import type { AiGatewayConfig } from './ai.config.js';
import type { AiProviderRequest, AiProviderResponse, AiProviderUsage } from './ai.types.js';
import { AiProviderError, type AiProvider, type AiProviderErrorCode } from './provider.js';

export type AiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface DeepSeekProviderDependencies {
  fetchImpl?: AiFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface ErrorClassification {
  code: AiProviderErrorCode;
  retryable: boolean;
}

const MAX_EXPLICIT_RETRIES = 2;
const RETRYABLE_HTTP_STATUSES = new Set([429, 503]);

function classifyHttpStatus(status: number): ErrorClassification {
  switch (status) {
    case 400:
    case 422:
      return { code: 'INVALID_REQUEST', retryable: false };
    case 401:
      return { code: 'AUTH', retryable: false };
    case 402:
      return { code: 'BALANCE', retryable: false };
    case 429:
      return { code: 'RATE_LIMIT', retryable: true };
    case 503:
      return { code: 'OVERLOADED', retryable: true };
    default:
      return status >= 500
        ? { code: 'UPSTREAM', retryable: false }
        : { code: 'INVALID_REQUEST', retryable: false };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function parseUsage(payload: Record<string, unknown>): AiProviderUsage {
  const usage = asRecord(payload.usage) ?? {};
  const completionDetails = asRecord(usage.completion_tokens_details);

  return {
    promptTokens: asTokenCount(usage.prompt_tokens),
    completionTokens: asTokenCount(usage.completion_tokens),
    totalTokens: asTokenCount(usage.total_tokens),
    cacheHitTokens: asTokenCount(usage.prompt_cache_hit_tokens),
    cacheMissTokens: asTokenCount(usage.prompt_cache_miss_tokens),
    reasoningTokens: completionDetails
      ? asTokenCount(completionDetails.reasoning_tokens)
      : null
  };
}

function buildResponse(payload: unknown, request: AiProviderRequest, latencyMs: number): AiProviderResponse {
  const root = asRecord(payload);
  if (!root) {
    throw new AiProviderError('DeepSeek returned a non-object response', 'INVALID_RESPONSE', 'DEEPSEEK', false);
  }

  const firstChoice = asRecord(asArray(root.choices)[0]);
  const message = firstChoice ? asRecord(firstChoice.message) : null;
  const content = message ? asString(message.content) : null;

  if (content === null) {
    throw new AiProviderError('DeepSeek response does not contain final content', 'INVALID_RESPONSE', 'DEEPSEEK', false);
  }
  if (content.trim().length === 0) {
    throw new AiProviderError('DeepSeek returned empty final content', 'EMPTY_RESPONSE', 'DEEPSEEK', false);
  }

  return {
    provider: 'DEEPSEEK',
    model: asString(root.model) ?? request.model,
    responseId: asString(root.id),
    content,
    finishReason: firstChoice ? asString(firstChoice.finish_reason) : null,
    latencyMs,
    usage: parseUsage(root)
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DeepSeekProvider implements AiProvider {
  readonly name = 'DEEPSEEK' as const;

  private readonly fetchImpl: AiFetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly config: AiGatewayConfig,
    dependencies: DeepSeekProviderDependencies = {}
  ) {
    this.fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? defaultSleep;
  }

  async complete(request: AiProviderRequest): Promise<AiProviderResponse> {
    if (!this.config.apiKey) {
      throw new AiProviderError('DeepSeek API key is not configured', 'AUTH', 'DEEPSEEK', false);
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: false,
      max_tokens: request.maxOutputTokens,
      thinking: { type: request.mode === 'REASONING' ? 'enabled' : 'disabled' }
    };

    if (request.mode === 'REASONING') {
      body.reasoning_effort = 'high';
    }
    if (request.responseFormat === 'JSON') {
      body.response_format = { type: 'json_object' };
    }
    if (request.projectUserId) {
      body.user = request.projectUserId;
    }

    const totalAttempts = MAX_EXPLICIT_RETRIES + 1;
    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      const startedAt = this.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        const latencyMs = Math.max(0, this.now() - startedAt);
        if (!response.ok) {
          const classification = classifyHttpStatus(response.status);
          if (RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < totalAttempts) {
            await this.sleep(250 * 2 ** (attempt - 1));
            continue;
          }
          throw new AiProviderError(
            `DeepSeek request failed with HTTP ${response.status}`,
            classification.code,
            'DEEPSEEK',
            classification.retryable,
            response.status
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new AiProviderError('DeepSeek returned invalid JSON', 'INVALID_RESPONSE', 'DEEPSEEK', false, response.status);
        }

        return buildResponse(payload, request, latencyMs);
      } catch (error) {
        if (error instanceof AiProviderError) {
          throw error;
        }

        const isAbort = error instanceof Error && error.name === 'AbortError';
        throw new AiProviderError(
          isAbort ? 'DeepSeek request timed out' : 'DeepSeek network request failed',
          isAbort ? 'TIMEOUT' : 'NETWORK',
          'DEEPSEEK',
          false
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new AiProviderError('DeepSeek request exhausted retry attempts', 'UPSTREAM', 'DEEPSEEK', false);
  }
}
