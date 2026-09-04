import { describe, expect, it } from 'vitest';
import { createIndexNowRuntimeConfig } from '../../src/modules/indexnow/indexnow.config.js';

describe('P9 IndexNow runtime configuration', () => {
  it('is not configured unless both the server-side key and key location are explicit', () => {
    expect(createIndexNowRuntimeConfig({})).toEqual({
      endpoint: 'https://api.indexnow.org/indexnow',
      key: undefined,
      keyLocation: undefined,
      timeoutMs: 15_000,
      configured: false
    });

    expect(createIndexNowRuntimeConfig({ INDEXNOW_KEY: 'key-only' }).configured).toBe(false);
    expect(createIndexNowRuntimeConfig({
      INDEXNOW_KEY_LOCATION: 'https://example.com/key.txt'
    }).configured).toBe(false);
  });

  it('trims explicit credentials and exposes a configured runtime only when complete', () => {
    expect(createIndexNowRuntimeConfig({
      INDEXNOW_KEY: '  test-key  ',
      INDEXNOW_KEY_LOCATION: '  https://example.com/test-key.txt  ',
      INDEXNOW_ENDPOINT: '  https://indexnow.example.test/submit/  ',
      INDEXNOW_TIMEOUT_MS: '23000'
    })).toEqual({
      endpoint: 'https://indexnow.example.test/submit',
      key: 'test-key',
      keyLocation: 'https://example.com/test-key.txt',
      timeoutMs: 23_000,
      configured: true
    });
  });

  it('rejects non-HTTPS endpoints, invalid key locations, and unsafe timeout values', () => {
    expect(() => createIndexNowRuntimeConfig({
      INDEXNOW_ENDPOINT: 'http://indexnow.example.test/submit'
    })).toThrow('IndexNow endpoint must be an HTTPS URL');

    expect(() => createIndexNowRuntimeConfig({
      INDEXNOW_KEY_LOCATION: 'not-a-url'
    })).toThrow('IndexNow key location must be an HTTPS URL');

    expect(() => createIndexNowRuntimeConfig({
      INDEXNOW_TIMEOUT_MS: '0'
    })).toThrow('IndexNow timeout must be between 1000 and 120000 milliseconds');
  });
});
