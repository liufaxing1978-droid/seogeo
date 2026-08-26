import { afterEach, describe, expect, it, vi } from 'vitest';

const originalNodeEnv = process.env.NODE_ENV;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalRedisUrl = process.env.REDIS_URL;
const originalSessionSecret = process.env.SESSION_SECRET;
const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS;

async function loadEnvModule() {
  vi.resetModules();
  return import('../../src/config/env.js');
}

function restoreValue(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function restoreEnv() {
  restoreValue('NODE_ENV', originalNodeEnv);
  restoreValue('DATABASE_URL', originalDatabaseUrl);
  restoreValue('REDIS_URL', originalRedisUrl);
  restoreValue('SESSION_SECRET', originalSessionSecret);
  restoreValue('TRUST_PROXY_HOPS', originalTrustProxyHops);
}

afterEach(() => {
  restoreEnv();
  vi.resetModules();
});

describe('production runtime environment contract', () => {
  it('rejects production when DATABASE_URL is not explicitly configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    process.env.SESSION_SECRET = 's'.repeat(32);

    await expect(loadEnvModule()).rejects.toThrow(
      'DATABASE_URL is required in production',
    );
  });

  it('rejects production when REDIS_URL is not explicitly configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/seogeo';
    delete process.env.REDIS_URL;
    process.env.SESSION_SECRET = 's'.repeat(32);

    await expect(loadEnvModule()).rejects.toThrow(
      'REDIS_URL is required in production',
    );
  });

  it('rejects production when SESSION_SECRET is not explicitly configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/seogeo';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    delete process.env.SESSION_SECRET;

    await expect(loadEnvModule()).rejects.toThrow(
      'SESSION_SECRET is required in production',
    );
  });

  it('rejects a production secret shorter than 32 characters', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/seogeo';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    process.env.SESSION_SECRET = 'short';

    await expect(loadEnvModule()).rejects.toThrow(
      'SESSION_SECRET must be at least 32 characters in production',
    );
  });

  it('accepts explicit production infrastructure values and a 32-character secret', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/seogeo';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    process.env.SESSION_SECRET = 's'.repeat(32);
    process.env.TRUST_PROXY_HOPS = '1';

    const { env } = await loadEnvModule();
    const runtimeEnv = env as unknown as Record<string, unknown>;

    expect(env.DATABASE_URL).toBe('postgresql://postgres:postgres@127.0.0.1:5432/seogeo');
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6379');
    expect(env.SESSION_SECRET).toBe('s'.repeat(32));
    expect(runtimeEnv.TRUST_PROXY_HOPS).toBe(1);
  });
});
