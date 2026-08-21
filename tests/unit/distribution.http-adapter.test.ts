import { describe, expect, it, vi } from 'vitest';

const modulePath = '../../src/modules/distribution/http-publishing.adapter.js';

async function loadModule() {
  const module = await import(modulePath).catch(() => null);
  expect(module, 'trusted HTTP distribution adapter must exist for P8-B Task 19').not.toBeNull();
  if (!module) throw new Error('trusted HTTP distribution adapter missing');
  return module as any;
}

const baseArtifact = {
  platform: 'WORDPRESS',
  mode: 'SECONDARY_SITE',
  publicationId: 'publication-1',
  sourceContentVersion: 7,
  title: '兴善堂测试文章',
  body: '正文',
  summary: '摘要',
  tags: ['六壬文化'],
  originalUrl: 'https://xingshantang.org/culture/test-article',
  canonicalUrl: 'https://xingshantang.org/culture/test-article',
  metadata: {}
};

describe('P8-B trusted HTTP publishing adapter boundary', () => {
  it('fails closed before transport invocation when endpoint or credential reference is missing', async () => {
    const { TrustedHttpDistributionAdapter } = await loadModule();
    const transport = { publish: vi.fn(), verify: vi.fn() };

    const missingEndpoint = new TrustedHttpDistributionAdapter({
      platform: 'WORDPRESS',
      config: {
        endpoint: '',
        credentialRef: 'secret://wordpress/site-1',
        primaryOriginalUrl: baseArtifact.originalUrl
      },
      transport
    });
    await expect(missingEndpoint.publish(baseArtifact)).rejects.toMatchObject({
      code: 'DISTRIBUTION_NOT_CONFIGURED',
      retryable: false
    });

    const missingCredential = new TrustedHttpDistributionAdapter({
      platform: 'WORDPRESS',
      config: {
        endpoint: 'https://wordpress.example.test/api/posts',
        credentialRef: '',
        primaryOriginalUrl: baseArtifact.originalUrl
      },
      transport
    });
    await expect(missingCredential.publish(baseArtifact)).rejects.toMatchObject({
      code: 'DISTRIBUTION_NOT_CONFIGURED',
      retryable: false
    });

    expect(transport.publish).not.toHaveBeenCalled();
  });

  it('uses only constructor-configured endpoint and credential reference, ignoring artifact metadata URLs or headers', async () => {
    const { TrustedHttpDistributionAdapter } = await loadModule();
    const transport = {
      publish: vi.fn(async () => ({
        status: 201,
        body: { id: 'wp-1', url: 'https://secondary.example.test/post-1', status: 'published', secret: 'drop-me' }
      })),
      verify: vi.fn()
    };
    const adapter = new TrustedHttpDistributionAdapter({
      platform: 'WORDPRESS',
      config: {
        endpoint: 'https://wordpress.example.test/api/posts',
        credentialRef: 'secret://wordpress/site-1',
        primaryOriginalUrl: baseArtifact.originalUrl
      },
      transport
    });

    const result = await adapter.publish({
      ...baseArtifact,
      metadata: {
        endpoint: 'https://evil.example.test/write',
        headers: { Authorization: 'attacker-value' }
      }
    });

    expect(transport.publish).toHaveBeenCalledTimes(1);
    expect(transport.publish.mock.calls[0][0]).toMatchObject({
      endpoint: 'https://wordpress.example.test/api/posts',
      credentialRef: 'secret://wordpress/site-1'
    });
    expect(JSON.stringify(transport.publish.mock.calls[0][0])).not.toContain('evil.example.test');
    expect(JSON.stringify(transport.publish.mock.calls[0][0])).not.toContain('attacker-value');
    expect(result).toEqual({
      providerId: 'wp-1',
      publicUrl: 'https://secondary.example.test/post-1',
      status: 'published'
    });
  });

  it('rejects canonical/secondary-site ownership drift before a provider write', async () => {
    const { TrustedHttpDistributionAdapter } = await loadModule();
    const transport = { publish: vi.fn(), verify: vi.fn() };
    const adapter = new TrustedHttpDistributionAdapter({
      platform: 'WORDPRESS',
      config: {
        endpoint: 'https://wordpress.example.test/api/posts',
        credentialRef: 'secret://wordpress/site-1',
        primaryOriginalUrl: baseArtifact.originalUrl
      },
      transport
    });

    await expect(adapter.publish({
      ...baseArtifact,
      canonicalUrl: 'https://other.example.test/not-primary'
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_OWNERSHIP_MISMATCH' });

    await expect(adapter.publish({
      ...baseArtifact,
      originalUrl: 'https://other.example.test/not-primary'
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_OWNERSHIP_MISMATCH' });

    expect(transport.publish).not.toHaveBeenCalled();
  });

  it('classifies transient provider failures as retryable and validation/permission failures as terminal', async () => {
    const { TrustedHttpDistributionAdapter } = await loadModule();
    const makeAdapter = (status: number) => new TrustedHttpDistributionAdapter({
      platform: 'BLOGGER',
      config: {
        endpoint: 'https://blogger.example.test/api/posts',
        credentialRef: 'secret://blogger/site-1',
        primaryOriginalUrl: baseArtifact.originalUrl
      },
      transport: {
        publish: vi.fn(async () => ({ status, body: { error: 'provider failure' } })),
        verify: vi.fn()
      }
    });

    await expect(makeAdapter(503).publish({ ...baseArtifact, platform: 'BLOGGER' })).rejects.toMatchObject({
      code: 'DISTRIBUTION_PROVIDER_TRANSIENT',
      retryable: true
    });
    await expect(makeAdapter(429).publish({ ...baseArtifact, platform: 'BLOGGER' })).rejects.toMatchObject({
      code: 'DISTRIBUTION_PROVIDER_TRANSIENT',
      retryable: true
    });
    await expect(makeAdapter(400).publish({ ...baseArtifact, platform: 'BLOGGER' })).rejects.toMatchObject({
      code: 'DISTRIBUTION_PROVIDER_REJECTED',
      retryable: false
    });
    await expect(makeAdapter(403).publish({ ...baseArtifact, platform: 'BLOGGER' })).rejects.toMatchObject({
      code: 'DISTRIBUTION_PROVIDER_REJECTED',
      retryable: false
    });
  });
});
