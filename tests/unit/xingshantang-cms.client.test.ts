import { createHmac, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  XingshantangCmsClient,
  XingshantangCmsError,
} from '../../src/modules/publication/xingshantang-cms.client.js';

const config = {
  baseUrl: 'https://xingshantang.org',
  clientId: 'seo-geo-platform',
  secret: 'cms-secret-for-test',
};

const payload = {
  title: '伏英馆是什么？',
  slug: 'fuyingguan',
  section: '六壬文化' as const,
  summary: '六壬伏英馆的文化介绍。',
  body: '# 六壬伏英馆',
};

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('XingshantangCmsClient', () => {
  it('updates only Schema on an existing main-site draft with a signed PUT request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ article: { id: 'main-article-1', status: 'draft' } }, 200));
    const client = new XingshantangCmsClient(config, fetchImpl, { now: () => 1_789_000_000_000, nonce: () => 'nonce-schema' });
    const schemaJson = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] };

    await expect(client.updateDraftSchema({ articleId: 'main-article-1', schemaJson })).resolves.toEqual({ articleId: 'main-article-1', status: 'draft' });

    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    expect(String(rawUrl)).toBe('https://xingshantang.org/api/v1/articles/main-article-1/schema');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ schemaJson }));
  });

  it('accepts a published article response when updating Schema', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      article: { id: 'main-article-published', status: 'published' },
    }, 200));
    const client = new XingshantangCmsClient(config, fetchImpl);
    const schemaJson = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] };

    await expect(client.updateDraftSchema({ articleId: 'main-article-published', schemaJson }))
      .resolves.toEqual({ articleId: 'main-article-published', status: 'published' });
  });

  it('creates a main-site draft with the exact signed payload and never exposes the secret in the URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      article: { id: 'main-article-1', status: 'draft' },
    }));
    const client = new XingshantangCmsClient(config, fetchImpl, {
      now: () => 1_789_000_000_000,
      nonce: () => 'nonce-123',
    });

    await expect(client.createDraft(payload)).resolves.toEqual({
      articleId: 'main-article-1',
      status: 'draft',
    });

    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    expect(String(rawUrl)).toBe('https://xingshantang.org/api/v1/articles');
    expect(String(rawUrl)).not.toContain(config.secret);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({
      ...payload,
      body: '<h2>六壬伏英馆</h2>',
      status: 'draft',
      isPinned: false,
      isRecommended: false,
      membersOnly: false,
    }));

    const body = String(init?.body);
    const canonical = [
      'POST',
      '/api/v1/articles',
      '1789000000000',
      'nonce-123',
      createHash('sha256').update(body).digest('hex'),
    ].join('\n');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-client-id')).toBe(config.clientId);
    expect(headers.get('x-timestamp')).toBe('1789000000000');
    expect(headers.get('x-nonce')).toBe('nonce-123');
    expect(headers.get('x-signature')).toBe(createHmac('sha256', config.secret).update(canonical).digest('hex'));
  });

  it('returns a safe non-retryable slug conflict without copying the main-site response body', async () => {
    const secretFromRemoteBody = 'must-not-leak';
    const client = new XingshantangCmsClient(config, vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'slug_conflict', message: secretFromRemoteBody },
    }, 409)));

    let caught: unknown;
    try {
      await client.createDraft(payload);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(XingshantangCmsError);
    const error = caught as XingshantangCmsError;
    expect(error.code).toBe('XINGSHANTANG_CMS_SLUG_CONFLICT');
    expect(error.httpStatus).toBe(409);
    expect(error.retryable).toBe(false);
    expect(error.message).not.toContain(secretFromRemoteBody);
  });
});
