import { describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (hostname: string) => {
    if (hostname === 'public.example') {
      return [{ address: '93.184.216.34', family: 4 }];
    }
    if (hostname === 'mixed.example') {
      return [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ];
    }
    throw new Error(`unexpected DNS lookup: ${hostname}`);
  })
}));

import { assertPublicHttpTarget } from '../../src/modules/crawler/network-policy.js';

describe('assertPublicHttpTarget', () => {
  it.each([
    'http://127.0.0.1/',
    'http://localhost/',
    'http://169.254.169.254/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://192.0.2.1/',
    'http://198.51.100.1/',
    'http://203.0.113.1/'
  ])('rejects non-public targets: %s', async (input) => {
    await expect(assertPublicHttpTarget(new URL(input))).rejects.toThrow(/public|blocked|target/i);
  });

  it('rejects non-http protocols before DNS resolution', async () => {
    await expect(assertPublicHttpTarget(new URL('file:///etc/passwd'))).rejects.toThrow(/http/i);
  });

  it('allows a hostname only when all resolved addresses are public', async () => {
    await expect(assertPublicHttpTarget(new URL('https://public.example/'))).resolves.toBeUndefined();
  });

  it('rejects a hostname if any DNS answer resolves to a blocked address', async () => {
    await expect(assertPublicHttpTarget(new URL('https://mixed.example/'))).rejects.toThrow(
      /public|blocked|target/i
    );
  });
});
