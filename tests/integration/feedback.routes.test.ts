import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function createProject(label: string, planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE') {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-E feedback API ${label}`,
      slug: `p9e-feedback-api-${suffix}`,
      primaryDomain: `p9e-feedback-api-${suffix}.example.com`,
      planLevel,
    },
  });
  projectIds.push(project.id);
  return project;
}

type ListCall = { projectId: string; limit: number; offset: number };
type DetailCall = { projectId: string; profileId: string };

type FakeFeedbackApi = {
  listProfiles(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  getProfile(projectId: string, profileId: string): Promise<unknown | null>;
  listEvidence(projectId: string, limit: number, offset: number): Promise<unknown[]>;
};

function createFakeFeedbackApi() {
  const profileCalls: ListCall[] = [];
  const evidenceCalls: ListCall[] = [];
  const detailCalls: DetailCall[] = [];
  const visibleProfileId = '11111111-1111-4111-8111-111111111111';
  let visibleProjectId = '';

  const api: FakeFeedbackApi = {
    async listProfiles(projectId, limit, offset) {
      profileCalls.push({ projectId, limit, offset });
      return [{
        id: visibleProfileId,
        projectId,
        feedbackProfileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
        scopeKey: 'a'.repeat(64),
        recommendedActionType: 'CONTENT_REFRESH',
        sampleCount: 5,
        positiveCount: 4,
        neutralCount: 1,
        negativeCount: 0,
        rollingEffectBalance: 0.8,
        historicalRankAdjustment: -4,
        inputFingerprint: 'b'.repeat(64),
      }];
    },
    async getProfile(projectId, profileId) {
      detailCalls.push({ projectId, profileId });
      if (projectId !== visibleProjectId || profileId !== visibleProfileId) return null;
      return {
        id: visibleProfileId,
        projectId,
        feedbackProfileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
        scopeKey: 'a'.repeat(64),
        recommendedActionType: 'CONTENT_REFRESH',
        sampleCount: 5,
        historicalRankAdjustment: -4,
        inputEvidenceIdsJson: ['evidence-1', 'evidence-2'],
        inputFingerprint: 'b'.repeat(64),
      };
    },
    async listEvidence(projectId, limit, offset) {
      evidenceCalls.push({ projectId, limit, offset });
      return [{
        id: '22222222-2222-4222-8222-222222222222',
        projectId,
        experimentId: '33333333-3333-4333-8333-333333333333',
        observationId: '44444444-4444-4444-8444-444444444444',
        optimizationPlanId: '55555555-5555-4555-8555-555555555555',
        candidateId: '66666666-6666-4666-8666-666666666666',
        effectState: 'POSITIVE',
        feedbackValue: 1,
        sourceObservationKey: 'observation-key',
      }];
    },
  };

  return {
    api,
    profileCalls,
    evidenceCalls,
    detailCalls,
    visibleProfileId,
    setVisibleProject(projectId: string) {
      visibleProjectId = projectId;
    },
  };
}

function appWithFeedbackApi(api: FakeFeedbackApi) {
  return createApp({ optimizationFeedbackApi: api } as never);
}

function profilesUrl(projectId: string) {
  return `/api/projects/${projectId}/optimization-feedback/profiles`;
}

function evidenceUrl(projectId: string) {
  return `/api/projects/${projectId}/optimization-feedback/evidence`;
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P9-E persisted-read feedback API', () => {
  it.each(['ADVANCED', 'ENTERPRISE'] as const)(
    'lists persisted profiles and evidence for %s with bounded pagination',
    async (planLevel) => {
      const project = await createProject(`list-${planLevel.toLowerCase()}`, planLevel);
      const fake = createFakeFeedbackApi();
      const app = appWithFeedbackApi(fake.api);

      const profiles = await request(app)
        .get(`${profilesUrl(project.id)}?limit=25&offset=50`)
        .expect(200);
      expect(profiles.body.data).toEqual([
        expect.objectContaining({ projectId: project.id, historicalRankAdjustment: -4 }),
      ]);

      const evidence = await request(app)
        .get(`${evidenceUrl(project.id)}?limit=10&offset=3`)
        .expect(200);
      expect(evidence.body.data).toEqual([
        expect.objectContaining({ projectId: project.id, feedbackValue: 1 }),
      ]);

      expect(fake.profileCalls).toEqual([{ projectId: project.id, limit: 25, offset: 50 }]);
      expect(fake.evidenceCalls).toEqual([{ projectId: project.id, limit: 10, offset: 3 }]);
      expect(fake.detailCalls).toEqual([]);
    },
  );

  it('uses default pagination and returns same-project detail while hiding cross-project profile ids', async () => {
    const owner = await createProject('detail-owner', 'ADVANCED');
    const other = await createProject('detail-other', 'ADVANCED');
    const fake = createFakeFeedbackApi();
    fake.setVisibleProject(owner.id);
    const app = appWithFeedbackApi(fake.api);

    await request(app).get(profilesUrl(owner.id)).expect(200);
    await request(app).get(evidenceUrl(owner.id)).expect(200);
    expect(fake.profileCalls).toContainEqual({ projectId: owner.id, limit: 50, offset: 0 });
    expect(fake.evidenceCalls).toContainEqual({ projectId: owner.id, limit: 50, offset: 0 });

    const detail = await request(app)
      .get(`${profilesUrl(owner.id)}/${fake.visibleProfileId}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      id: fake.visibleProfileId,
      projectId: owner.id,
      historicalRankAdjustment: -4,
    });

    await request(app)
      .get(`${profilesUrl(other.id)}/${fake.visibleProfileId}`)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('FEEDBACK_PROFILE_NOT_FOUND'));

    expect(fake.detailCalls).toEqual([
      { projectId: owner.id, profileId: fake.visibleProfileId },
      { projectId: other.id, profileId: fake.visibleProfileId },
    ]);
  });

  it('returns 403 for STANDARD before any persisted-read port call', async () => {
    const project = await createProject('standard', 'STANDARD');
    const fake = createFakeFeedbackApi();
    const app = appWithFeedbackApi(fake.api);

    await request(app).get(profilesUrl(project.id)).expect(403);
    await request(app).get(evidenceUrl(project.id)).expect(403);
    await request(app).get(`${profilesUrl(project.id)}/${fake.visibleProfileId}`).expect(403);

    expect(fake.profileCalls).toEqual([]);
    expect(fake.evidenceCalls).toEqual([]);
    expect(fake.detailCalls).toEqual([]);
  });

  it('rejects malformed ids and out-of-range pagination before persisted reads', async () => {
    const project = await createProject('validation', 'ADVANCED');
    const fake = createFakeFeedbackApi();
    const app = appWithFeedbackApi(fake.api);

    await request(app).get(profilesUrl('not-a-uuid')).expect(400);
    await request(app).get(`${profilesUrl(project.id)}/not-a-uuid`).expect(400);

    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'offset=100001', 'offset=abc']) {
      await request(app).get(`${profilesUrl(project.id)}?${query}`).expect(400);
      await request(app).get(`${evidenceUrl(project.id)}?${query}`).expect(400);
    }

    expect(fake.profileCalls).toEqual([]);
    expect(fake.evidenceCalls).toEqual([]);
    expect(fake.detailCalls).toEqual([]);
  });

  it('exposes GET only and has no public feedback mutation surface', async () => {
    const project = await createProject('read-only', 'ADVANCED');
    const fake = createFakeFeedbackApi();
    const app = appWithFeedbackApi(fake.api);
    const profiles = profilesUrl(project.id);
    const evidence = evidenceUrl(project.id);

    await request(app).post(profiles).send({}).expect(404);
    await request(app).put(`${profiles}/${fake.visibleProfileId}`).send({}).expect(404);
    await request(app).patch(`${profiles}/${fake.visibleProfileId}`).send({}).expect(404);
    await request(app).delete(`${profiles}/${fake.visibleProfileId}`).expect(404);
    await request(app).post(evidence).send({}).expect(404);

    expect(fake.profileCalls).toEqual([]);
    expect(fake.evidenceCalls).toEqual([]);
    expect(fake.detailCalls).toEqual([]);
  });
});
