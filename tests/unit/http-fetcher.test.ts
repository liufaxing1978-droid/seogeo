import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { fetchPage } from '../../src/modules/crawler/http-fetcher.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case '/html':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'all' });
        res.end('<html><title>Hello</title><body>ok</body></html>');
        return;
      case '/redirect':
        res.writeHead(301, { location: '/html' });
        res.end();
        return;
      case '/loop-a':
        res.writeHead(302, { location: '/loop-b' });
        res.end();
        return;
      case '/loop-b':
        res.writeHead(302, { location: '/loop-a' });
        res.end();
        return;
      case '/slow':
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html>late</html>');
        }, 150);
        return;
      case '/large':
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('x'.repeat(4096));
        return;
      case '/image':
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': '4' });
        res.end(Buffer.from([1, 2, 3, 4]));
        return;
      case '/error':
        res.writeHead(500, { 'content-type': 'text/html' });
        res.end('<html><body>failure</body></html>');
        return;
      default:
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

const allowTestTarget = async () => undefined;

describe('fetchPage', () => {
  it('returns a bounded HTML response with normalized lowercase headers', async () => {
    const result = await fetchPage(`${baseUrl}/html`, { publicTargetGuard: allowTestTarget });

    expect(result.statusCode).toBe(200);
    expect(result.finalUrl).toBe(`${baseUrl}/html`);
    expect(result.contentType).toContain('text/html');
    expect(result.body).toContain('<title>Hello</title>');
    expect(result.headers['x-robots-tag']).toBe('all');
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.redirectChain).toEqual([]);
    expect(result.errorCode).toBeNull();
  });

  it('tracks redirects and validates every target before following it', async () => {
    const guarded: string[] = [];
    const result = await fetchPage(`${baseUrl}/redirect`, {
      publicTargetGuard: async (url) => {
        guarded.push(url.toString());
      }
    });

    expect(result.statusCode).toBe(200);
    expect(result.finalUrl).toBe(`${baseUrl}/html`);
    expect(result.redirectChain).toEqual([
      { from: `${baseUrl}/redirect`, to: `${baseUrl}/html`, statusCode: 301 }
    ]);
    expect(guarded).toEqual([`${baseUrl}/redirect`, `${baseUrl}/html`]);
  });

  it('stops a redirect loop at the configured redirect limit', async () => {
    const result = await fetchPage(`${baseUrl}/loop-a`, {
      publicTargetGuard: allowTestTarget,
      maxRedirects: 2
    });

    expect(result.errorCode).toBe('MAX_REDIRECTS');
    expect(result.redirectChain).toHaveLength(2);
    expect(result.body).toBeNull();
  });

  it('returns a timeout error instead of hanging', async () => {
    const result = await fetchPage(`${baseUrl}/slow`, {
      publicTargetGuard: allowTestTarget,
      requestTimeoutMs: 30
    });

    expect(result.statusCode).toBe(0);
    expect(result.errorCode).toBe('TIMEOUT');
    expect(result.body).toBeNull();
  });

  it('aborts and discards an oversized body', async () => {
    const result = await fetchPage(`${baseUrl}/large`, {
      publicTargetGuard: allowTestTarget,
      maxResponseBytes: 512
    });

    expect(result.statusCode).toBe(200);
    expect(result.errorCode).toBe('RESPONSE_TOO_LARGE');
    expect(result.body).toBeNull();
    expect(result.bytes).toBeGreaterThan(512);
  });

  it('does not retain a binary non-HTML response body', async () => {
    const result = await fetchPage(`${baseUrl}/image`, { publicTargetGuard: allowTestTarget });

    expect(result.statusCode).toBe(200);
    expect(result.contentType).toBe('image/png');
    expect(result.body).toBeNull();
    expect(result.bytes).toBe(4);
    expect(result.errorCode).toBeNull();
  });

  it('preserves factual 500 status and HTML body', async () => {
    const result = await fetchPage(`${baseUrl}/error`, { publicTargetGuard: allowTestTarget });

    expect(result.statusCode).toBe(500);
    expect(result.body).toContain('failure');
    expect(result.errorCode).toBeNull();
  });
});
