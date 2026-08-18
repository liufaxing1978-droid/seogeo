import { describe, expect, it } from 'vitest';
import { createAiGatewayConfig } from '../../src/modules/ai/ai.config.js';

describe('P4 AI Gateway configuration', () => {
  it('uses current DeepSeek V4 defaults and keeps the API key optional', () => {
    const config = createAiGatewayConfig({});

    expect(config.apiKey).toBeUndefined();
    expect(config.baseUrl).toBe('https://api.deepseek.com');
    expect(config.fastModel).toBe('deepseek-v4-flash');
    expect(config.reasoningModel).toBe('deepseek-v4-pro');
    expect(config.timeoutMs).toBe(180_000);
    expect(config.maxInputChars).toBe(200_000);
    expect(config.maxOutputTokens).toBe(8192);
  });

  it('accepts explicit provider routing overrides without exposing legacy model assumptions', () => {
    const config = createAiGatewayConfig({
      DEEPSEEK_API_KEY: 'server-only-fixture',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.example',
      DEEPSEEK_FAST_MODEL: 'future-fast-model',
      DEEPSEEK_REASONING_MODEL: 'future-reasoning-model',
      DEEPSEEK_TIMEOUT_MS: '120000',
      AI_MAX_INPUT_CHARS: '150000',
      AI_MAX_OUTPUT_TOKENS: '4096'
    });

    expect(config).toMatchObject({
      apiKey: 'server-only-fixture',
      baseUrl: 'https://api.deepseek.example',
      fastModel: 'future-fast-model',
      reasoningModel: 'future-reasoning-model',
      timeoutMs: 120_000,
      maxInputChars: 150_000,
      maxOutputTokens: 4096
    });
    expect(config.fastModel).not.toMatch(/deepseek-chat|deepseek-reasoner/);
    expect(config.reasoningModel).not.toMatch(/deepseek-chat|deepseek-reasoner/);
  });

  it('treats a blank API key as not configured', () => {
    expect(createAiGatewayConfig({ DEEPSEEK_API_KEY: '   ' }).apiKey).toBeUndefined();
  });
});
