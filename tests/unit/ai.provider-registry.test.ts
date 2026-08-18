import { describe, expect, it, vi } from 'vitest';
import { AiGateway } from '../../src/modules/ai/ai.gateway.js';
import { AiProviderRegistry } from '../../src/modules/ai/provider-registry.js';
import type { AiProvider } from '../../src/modules/ai/provider.js';

function createProvider(): AiProvider {
  return {
    name: 'DEEPSEEK',
    complete: vi.fn(async (request) => ({
      provider: 'DEEPSEEK',
      model: request.model,
      responseId: 'fixture-response',
      content: '{"ok":true}',
      finishReason: 'stop',
      latencyMs: 12,
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cacheHitTokens: 0,
        cacheMissTokens: 10,
        reasoningTokens: request.mode === 'REASONING' ? 3 : null
      }
    }))
  };
}

describe('P4 provider registry and AI Gateway', () => {
  it('rejects duplicate providers and resolves DeepSeek through the registry', () => {
    const provider = createProvider();
    const registry = new AiProviderRegistry([provider]);

    expect(registry.get('DEEPSEEK')).toBe(provider);
    expect(() => new AiProviderRegistry([provider, provider])).toThrow(/duplicate/i);
  });

  it('routes FAST and REASONING modes to configured models without exposing provider details to callers', async () => {
    const provider = createProvider();
    const gateway = new AiGateway(
      new AiProviderRegistry([provider]),
      {
        apiKey: undefined,
        baseUrl: 'https://api.deepseek.com',
        fastModel: 'configured-fast-model',
        reasoningModel: 'configured-reasoning-model',
        timeoutMs: 180000,
        maxInputChars: 200000,
        maxOutputTokens: 8192
      }
    );

    const fast = await gateway.complete({
      messages: [{ role: 'user', content: 'Return JSON.' }],
      mode: 'FAST',
      responseFormat: 'JSON'
    });
    const reasoning = await gateway.complete({
      messages: [{ role: 'user', content: 'Return JSON.' }],
      mode: 'REASONING',
      responseFormat: 'JSON',
      maxOutputTokens: 4096
    });

    expect(fast.model).toBe('configured-fast-model');
    expect(reasoning.model).toBe('configured-reasoning-model');
    expect(provider.complete).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: 'configured-fast-model', mode: 'FAST', maxOutputTokens: 8192 })
    );
    expect(provider.complete).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'configured-reasoning-model', mode: 'REASONING', maxOutputTokens: 4096 })
    );
  });
});
