import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

type Call = { name: string; args: unknown[] };

async function createProject(label: string, planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE') {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P8-B distribution API ${label}`,
      slug: `p8b-distribution-api-${suffix}`,
      primaryDomain: `p8b-distribution-api-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

function createFakeDistributionApi(input: {
  ownerProjectId?: string;
  capability?: 'PREPARE_ONLY' | 'MANUAL_HANDOFF' | 'PUBLISH_API';
} = {}) {
  const calls: Call[] = [];
  const api = {
    listCenter: async (projectId: string) => {
      calls.push({ name: 'listCenter', args: [projectId] });
      return { publications: [{ id: 'publication-1', status: 'VERIFIED' }], targets: [] };
    },
    createTarget: async (projectId: string, body: unknown) => {
      calls.push({ name: 'createTarget', args: [projectId, body] });
      return { id: '11111111-1111-4111-8111-111111111111', projectId, status: 'NOT_PREPARED' };
    },
    getTarget: async (projectId: string, targetId: string) => {
      calls.push({ name: 'getTarget', args: [projectId, targetId] });
      if (input.ownerProjectId && projectId !== input.ownerProjectId) return null;
      return {
        id: targetId,
        projectId,
        platform: input.capability === 'PUBLISH_API' ? 'WORDPRESS' : 'MEDIUM',
        mode: input.capability === 'PUBLISH_API' ? 'SECONDARY_SITE' : 'CANONICAL_REPOST',
        capability: input.capability ?? 'MANUAL_HANDOFF',
        status: 'APPROVED',
        sourceContentVersion: 7
      };
    },
    prepareTarget: async (projectId: string, targetId: string, sourceContentVersion: number) => {
      calls.push({ name: 'prepareTarget', args: [projectId, targetId, sourceContentVersion] });
      return { queued: true, targetId, sourceContentVersion };
    },
    approveArtifact: async (projectId: string, targetId: string, artifactId: string) => {
      calls.push({ name: 'approveArtifact', args: [projectId, targetId, artifactId] });
      return { targetId, artifactId, status: 'APPROVED' };
    },
    markManualActionRequired: async (projectId: string, targetId: string, artifactId: string) => {
      calls.push({ name: 'markManualActionRequired', args: [projectId, targetId, artifactId] });
      return { targetId, artifactId, status: 'MANUAL_ACTION_REQUIRED' };
    },
    publishArtifact: async (projectId: string, targetId: string, artifactId: string) => {
      calls.push({ name: 'publishArtifact', args: [projectId, targetId, artifactId] });
      return { targetId, artifactId, status: 'PUBLISHED', publicUrl: 'https://secondary.example.test/post-1' };
    },
    verifyArtifact: async (projectId: string, targetId: string, artifactId: string) => {
      calls.push({ name: 'verifyArtifact', args: [projectId, targetId, artifactId] });
      return { targetId, artifactId, status: 'VERIFIED' };
    },
    recordManualResult: async (projectId: string, targetId: string, artifactId: string, publicUrl: string) => {
      calls.push({ name: 'recordManualResult', args: [projectId, targetId, artifactId, publicUrl] });
      return { targetId, artifactId, status: 'PUBLISHED', publicUrl };
    }
  };
  return { api, calls };
}

function appWithDistributionApi(api: Record<string, unknown>) {
  return createApp({ distributionApi: api } as never);
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-B bounded distribution REST API', () => {
  it('keeps GET persisted-read only and creates a bounded project-scoped target', async () => {
    const project = await createProject('center', 'ADVANCED');
    const fake = createFakeDistributionApi({ ownerProjectId: project.id });
    const app = appWithDistributionApi(fake.api);

    const center = await request(app)
      .get(`/api/v1/projects/${project.id}/distribution`)
      .expect(200);
    expect(center.body.data.publications).toHaveLength(1);
    expect(fake.calls).toEqual([{ name: 'listCenter', args: [project.id] }]);

    const publicationId = '22222222-2222-4222-8222-222222222222';
    await request(app)
      .post(`/api/v1/projects/${project.id}/distribution/targets`)
      .send({
        publicationId,
        platform: 'MEDIUM',
        mode: 'CANONICAL_REPOST',
        targetKey: 'x'.repeat(121)
      })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));

    await request(app)
      .post(`/api/v1/projects/${project.id}/distribution/targets`)
      .send({ publicationId, platform: 'MEDIUM', mode: 'CANONICAL_REPOST', targetKey: 'default' })
      .expect(201);

    expect(fake.calls.filter((call) => call.name === 'createTarget')).toEqual([
      {
        name: 'createTarget',
        args: [project.id, { publicationId, platform: 'MEDIUM', mode: 'CANONICAL_REPOST', targetKey: 'default' }]
      }
    ]);
  });

  it('hides cross-project targets before prepare/approve mutations are touched', async () => {
    const owner = await createProject('owner', 'ADVANCED');
    const other = await createProject('other', 'ADVANCED');
    const fake = createFakeDistributionApi({ ownerProjectId: owner.id });
    const app = appWithDistributionApi(fake.api);
    const targetId = '33333333-3333-4333-8333-333333333333';
    const artifactId = '44444444-4444-4444-8444-444444444444';

    await request(app)
      .post(`/api/v1/projects/${other.id}/distribution/targets/${targetId}/prepare`)
      .send({ sourceContentVersion: 7 })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('DISTRIBUTION_TARGET_NOT_FOUND'));

    await request(app)
      .post(`/api/v1/projects/${other.id}/distribution/targets/${targetId}/artifacts/${artifactId}/approve`)
      .send({})
      .expect(404);

    expect(fake.calls.some((call) => call.name === 'prepareTarget')).toBe(false);
    expect(fake.calls.some((call) => call.name === 'approveArtifact')).toBe(false);
  });

  it('fails feature-unavailable and manual-only publish before provider publish is touched', async () => {
    const standard = await createProject('standard', 'STANDARD');
    const advanced = await createProject('manual', 'ADVANCED');
    const targetId = '55555555-5555-4555-8555-555555555555';
    const artifactId = '66666666-6666-4666-8666-666666666666';

    const standardFake = createFakeDistributionApi({ ownerProjectId: standard.id, capability: 'PUBLISH_API' });
    await request(appWithDistributionApi(standardFake.api))
      .post(`/api/v1/projects/${standard.id}/distribution/targets/${targetId}/artifacts/${artifactId}/publish`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));
    expect(standardFake.calls).toHaveLength(0);

    const manualFake = createFakeDistributionApi({ ownerProjectId: advanced.id, capability: 'MANUAL_HANDOFF' });
    await request(appWithDistributionApi(manualFake.api))
      .post(`/api/v1/projects/${advanced.id}/distribution/targets/${targetId}/artifacts/${artifactId}/publish`)
      .send({})
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('DISTRIBUTION_MANUAL_ONLY'));

    expect(manualFake.calls.some((call) => call.name === 'markManualActionRequired')).toBe(true);
    expect(manualFake.calls.some((call) => call.name === 'publishArtifact')).toBe(false);
  });

  it('allows only PUBLISH_API publish/verify and records a bounded manual result URL', async () => {
    const project = await createProject('publish', 'ADVANCED');
    const targetId = '77777777-7777-4777-8777-777777777777';
    const artifactId = '88888888-8888-4888-8888-888888888888';
    const fake = createFakeDistributionApi({ ownerProjectId: project.id, capability: 'PUBLISH_API' });
    const app = appWithDistributionApi(fake.api);

    await request(app)
      .post(`/api/v1/projects/${project.id}/distribution/targets/${targetId}/artifacts/${artifactId}/publish`)
      .send({})
      .expect(202);
    await request(app)
      .post(`/api/v1/projects/${project.id}/distribution/targets/${targetId}/artifacts/${artifactId}/verify`)
      .send({})
      .expect(202);

    await request(app)
      .post(`/api/v1/projects/${project.id}/distribution/targets/${targetId}/artifacts/${artifactId}/manual-result`)
      .send({ publicUrl: 'javascript:alert(1)' })
      .expect(400);

    await request(app)
      .post(`/api/v1/projects/${project.id}/distribution/targets/${targetId}/artifacts/${artifactId}/manual-result`)
      .send({ publicUrl: 'https://medium.com/example/manual-post' })
      .expect(201);

    expect(fake.calls.filter((call) => call.name === 'publishArtifact')).toHaveLength(1);
    expect(fake.calls.filter((call) => call.name === 'verifyArtifact')).toHaveLength(1);
    expect(fake.calls.filter((call) => call.name === 'recordManualResult')).toEqual([
      {
        name: 'recordManualResult',
        args: [project.id, targetId, artifactId, 'https://medium.com/example/manual-post']
      }
    ]);
  });
});
