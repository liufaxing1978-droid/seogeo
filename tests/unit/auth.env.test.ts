import { afterEach, describe, expect, it, vi } from 'vitest';

const originalNodeEnv = process.env.NODE_ENV;
const originalSessionSecret = process.env.SESSION_SECRET;

async function loadEnvModule() {
  vi.resetModules();
  return import('../../src/config/env.js');
}

function restoreEnv() {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
}

afterEach(() => {
  restoreEnv();
  vi.resetModules();
});

describe('production SESSION_SECRET contract', () => {
  it('rejects a production secret shorter than 32 characters', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'short';

    await expect(loadEnvModule()).rejects.toThrow(
      'SESSION_SECRET must be at least 32 characters in production',
    );
  });

  it('accepts a 32-character production secret', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 's'.repeat(32);

    const { env } = await loadEnvModule();
    expect(env.SESSION_SECRET).toBe('s'.repeat(32));
  });
});
