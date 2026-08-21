import { describe, expect, it, vi } from 'vitest';
import { publishWithDistributionAdapter } from '../../src/modules/distribution/distribution-adapter.js';

const modulePath = '../../src/modules/distribution/http-publishing.adapter.js';

async function loadModule() {
  const module = await import(modulePath).catch(() => null);
  expect(module, 'trusted HTTP distribution adapter must exist for P8-B Task 19').not.toBeNull();
  if (!module) throw new Error('trusted HTTP distribution adapter missing');
  return module as any;
}

const artifact = {
  platform: 'WORDPRESS' as const,
  mode: 'CANONICAL_REPOST' as const,
  publicationId: 'publication-verified-1',
  sourceContentVersion: 7,
  title: '兴善堂 canonical repost',
  body: 'Canonical body',
  summary: 'Canonical summary',
  tags: ['六壬文化'],
  originalUrl: 'https://xingshantang.org/culture/verified-primary',
  canonicalUrl: 'https://xingshantang.org/culture/verified-primary',
  metadata: {}
};

describe('P8-B trusted HTTP publish/verify idempotency', () => {
  it('binds one deterministic provider publish key to the same approved artifact payload', async () => {
    const { TrustedHttpDistributionAdapter } = await loadModule();
    const seen = new Map<string, { id: string; url: string; status: string }>();
    const providerWrites: string[] = [];
    const transport = {
      publish: vi.fn(async (request: any) => {
        const existing = seen.get(request.providerPublishKey);
        if (existing) return { status: 200, body: existing };
        providerWrites.push(request.providerPublishKey);
        const result = {
          id: `wp-${providerWrites.length}`,
          url: `https://secondary.example.test/posts/${providerWrites.length}`,
          status: 'published'
        };
        seen.set(request.providerPublishKey, result);
        return { status: 201, body: result };
      }),
      verify: vi.fn(async (request: any) => ({
        status: 200,
        body: {
          id: request.providerId,
          url: request.publicUrl,
          status: 'published',
          verified: true
        }
      }))
    };
    const adapter = new TrustedHttpDistributionAdapter({
      platform: 'WORDPRESS',
      config: {
        endpoint: 'https://wordpress.example.test/api/posts',
        credentialRef: 'secret://wordpress/site-1',
        primaryOriginalUrl: artifact.originalUrl
      },
      transport
    });

    const first = await publishWithDistributionAdapter(adapter, artifact);
    const second = await publishWithDistributionAdapter(adapter, artifact);

    expect(first).toEqual(second);
    expect(providerWrites).toHaveLength(1);
    expect(transport.publish.mock.calls[0][0].providerPublishKey).toBe(
      transport.publish.mock.calls[1][0].providerPublishKey
    );

    const changed = await publishWithDistributionAdapter(adapter, { ...artifact, body: 'Changed approved artifact body' });
    expect(changed.providerId).not.toBe(first.providerId);
    expect(providerWrites).toHaveLength(2);
  });

  it('verifies only bounded provider identity/public URL fields and fails closed on malformed provider payloads', async () => {
    const { TrustedHttpDistributionAdapter } = await loadModule();
    const transport = {
      publish: vi.fn(async (_request: any) => ({
        status: 201,
        body: {
          id: 'wp-verified',
          url: 'https://secondary.example.test/posts/verified',
          status: 'published',
          rawToken: 'must-not-leak'
        }
      })),
      verify: vi.fn(async (_request: any) => ({
        status: 200,
        body: {
          id: 'wp-verified',
          url: 'https://secondary.example.test/posts/verified',
          status: 'published',
          verified: true,
          providerRaw: { secret: 'drop-me' }
        }
      }))
    };
    const adapter = new TrustedHttpDistributionAdapter({
      platform: 'WORDPRESS',
      config: {
        endpoint: 'https://wordpress.example.test/api/posts',
        credentialRef: 'secret://wordpress/site-1',
        primaryOriginalUrl: artifact.originalUrl
      },
      transport
    });

    const published = await adapter.publish(artifact);
    const verified = await adapter.verify(published);
    expect(published).toEqual({
      providerId: 'wp-verified',
      publicUrl: 'https://secondary.example.test/posts/verified',
      status: 'published'
    });
    expect(verified).toEqual({
      verified: true,
      publicUrl: 'https://secondary.example.test/posts/verified'
    });
    expect(JSON.stringify(published)).not.toContain('must-not-leak');
    expect(JSON.stringify(verified)).not.toContain('drop-me');

    const malformed = new TrustedHttpDistributionAdapter({
      platform: 'WORDPRESS',
      config: {
        endpoint: 'https://wordpress.example.test/api/posts',
        credentialRef: 'secret://wordpress/site-1',
        primaryOriginalUrl: artifact.originalUrl
      },
      transport: {
        publish: vi.fn(async (_request: any) => ({ status: 201, body: { id: 42, url: 'not-a-url' } })),
        verify: vi.fn(async (_request: any) => undefined)
      }
    });
    await expect(malformed.publish(artifact)).rejects.toMatchObject({
      code: 'DISTRIBUTION_PROVIDER_INVALID_RESPONSE',
      retryable: false
    });
  });
});
