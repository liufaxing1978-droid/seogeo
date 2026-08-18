import { describe, expect, it, vi } from 'vitest';
import { DeepSeekProvider } from '../../src/modules/ai/deepseek.provider.js';
import { AiProviderError } from '../../src/modules/ai/provider.js';
import type { AiProviderRequest } from '../../src/modules/ai/ai.types.js';

function request(overrides: Partial<AiProviderRequest> = {}): AiProviderRequest {
  return {
    messages: [{ role: 'user', content: 'Return JSON with {"ok":true}.' }],
    model: 'deepseek-v4-flash',
    mode: 'FAST',
    responseFormat: 'JSON',
    maxOutputTokens: 4096,
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function successfulBody(model = 'deepseek-v4-flash') {
  return {
    id: 'ds-fixture-response',
    model,
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: '{"ok":true}',
          reasoning_content: 'private provider reasoning that must not escape'
        }
      }
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_cache_hit_tokens: 70,
      prompt_cache_miss_tokens: 30,
      completion_tokens_details: { reasoning_tokens: 20 }
    }
  };
}

describe('DeepSeekProvider', () => {
  it('maps a FAST JSON request to DeepSeek without exposing reasoning_content', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successfulBody()));
    const provider = new DeepSeekProvider(
      {
        apiKey: 'fixture-key',
        baseUrl: 'https://api.deepseek.com',
        fastModel: 'deepseek-v4-flash',
        reasoningModel: 'deepseek-v4-pro',
        timeoutMs: 5000,
        maxInputChars: 200000,
        maxOutputTokens: 8192
      },
      { fetchImpl, now: () => 1000 }
    );

    const result = await provider.complete(request());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer fixture-key',
      'Content-Type': 'application/json'
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: false,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      max_tokens: 4096
    });
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(result).toEqual({
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-flash',
      responseId: 'ds-fixture-response',
      content: '{"ok":true}',
      finishReason: 'stop',
      latencyMs: 0,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cacheHitTokens: 70,
        cacheMissTokens: 30,
        reasoningTokens: 20
      }
    });
    expect(JSON.stringify(result)).not.toContain('private provider reasoning');
  });

  it('maps REASONING mode to thinking enabled with high reasoning effort', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successfulBody('deepseek-v4-pro')));
    const provider = new DeepSeekProvider(
      {
        apiKey: 'fixture-key',
        baseUrl: 'https://api.deepseek.com',
        fastModel: 'deepseek-v4-flash',
        reasoningModel: 'deepseek-v4-pro',
        timeoutMs: 5000,
        maxInputChars: 200000,
        maxOutputTokens: 8192
      },
      { fetchImpl }
    );

    await provider.complete(request({ model: 'deepseek-v4-pro', mode: 'REASONING', responseFormat: 'TEXT' }));

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      model: 'deepseek-v4-pro',
      thinking: { type: 'enabled' },
      reasoning_effort: 'high'
    });
    expect(body).not.toHaveProperty('response_format');
  });

  it.each([
    [400, 'INVALID_REQUEST', false],
    [401, 'AUTH', false],
    [402, 'BALANCE', false],
    [422, 'INVALID_REQUEST', false],
    [500, 'UPSTREAM', false]
  ] as const)('classifies terminal HTTP %s as %s', async (status, code, retryable) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'upstream detail' } }, status));
    const provider = new DeepSeekProvider(
      {
        apiKey: 'fixture-key',
        baseUrl: 'https://api.deepseek.com',
        fastModel: 'deepseek-v4-flash',
        reasoningModel: 'deepseek-v4-pro',
        timeoutMs: 5000,
        maxInputChars: 200000,
        maxOutputTokens: 8192
      },
      { fetchImpl }
    );

    await expect(provider.complete(request())).rejects.toMatchObject({
      name: 'AiProviderError',
      code,
      httpStatus: status,
      retryable
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, 'RATE_LIMIT'],
    [503, 'OVERLOADED']
  ] as const)('retries explicit HTTP %s at most twice before succeeding', async (status, code) => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'retry me' } }, status))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'retry me again' } }, status))
      .mockResolvedValueOnce(jsonResponse(successfulBody()));
    const provider = new DeepSeekProvider(
      {
        apiKey: 'fixture-key',
        baseUrl: 'https://api.deepseek.com',
        fastModel: 'deepseek-v4-flash',
        reasoningModel: 'deepseek-v4-pro',
        timeoutMs: 5000,
        maxInputChars: 200000,
        maxOutputTokens: 8192
      },
      { fetchImpl, sleep }
    );

    await expect(provider.complete(request())).resolves.toMatchObject({ content: '{"ok":true}' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(code).toMatch(/RATE_LIMIT|OVERLOADED/);
  });

  it('fails safely when the server-side API key is not configured', async () => {
    const fetchImpl = vi.fn();
    const provider = new DeepSeekProvider(
      {
        apiKey: undefined,
        baseUrl: 'https://api.deepseek.com',
        fastModel: 'deepseek-v4-flash',
        reasoningModel: 'deepseek-v4-pro',
        timeoutMs: 5000,
        maxInputChars: 200000,
        maxOutputTokens: 8192
      },
      { fetchImpl }
    );

    await expect(provider.complete(request())).rejects.toBeInstanceOf(AiProviderError);
    await expect(provider.complete(request())).rejects.toMatchObject({ code: 'AUTH', retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not retry an ambiguous timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const provider = new DeepSeekProvider(
      {
        apiKey: 'fixture-key',
        baseUrl: 'https://api.deepseek.com',
        fastModel: 'deepseek-v4-flash',
        reasoningModel: 'deepseek-v4-pro',
        timeoutMs: 10,
        maxInputChars: 200000,
        maxOutputTokens: 8192
      },
      { fetchImpl }
    );

    await expect(provider.complete(request())).rejects.toMatchObject({ code: 'TIMEOUT', retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty final answer instead of inventing content', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ...successfulBody(),
        choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'hidden' } }]
      })
    );
    const provider = new DeepSeekProvider(
      {
        apiKey: 'fixture-key',
        baseUrl: 'https://api.deepseek.com',
        fastModel: 'deepseek-v4-flash',
        reasoningModel: 'deepseek-v4-pro',
        timeoutMs: 5000,
        maxInputChars: 200000,
        maxOutputTokens: 8192
      },
      { fetchImpl }
    );

    await expect(provider.complete(request())).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' });
  });
});
