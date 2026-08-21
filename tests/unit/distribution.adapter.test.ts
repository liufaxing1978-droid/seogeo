import { describe, expect, it, vi } from 'vitest';

const adapterModulePath = '../../src/modules/distribution/distribution-adapter.js';
const manualAdapterModulePath = '../../src/modules/distribution/manual-handoff.adapter.js';

async function loadAdapterModule() {
  const module = await import(adapterModulePath).catch(() => null);
  expect(module, 'distribution-adapter contract must exist for P8-B Task 17').not.toBeNull();
  if (!module) throw new Error('distribution adapter module missing');
  return module as any;
}

async function loadManualAdapterModule() {
  const module = await import(manualAdapterModulePath).catch(() => null);
  expect(module, 'manual-handoff adapter must exist for P8-B Task 17').not.toBeNull();
  if (!module) throw new Error('manual handoff adapter module missing');
  return module as any;
}

const preparedArtifact = {
  platform: 'MEDIUM',
  mode: 'CANONICAL_REPOST',
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

describe('P8-B distribution adapter capability contract', () => {
  it('rejects automatic publishing for MANUAL_HANDOFF before a remote publish function can run', async () => {
    const { publishWithDistributionAdapter } = await loadAdapterModule();
    const remotePublish = vi.fn(async () => ({ providerId: 'should-not-run' }));
    const adapter = {
      platform: 'MEDIUM',
      capability: 'MANUAL_HANDOFF',
      prepare: vi.fn(),
      preview: vi.fn(),
      publish: remotePublish
    };

    await expect(publishWithDistributionAdapter(adapter, preparedArtifact)).rejects.toMatchObject({
      code: 'DISTRIBUTION_MANUAL_ONLY'
    });
    expect(remotePublish).not.toHaveBeenCalled();
  });

  it('prepares a complete Medium manual handoff package without credentials or browser automation', async () => {
    const { ManualHandoffDistributionAdapter } = await loadManualAdapterModule();
    const adapter = new ManualHandoffDistributionAdapter('MEDIUM');

    expect(adapter.capability).toBe('MANUAL_HANDOFF');
    expect(adapter.publish).toBeUndefined();

    const prepared = await adapter.prepare(preparedArtifact);
    expect(prepared).toMatchObject({
      title: preparedArtifact.title,
      body: preparedArtifact.body,
      summary: preparedArtifact.summary,
      tags: preparedArtifact.tags,
      originalUrl: preparedArtifact.originalUrl,
      canonicalUrl: preparedArtifact.canonicalUrl
    });

    const preview = await adapter.preview(prepared);
    expect(preview).toMatchObject({
      platform: 'MEDIUM',
      capability: 'MANUAL_HANDOFF'
    });
    expect(preview.handoff).toMatchObject({
      action: 'MANUAL_PUBLISH'
    });
    expect(JSON.stringify(preview)).not.toMatch(/credential|password|token|browser automation/i);
  });

  it('defaults Medium, LinkedIn and Substack to MANUAL_HANDOFF', async () => {
    const { resolveDistributionCapability } = await loadAdapterModule();

    for (const platform of ['MEDIUM', 'LINKEDIN', 'SUBSTACK']) {
      expect(resolveDistributionCapability(platform, { trustedPublishAdapterConfigured: false })).toBe(
        'MANUAL_HANDOFF'
      );
      expect(resolveDistributionCapability(platform, { trustedPublishAdapterConfigured: true })).toBe(
        'MANUAL_HANDOFF'
      );
    }
  });

  it('allows PUBLISH_API only for configured WordPress/Blogger trusted adapters', async () => {
    const { resolveDistributionCapability } = await loadAdapterModule();

    for (const platform of ['WORDPRESS', 'BLOGGER']) {
      expect(resolveDistributionCapability(platform, { trustedPublishAdapterConfigured: false })).toBe(
        'MANUAL_HANDOFF'
      );
      expect(resolveDistributionCapability(platform, { trustedPublishAdapterConfigured: true })).toBe(
        'PUBLISH_API'
      );
    }
  });
});
