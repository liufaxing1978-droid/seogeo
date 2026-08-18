import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';

describe('crawler runtime configuration', () => {
  it('exposes the documented safe defaults', () => {
    expect(env.CRAWLER_USER_AGENT).toBe('SEOGEO-Bot/0.1 (+https://seo.xingshantang.org)');
    expect(env.CRAWLER_MAX_PAGES).toBe(500);
    expect(env.CRAWLER_CONCURRENCY).toBe(4);
    expect(env.CRAWLER_REQUEST_TIMEOUT_MS).toBe(15000);
    expect(env.CRAWLER_MAX_RESPONSE_BYTES).toBe(5000000);
    expect(env.CRAWLER_BROWSER_ENABLED).toBe(false);
  });
});
