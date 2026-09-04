import { env } from '../../config/env.js';

export interface IndexNowRuntimeConfig {
  endpoint: string;
  key: string | undefined;
  keyLocation: string | undefined;
  timeoutMs: number;
  configured: boolean;
}

export interface IndexNowConfigSource {
  INDEXNOW_ENDPOINT?: string | undefined;
  INDEXNOW_KEY?: string | undefined;
  INDEXNOW_KEY_LOCATION?: string | undefined;
  INDEXNOW_TIMEOUT_MS?: string | number | undefined;
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function requireHttpsUrl(value: string, field: 'endpoint' | 'key location'): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') throw new Error('invalid protocol');
    return value.replace(/\/+$/, '');
  } catch {
    throw new Error(`IndexNow ${field} must be an HTTPS URL`);
  }
}

function readTimeout(value: string | number | undefined): number {
  if (value === undefined) return 15_000;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    throw new Error('IndexNow timeout must be between 1000 and 120000 milliseconds');
  }
  return parsed;
}

export function createIndexNowRuntimeConfig(source: IndexNowConfigSource): IndexNowRuntimeConfig {
  const key = cleanOptional(source.INDEXNOW_KEY);
  const rawKeyLocation = cleanOptional(source.INDEXNOW_KEY_LOCATION);
  const endpoint = requireHttpsUrl(
    cleanOptional(source.INDEXNOW_ENDPOINT) ?? 'https://api.indexnow.org/indexnow',
    'endpoint'
  );
  const keyLocation = rawKeyLocation === undefined
    ? undefined
    : requireHttpsUrl(rawKeyLocation, 'key location');

  return {
    endpoint,
    key,
    keyLocation,
    timeoutMs: readTimeout(source.INDEXNOW_TIMEOUT_MS),
    configured: key !== undefined && keyLocation !== undefined
  };
}

export const indexNowRuntimeConfig = createIndexNowRuntimeConfig({
  INDEXNOW_ENDPOINT: env.INDEXNOW_ENDPOINT,
  INDEXNOW_KEY: env.INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION: env.INDEXNOW_KEY_LOCATION,
  INDEXNOW_TIMEOUT_MS: env.INDEXNOW_TIMEOUT_MS
});
