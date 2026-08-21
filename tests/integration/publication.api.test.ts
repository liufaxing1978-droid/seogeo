import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function createProject(
  label: string,
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE'
) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P8 publication API ${label}`,
      slug: `p8-publication-api-${suffix}`,
      primaryDomain: `p8-publication-api-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

type Call = { name: string; args: unknown[] };

function createFakePublicationApi(input: {
  planOwnerProjectId?: string;
  executionOwnerProjectId?: string;
} = {}) {
  const calls: Call[] = [];
  const api = {
    listProposals: async (projectId: string, limit: number, offset: number) => {
      calls.push({ name: 'listProposals', args: [projectId, limit, offset] });
      return [{ id: 'proposal-1', projectId, reason: 'bounded list' }];
    },
    createProposal: async (projectId: string, body: unknown, actorId: string) => {
      calls.push({ name: 'createProposal', args: [projectId, body, actorId] });
      return { id: 'proposal-created', projectId, actorId };
    },
    listDrafts: async (projectId: string, limit: number, offset: number) => {
      calls.push({ name: 'listDrafts', args: [projectId, limit, offset] });
      return [];
    },
    createDraft: async (projectId: string, body: unknown) => {
      calls.push({ name: 'createDraft', args: [projectId, body] });
      return { id: 'draft-created', projectId, currentVersion: 1 };
    },
    createDraftVersion: async (projectId: string, draftId: string, body: unknown) => {
      calls.push({ name: 'createDraftVersion', args: [projectId, draftId, body] });
      return { id: 'draft-version-2', draftId, version: 2 };
    },
    listPlans: async (projectId: string, limit: number, offset: number) => {
      calls.push({ name: 'listPlans', args: [projectId, limit, offset] });
      return [];
    },
    createPlan: async (projectId: string, body: unknown) => {
      calls.push({ name: 'createPlan', args: [projectId, body] });
      return { id: 'plan-created', projectId };
    },
    getPlan: async (projectId: string, planId: string) => {
      calls.push({ name: 'getPlan', args: [projectId, planId] });
      if (input.planOwnerProjectId && projectId !== input.planOwnerProjectId) return null;
      return { id: planId, projectId };
    },
    approvePlan: async (projectId: string, planId: string, body: unknown, actorId: string) => {
      calls.push({ name: 'approvePlan', args: [projectId, planId, body, actorId] });
      return { id: 'approval-created', projectId, planId, actorId };
    },
    executePlan: async (projectId: string, planId: string, actorId: string) => {
      calls.push({ name: 'executePlan', args: [projectId, planId, actorId] });
      return { id: 'execution-created', projectId, planId, executionKey: 'execution-key-1' };
    },
    getExecution: async (projectId: string, executionId: string) => {
      calls.push({ name: 'getExecution', args: [projectId, executionId] });
      if (input.executionOwnerProjectId && projectId !== input.executionOwnerProjectId) return null;
      return { id: executionId, projectId, status: 'DEPLOYED' };
    },
    verifyExecution: async (projectId: string, executionId: string, actorId: string) => {
      calls.push({ name: 'verifyExecution', args: [projectId, executionId, actorId] });
      return { executionId, projectId, queued: true };
    }
  };

  return { api, calls };
}

function appWithPublicationApi(api: Record<string, unknown>) {
  return createApp({ publicationApi: api } as never);
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-A bounded publication REST API', () => {
  it('allows STANDARD workspace reads/creates with bounded lists and server-derived actor identity', async () => {
    const project = await createProject('standard workspace', 'STANDARD');
    const fake = createFakePublicationApi();
    const app = appWithPublicationApi(fake.api);

    await request(app)
      .get(`/api/v1/projects/${project.id}/publication/proposals`)
      .query({ limit: 101 })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));

    const list = await request(app)
      .get(`/api/v1/projects/${project.id}/publication/proposals`)
      .query({ limit: 100, offset: 3 })
      .expect(200);
    expect(list.body.meta).toEqual({ limit: 100, offset: 3 });
    expect(list.body.data).toHaveLength(1);

    const created = await request(app)
      .post(`/api/v1/projects/${project.id}/publication/proposals`)
      .send({ sourceType: 'MANUAL', reason: 'Create a bounded manual publication proposal' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      id: 'proposal-created',
      projectId: project.id,
      actorId: `project-api:${project.id}`
    });

    expect(fake.calls.filter((call) => call.name === 'listProposals')).toEqual([
      { name: 'listProposals', args: [project.id, 100, 3] }
    ]);
    expect(fake.calls.filter((call) => call.name === 'createProposal')[0]?.args[2])
      .toBe(`project-api:${project.id}`);
  });

  it('rejects oversized/unknown bodies and client attempts to override approval facts', async () => {
    const project = await createProject('strict bodies', 'ADVANCED');
    const fake = createFakePublicationApi({ planOwnerProjectId: project.id });
    const app = appWithPublicationApi(fake.api);

    await request(app)
      .post(`/api/v1/projects/${project.id}/publication/proposals`)
      .send({ sourceType: 'MANUAL', reason: 'x'.repeat(1001) })
      .expect(400);

    await request(app)
      .post(`/api/v1/projects/${project.id}/publication/drafts`)
      .send({
        proposalId: 'proposal-1',
        title: 'x'.repeat(301),
        body: 'body',
        language: 'zh-CN'
      })
      .expect(400);

    await request(app)
      .post(`/api/v1/projects/${project.id}/publication/plans/plan-1/approve`)
      .send({
        expectedPlanHash: 'a'.repeat(64),
        expectedContentHash: 'b'.repeat(64),
        expectedPreviewHash: 'c'.repeat(64),
        approvedBy: 'attacker-controlled',
        planHash: 'attacker-plan-hash',
        baseSha: 'attacker-base-sha'
      })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));

    expect(fake.calls.some((call) => call.name === 'approvePlan')).toBe(false);
  });

  it('fails STANDARD execution and verification before restricted publication actions are touched', async () => {
    const project = await createProject('standard execution gate', 'STANDARD');
    const fake = createFakePublicationApi({
      planOwnerProjectId: project.id,
      executionOwnerProjectId: project.id
    });
    const app = appWithPublicationApi(fake.api);

    await request(app)
      .post(`/api/v1/projects/${project.id}/publication/plans/plan-1/execute`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));

    await request(app)
      .post(`/api/v1/projects/${project.id}/publication/executions/execution-1/verify`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));

    expect(fake.calls.some((call) => call.name === 'getPlan')).toBe(false);
    expect(fake.calls.some((call) => call.name === 'executePlan')).toBe(false);
    expect(fake.calls.some((call) => call.name === 'getExecution')).toBe(false);
    expect(fake.calls.some((call) => call.name === 'verifyExecution')).toBe(false);
  });

  it('allows ADVANCED execution, derives actors server-side, and hides cross-project resources', async () => {
    const owner = await createProject('advanced owner', 'ADVANCED');
    const other = await createProject('advanced other', 'ADVANCED');
    const fake = createFakePublicationApi({
      planOwnerProjectId: owner.id,
      executionOwnerProjectId: owner.id
    });
    const app = appWithPublicationApi(fake.api);

    const approval = await request(app)
      .post(`/api/v1/projects/${owner.id}/publication/plans/plan-1/approve`)
      .send({
        expectedPlanHash: 'a'.repeat(64),
        expectedContentHash: 'b'.repeat(64),
        expectedPreviewHash: 'c'.repeat(64),
        confirmedWarningCodes: []
      })
      .expect(201);
    expect(approval.body.data.actorId).toBe(`project-api:${owner.id}`);

    const execution = await request(app)
      .post(`/api/v1/projects/${owner.id}/publication/plans/plan-1/execute`)
      .send({})
      .expect(202);
    expect(execution.body.data.id).toBe('execution-created');

    const verification = await request(app)
      .post(`/api/v1/projects/${owner.id}/publication/executions/execution-1/verify`)
      .send({})
      .expect(202);
    expect(verification.body.data.queued).toBe(true);

    await request(app)
      .post(`/api/v1/projects/${other.id}/publication/plans/plan-1/approve`)
      .send({
        expectedPlanHash: 'a'.repeat(64),
        expectedContentHash: 'b'.repeat(64),
        expectedPreviewHash: 'c'.repeat(64)
      })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('PUBLICATION_PLAN_NOT_FOUND'));

    await request(app)
      .post(`/api/v1/projects/${other.id}/publication/executions/execution-1/verify`)
      .send({})
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('PUBLICATION_EXECUTION_NOT_FOUND'));

    expect(fake.calls.filter((call) => call.name === 'executePlan')).toEqual([
      { name: 'executePlan', args: [owner.id, 'plan-1', `project-api:${owner.id}`] }
    ]);
    expect(fake.calls.filter((call) => call.name === 'verifyExecution')).toEqual([
      { name: 'verifyExecution', args: [owner.id, 'execution-1', `project-api:${owner.id}`] }
    ]);
  });
});
