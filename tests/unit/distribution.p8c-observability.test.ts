import { describe, expect, it } from 'vitest';

const modulePath = '../../src/modules/distribution/distribution-observability.js';

async function loadModule() {
  return import(modulePath) as Promise<any>;
}

describe('P8-C safe distribution observability', () => {
  it('allows only bounded metadata for community draft preparation', async () => {
    const module = await loadModule();
    const payload = module.serializeDistributionEvent('community.draft.prepared', {
      projectId: 'project-1',
      targetId: 'target-1',
      artifactId: 'artifact-1',
      platform: 'REDDIT',
      mode: 'COMMUNITY_DRAFT',
      status: 'DRAFT_READY',
      sourceContentVersion: 7,
      durationMs: 42,
      contextHash: 'a'.repeat(64),
      sourceReferenceCount: 3,
      body: 'secret draft body',
      question: 'private question',
      prompt: 'hidden prompt',
      token: 'secret-token',
      sourceUrl: 'https://private.example/source',
      providerRaw: { raw: 'provider response' },
      credential: 'credential-ref-secret'
    });

    expect(payload).toEqual({
      event: 'community.draft.prepared',
      projectId: 'project-1',
      targetId: 'target-1',
      artifactId: 'artifact-1',
      platform: 'REDDIT',
      mode: 'COMMUNITY_DRAFT',
      status: 'DRAFT_READY',
      sourceContentVersion: 7,
      durationMs: 42,
      contextHash: 'a'.repeat(64),
      sourceReferenceCount: 3
    });
    for (const forbidden of ['body', 'question', 'prompt', 'token', 'sourceUrl', 'providerRaw', 'credential']) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it('keeps entity preparation to safe counts and identifiers only', async () => {
    const module = await loadModule();
    const payload = module.serializeDistributionEvent('entity.suggestion.prepared', {
      projectId: 'project-2',
      targetId: 'target-2',
      artifactId: 'artifact-2',
      platform: 'WIKIDATA',
      mode: 'ENTITY_SUGGESTION',
      status: 'DRAFT_READY',
      sourceContentVersion: 1,
      sourceReferenceCount: 2,
      sameAsCount: 1,
      attributeCount: 4,
      missingDataCount: 2,
      body: 'entity draft body',
      prompt: 'hidden prompt',
      credential: 'secret'
    });

    expect(payload).toMatchObject({
      event: 'entity.suggestion.prepared',
      projectId: 'project-2',
      targetId: 'target-2',
      artifactId: 'artifact-2',
      platform: 'WIKIDATA',
      mode: 'ENTITY_SUGGESTION',
      status: 'DRAFT_READY',
      sourceContentVersion: 1,
      sourceReferenceCount: 2,
      sameAsCount: 1,
      attributeCount: 4,
      missingDataCount: 2
    });
    expect(payload).not.toHaveProperty('body');
    expect(payload).not.toHaveProperty('prompt');
    expect(payload).not.toHaveProperty('credential');
  });
});
