import { describe, expect, it, vi } from 'vitest';
import {
  IndexNowGatewayError,
  IndexNowHttpGateway
} from '../../src/modules/indexnow/indexnow.gateway.js';

const submission = {
  host: 'example.com',
  key: 'server-side-key',
  keyLocation: 'https://example.com/server-side-key.txt',
  urlList: ['https://example.com/guide', 'https://example.com/about']
};

describe('P9 IndexNow HTTP gateway', () => {
  it.each([200, 202])('submits the exact JSON contract and accepts HTTP %i', async (statusCode) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: statusCode }));
    const gateway = new IndexNowHttpGateway({
      endpoint: 'https://indexnow.example.test/indexnow',
      timeoutMs: 15_000,
      fetchImpl
    });

    await expect(gateway.submit(submission)).resolves.toEqual({
      accepted: true,
      statusCode,
      retryable: false
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://indexnow.example.test/indexnow');
    expect(request).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(submission)
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [400, false],
    [403, false],
    [422, false],
    [429, true],
    [500, true],
    [503, true]
  ])('classifies HTTP %i without persisting or exposing a response body', async (statusCode, retryable) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('provider-secret-detail', { status: statusCode }));
    const gateway = new IndexNowHttpGateway({
      endpoint: 'https://indexnow.example.test/indexnow',
      timeoutMs: 15_000,
      fetchImpl
    });

    await expect(gateway.submit(submission)).resolves.toEqual({
      accepted: false,
      statusCode,
      retryable
    });
  });

  it('maps a transport failure to a stable retryable error without leaking its message', async () => {
    const gateway = new IndexNowHttpGateway({
      endpoint: 'https://indexnow.example.test/indexnow',
      timeoutMs: 15_000,
      fetchImpl: vi.fn<typeof fetch>(async () => { throw new Error('socket failed with secret=abc'); })
    });

    await expect(gateway.submit(submission)).rejects.toEqual(expect.objectContaining({
      name: 'IndexNowGatewayError',
      code: 'INDEXNOW_NETWORK_ERROR',
      message: 'IndexNow request failed',
      retryable: true
    } satisfies Partial<IndexNowGatewayError>));
  });
});
