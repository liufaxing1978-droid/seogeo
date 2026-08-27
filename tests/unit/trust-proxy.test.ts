import { afterEach, describe, expect, it, vi } from 'vitest';

const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS;

function restoreTrustProxyHops() {
  if (originalTrustProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
  else process.env.TRUST_PROXY_HOPS = originalTrustProxyHops;
}

afterEach(() => {
  restoreTrustProxyHops();
  vi.resetModules();
});

describe('trusted proxy runtime configuration', () => {
  it('keeps forwarded headers untrusted at zero hops', async () => {
    process.env.TRUST_PROXY_HOPS = '0';
    vi.resetModules();

    const { createApp } = await import('../../src/app.js');
    const app = createApp();

    expect(app.get('trust proxy')).toBe(false);
  });

  it('trusts exactly the configured proxy hop count', async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    vi.resetModules();

    const { createApp } = await import('../../src/app.js');
    const app = createApp();

    expect(app.get('trust proxy')).toBe(1);
  });
});
