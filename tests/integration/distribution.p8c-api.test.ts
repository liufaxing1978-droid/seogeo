import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];
type Call = { name: string; args: unknown[] };

async function createProject(planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE') {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P8-C API ${planLevel}`,
      slug: `p8c-api-${suffix}`,
      primaryDomain: `p8c-api-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

function fakeApi(input: {
  ownerProjectId?: string;
  platform?: string;
  mode?: string;
  capability?: 'PREPARE_ONLY' | 'MANUAL_HANDOFF' | 'PUBLISH_API';
} = {}) {
  const calls: Call[] = [];
  const api = {
    listCenter: async () => ({ publications: [], targets: [] }),
    createTarget: async (projectId: string, body: unknown) => {
      calls.push({ name: 'createTarget', args: [projectId, body] });
      return { id: '11111111-1111-4111-8111-111111111111', projectId, status: 'NOT_PREPARED' };
    },
    getTarget: async (projectId: string, targetId: string) => {
      calls.push({ name: 'getTarget', args: [projectId, targetId] });
      if (input.ownerProjectId && input.ownerProjectId !== projectId) return null;
      return {
        id: targetId,
        projectId,
        platform: input.platform ?? 'REDDIT',
        mode: input.mode ?? 'COMMUNITY_DRAFT',
        capability: input.capability ?? 'MANUAL_HANDOFF',
        status: 'APPROVED',
        sourceContentVersion: 1
      };
    },
    prepareTarget: async (...args: unknown[]) => { calls.push({ name: 'prepareTarget', args }); return { queued: true }; },
    approveArtifact: async (...args: unknown[]) => { calls.push({ name: 'approveArtifact', args }); return { status: 'APPROVED' }; },
    markManualActionRequired: async (...args: unknown[]) => { calls.push({ name: 'markManualActionRequired', args }); return { status: 'MANUAL_ACTION_REQUIRED' }; },
    publishArtifact: async (...args: unknown[]) => { calls.push({ name: 'publishArtifact', args }); return { status: 'PUBLISHED' }; },
    verifyArtifact: async (...args: unknown[]) => { calls.push({ name: 'verifyArtifact', args }); return { status: 'VERIFIED' }; },
    recordManualResult: async (...args: unknown[]) => { calls.push({ name: 'recordManualResult', args }); return { status: 'PUBLISHED' }; }
  };
  return { api, calls };
}

function app(api: Record<string, unknown>) {
  return createApp({ distributionApi: api } as never);
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-C bounded distribution API gates', () => {
  it('gates community/entity creation by plan and passes only normalized community target context', async () => {
    const standard = await createProject('STANDARD');
    const advanced = await createProject('ADVANCED');
    const enterprise = await createProject('ENTERPRISE');
    const publicationId = '22222222-2222-4222-8222-222222222222';

    const standardFake = fakeApi();
    await request(app(standardFake.api))
      .post(`/api/v1/projects/${standard.id}/distribution/targets`)
      .send({
        publicationId,
        platform: 'REDDIT',
        mode: 'COMMUNITY_DRAFT',
        targetKey: 'community',
        targetContext: { sourceType: 'USER', question: 'Question?', includeBrandLink: false }
      })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));
    expect(standardFake.calls).toHaveLength(0);

    const advancedFake = fakeApi();
    await request(app(advancedFake.api))
      .post(`/api/v1/projects/${advanced.id}/distribution/targets`)
      .send({
        publicationId,
        platform: 'JIANSHU',
        mode: 'COMMUNITY_DRAFT',
        targetKey: 'community',
        targetContext: {
          sourceType: 'USER',
          question: '  How should this source be understood?  ',
          topicUrl: null,
          includeBrandLink: false
        }
      })
      .expect(201);
    expect(advancedFake.calls.filter((call) => call.name === 'createTarget')).toEqual([{
      name: 'createTarget',
      args: [advanced.id, {
        publicationId,
        platform: 'JIANSHU',
        mode: 'COMMUNITY_DRAFT',
        targetKey: 'community',
        targetContext: {
          sourceType: 'USER',
          question: 'How should this source be understood?',
          topicUrl: null,
          includeBrandLink: false
        }
      }]
    }]);

    const advancedEntityFake = fakeApi();
    await request(app(advancedEntityFake.api))
      .post(`/api/v1/projects/${advanced.id}/distribution/targets`)
      .send({ publicationId, platform: 'WIKIDATA', mode: 'ENTITY_SUGGESTION', targetKey: 'entity' })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));
    expect(advancedEntityFake.calls).toHaveLength(0);

    const enterpriseFake = fakeApi();
    await request(app(enterpriseFake.api))
      .post(`/api/v1/projects/${enterprise.id}/distribution/targets`)
      .send({ publicationId, platform: 'WIKIDATA', mode: 'ENTITY_SUGGESTION', targetKey: 'entity' })
      .expect(201);
    expect(enterpriseFake.calls.filter((call) => call.name === 'createTarget')).toHaveLength(1);
  });

  it('hides cross-project targets before prepare or approval work', async () => {
    const owner = await createProject('ADVANCED');
    const other = await createProject('ADVANCED');
    const fake = fakeApi({ ownerProjectId: owner.id });
    const targetId = '33333333-3333-4333-8333-333333333333';
    const artifactId = '44444444-4444-4444-8444-444444444444';

    await request(app(fake.api))
      .post(`/api/v1/projects/${other.id}/distribution/targets/${targetId}/prepare`)
      .send({ sourceContentVersion: 1 })
      .expect(404);
    await request(app(fake.api))
      .post(`/api/v1/projects/${other.id}/distribution/targets/${targetId}/artifacts/${artifactId}/approve`)
      .send({})
      .expect(404);

    expect(fake.calls.some((call) => call.name === 'prepareTarget')).toBe(false);
    expect(fake.calls.some((call) => call.name === 'approveArtifact')).toBe(false);
  });

  it('keeps PREPARE_ONLY entity targets out of publish/manual-result/verify service paths', async () => {
    const enterprise = await createProject('ENTERPRISE');
    const fake = fakeApi({
      ownerProjectId: enterprise.id,
      platform: 'WIKIDATA',
      mode: 'ENTITY_SUGGESTION',
      capability: 'PREPARE_ONLY'
    });
    const targetId = '55555555-5555-4555-8555-555555555555';
    const artifactId = '66666666-6666-4666-8666-666666666666';
    const targetApp = app(fake.api);

    await request(targetApp)
      .post(`/api/v1/projects/${enterprise.id}/distribution/targets/${targetId}/artifacts/${artifactId}/publish`)
      .send({})
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('DISTRIBUTION_NOT_SUPPORTED'));
    await request(targetApp)
      .post(`/api/v1/projects/${enterprise.id}/distribution/targets/${targetId}/artifacts/${artifactId}/manual-result`)
      .send({ publicUrl: 'https://www.wikidata.org/wiki/Q123' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('DISTRIBUTION_MANUAL_ONLY_REQUIRED'));
    await request(targetApp)
      .post(`/api/v1/projects/${enterprise.id}/distribution/targets/${targetId}/artifacts/${artifactId}/verify`)
      .send({})
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('DISTRIBUTION_VERIFY_NOT_SUPPORTED'));

    expect(fake.calls.some((call) => call.name === 'markManualActionRequired')).toBe(false);
    expect(fake.calls.some((call) => call.name === 'publishArtifact')).toBe(false);
    expect(fake.calls.some((call) => call.name === 'recordManualResult')).toBe(false);
    expect(fake.calls.some((call) => call.name === 'verifyArtifact')).toBe(false);
  });
});
