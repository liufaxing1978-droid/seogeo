import { env } from '../../config/env.js';

export interface AiGatewayConfig {
  apiKey: string | undefined;
  baseUrl: string;
  fastModel: string;
  reasoningModel: string;
  timeoutMs: number;
  maxInputChars: number;
  maxOutputTokens: number;
}

export interface AiConfigSource {
  DEEPSEEK_API_KEY?: string | undefined;
  DEEPSEEK_BASE_URL?: string | undefined;
  DEEPSEEK_FAST_MODEL?: string | undefined;
  DEEPSEEK_REASONING_MODEL?: string | undefined;
  DEEPSEEK_TIMEOUT_MS?: string | number | undefined;
  AI_MAX_INPUT_CHARS?: string | number | undefined;
  AI_MAX_OUTPUT_TOKENS?: string | number | undefined;
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function readPositiveInt(
  value: string | number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`AI configuration integer must be between ${min} and ${max}`);
  }
  return parsed;
}

export function createAiGatewayConfig(source: AiConfigSource): AiGatewayConfig {
  return {
    apiKey: cleanOptional(source.DEEPSEEK_API_KEY),
    baseUrl: cleanOptional(source.DEEPSEEK_BASE_URL)?.replace(/\/+$/, '') ?? 'https://api.deepseek.com',
    fastModel: cleanOptional(source.DEEPSEEK_FAST_MODEL) ?? 'deepseek-v4-flash',
    reasoningModel: cleanOptional(source.DEEPSEEK_REASONING_MODEL) ?? 'deepseek-v4-pro',
    timeoutMs: readPositiveInt(source.DEEPSEEK_TIMEOUT_MS, 180_000, 1_000, 600_000),
    maxInputChars: readPositiveInt(source.AI_MAX_INPUT_CHARS, 200_000, 1_000, 2_000_000),
    maxOutputTokens: readPositiveInt(source.AI_MAX_OUTPUT_TOKENS, 8_192, 1, 65_536)
  };
}

export const aiGatewayConfig = createAiGatewayConfig({
  DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: env.DEEPSEEK_BASE_URL,
  DEEPSEEK_FAST_MODEL: env.DEEPSEEK_FAST_MODEL,
  DEEPSEEK_REASONING_MODEL: env.DEEPSEEK_REASONING_MODEL,
  DEEPSEEK_TIMEOUT_MS: env.DEEPSEEK_TIMEOUT_MS,
  AI_MAX_INPUT_CHARS: env.AI_MAX_INPUT_CHARS,
  AI_MAX_OUTPUT_TOKENS: env.AI_MAX_OUTPUT_TOKENS
});
