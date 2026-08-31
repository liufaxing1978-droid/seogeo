import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

describe('P11-02C DataForSEO runtime env contract', () => {
  it('parses optional runtime-only DataForSEO credentials and bounded transport settings', () => {
    const parsed = parseEnv({
      NODE_ENV: 'test',
      DATAFORSEO_LOGIN: 'api-login',
      DATAFORSEO_PASSWORD: 'api-password',
      DATAFORSEO_BASE_URL: 'https://api.dataforseo.com',
      DATAFORSEO_TIMEOUT_MS: '25000',
    }) as unknown as Record<string, unknown>;

    expect(parsed.DATAFORSEO_LOGIN).toBe('api-login');
    expect(parsed.DATAFORSEO_PASSWORD).toBe('api-password');
    expect(parsed.DATAFORSEO_BASE_URL).toBe('https://api.dataforseo.com');
    expect(parsed.DATAFORSEO_TIMEOUT_MS).toBe(25000);
  });

  it('keeps credentials optional and supplies safe transport defaults', () => {
    const parsed = parseEnv({
      NODE_ENV: 'test',
      DATAFORSEO_LOGIN: '   ',
      DATAFORSEO_PASSWORD: '',
    }) as unknown as Record<string, unknown>;

    expect(parsed.DATAFORSEO_LOGIN).toBeUndefined();
    expect(parsed.DATAFORSEO_PASSWORD).toBeUndefined();
    expect(parsed.DATAFORSEO_BASE_URL).toBe('https://api.dataforseo.com');
    expect(parsed.DATAFORSEO_TIMEOUT_MS).toBe(30000);
  });
});
