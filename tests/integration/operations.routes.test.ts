import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import type {
  OperationsActorResolver,
  OptimizationOperationsApiPort,
  PolicyRevisionCommandPort,
} from '../../src/modules/optimization-operations/operations.routes.js';

const projectIds: string[] = [];

async function createProject(planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE') {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-F routes ${planLevel} ${suffix}`,
      slug: `p9f-routes-${planLevel.toLowerCase()}-${suffix}`,
      primaryDomain: `p9f-routes-${suffix}.example.com`,
      planLevel,
    },
  });
  projectIds.push(project.id);
  return project;
}

class FakeOperationsApi implements OptimizationOperationsApiPort {
  calls: Array<{ method: string; projectId: string; limit?: number; offset?: number }> = [];

  async getOverview(projectId: string) {
    this.calls.push({ method: 'getOverview', projectId });
    return { kind: 'overview', projectId };
  }

  async listPipeline(projectId: string, limit: number, offset: number) {
    this.calls.push({ method: 'listPipeline', projectId, limit, offset });
    return [{ kind: 'pipeline', projectId, limit, offset }];
  }

  async listInbox(projectId: string, limit: number, offset: number) {
    this.calls.push({ method: 'listInbox', projectId, limit, offset });
    return [{ kind: 'inbox', projectId, limit, offset }];
  }

  async listExperiments(projectId: string, limit: number, offset: number) {
    this.calls.push({ method: 'listExperiments', projectId, limit, offset });
    return [{ kind: 'experiments', projectId, limit, offset }];
  }

  async listFeedback(projectId: string, limit: number, offset: number) {
    this.calls.push({ method: 'listFeedback', projectId, limit, offset });
    return [{ kind: 'feedback', projectId, limit, offset }];
  }

  async getPolicy(projectId: string) {
    this.calls.push({ method: 'getPolicy', projectId });
    return { kind: 'policy', projectId };
  }

  async listPolicyRevisions(projectId: string, limit: number, offset: number) {
    this.calls.push({ method: 'listPolicyRevisions', projectId, limit, offset });
    return [{ kind: 'policy-revisions', projectId, limit, offset }];
  }
}

type CommandResult = Awaited<ReturnType<PolicyRevisionCommandPort['apply']>>;

class FakePolicyRevisionCommand implements PolicyRevisionCommandPort {
  calls: Parameters<PolicyRevisionCommandPort['apply']>[0][] = [];
  result: CommandResult = {
    status: 'APPLIED',
    policyId: randomUUID(),
    revisionId: randomUUID(),
    revisionKey: 'revision-key',
    commandFingerprint: 'command-fingerprint',
    appliedPolicyUpdatedAt: '2026-08-25T05:00:00.000Z',
  };
  error: Error | null = null;

  async apply(input: Parameters<PolicyRevisionCommandPort['apply']>[0]): Promise<CommandResult> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.result;
  }
}

const validPolicyBody = () => ({
  requestId: randomUUID(),
  expectedUpdatedAt: null,
  policy: {
    enabled: true,
    dailyDraftPrLimit: 2,
    maxConcurrentRuns: 1,
    requireFreshEvidence: true,
    minimumEvidenceCoverage: 80,
    pauseOnVerificationFailure: true,
    killSwitch: false,
  },
});

function actorResolver(actorId = 'operator:fixture'): OperationsActorResolver {
  return {
    resolve() {
      return { actorId };
    },
  };
}

afterAll(async () => {
  if (projectIds.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  }
});

describe('P9-F Operations API', () => {
  it('serves all seven persisted-read GET endpoints for Advanced and Enterprise projects', async () => {
    const advanced = await createProject('ADVANCED');
    const enterprise = await createProject('ENTERPRISE');

    for (const project of [advanced, enterprise]) {
      const api = new FakeOperationsApi();
      const app = createApp({ optimizationOperationsApi: api });
      const base = `/api/v1/projects/${project.id}/optimization`;

      const cases: Array<[string, string]> = [
        [`${base}/operations`, 'getOverview'],
        [`${base}/operations/pipeline`, 'listPipeline'],
        [`${base}/operations/inbox`, 'listInbox'],
        [`${base}/operations/experiments`, 'listExperiments'],
        [`${base}/operations/feedback`, 'listFeedback'],
        [`${base}/autopilot-policy`, 'getPolicy'],
        [`${base}/autopilot-policy/revisions`, 'listPolicyRevisions'],
      ];

      for (const [url, method] of cases) {
        const response = await request(app).get(url).expect(200);
        expect(response.body.data).toBeDefined();
        expect(api.calls.at(-1)?.method).toBe(method);
        expect(api.calls.at(-1)?.projectId).toBe(project.id);
      }

      expect(api.calls.find((call) => call.method === 'listPipeline')).toMatchObject({ limit: 50, offset: 0 });
      expect(api.calls.find((call) => call.method === 'listPolicyRevisions')).toMatchObject({ limit: 25, offset: 0 });
    }
  });

  it('denies Standard projects before invoking any Operations read port', async () => {
    const project = await createProject('STANDARD');
    const api = new FakeOperationsApi();
    const app = createApp({ optimizationOperationsApi: api });
    const base = `/api/v1/projects/${project.id}/optimization`;
    const urls = [
      `${base}/operations`,
      `${base}/operations/pipeline`,
      `${base}/operations/inbox`,
      `${base}/operations/experiments`,
      `${base}/operations/feedback`,
      `${base}/autopilot-policy`,
      `${base}/autopilot-policy/revisions`,
    ];

    for (const url of urls) {
      const response = await request(app).get(url).expect(403);
      expect(response.body.error.code).toBe('FEATURE_NOT_AVAILABLE');
    }
    expect(api.calls).toHaveLength(0);
  });

  it('validates project UUID and bounded pagination before read ports', async () => {
    const project = await createProject('ADVANCED');
    const api = new FakeOperationsApi();
    const app = createApp({ optimizationOperationsApi: api });
    const base = `/api/v1/projects/${project.id}/optimization`;

    await request(app).get('/api/v1/projects/not-a-uuid/optimization/operations').expect(400);
    await request(app).get(`${base}/operations/pipeline?limit=101`).expect(400);
    await request(app).get(`${base}/operations/inbox?offset=100001`).expect(400);
    await request(app).get(`${base}/operations/feedback?limit=0`).expect(400);
    await request(app).get(`${base}/autopilot-policy/revisions?limit=101`).expect(400);
    expect(api.calls).toHaveLength(0);

    await request(app).get(`${base}/operations/pipeline?limit=7&offset=9`).expect(200);
    expect(api.calls).toEqual([
      { method: 'listPipeline', projectId: project.id, limit: 7, offset: 9 },
    ]);
  });

  it.each([
    ['actorId', (body: ReturnType<typeof validPolicyBody>) => ({ ...body, actorId: 'client:forbidden' })],
    ['allowedRiskClass', (body: ReturnType<typeof validPolicyBody>) => ({
      ...body,
      policy: { ...body.policy, allowedRiskClass: 'HIGH' },
    })],
    ['allowedOperationClasses', (body: ReturnType<typeof validPolicyBody>) => ({
      ...body,
      policy: { ...body.policy, allowedOperationClasses: ['DEPLOY'] },
    })],
  ])('rejects client authority field %s with a dedicated 400 before command invocation', async (_field, mutate) => {
    const project = await createProject('ADVANCED');
    const command = new FakePolicyRevisionCommand();
    const app = createApp({
      policyRevisionCommand: command,
      operationsActorResolver: actorResolver(),
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/optimization/autopilot-policy/revisions`)
      .send(mutate(validPolicyBody()))
      .expect(400);

    expect(response.body.error.code).toBe('POLICY_MUTATION_FIELD_FORBIDDEN');
    expect(command.calls).toHaveLength(0);
  });

  it('fails closed with 503 when no server actor can be resolved', async () => {
    const project = await createProject('ADVANCED');
    const command = new FakePolicyRevisionCommand();
    const app = createApp({ policyRevisionCommand: command });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/optimization/autopilot-policy/revisions`)
      .send(validPolicyBody())
      .expect(503);

    expect(response.body.error.code).toBe('OPERATIONS_ACTOR_UNAVAILABLE');
    expect(command.calls).toHaveLength(0);
  });

  it('injects only the server-resolved actor into a strict Policy Revision command', async () => {
    const project = await createProject('ADVANCED');
    const command = new FakePolicyRevisionCommand();
    const app = createApp({
      policyRevisionCommand: command,
      operationsActorResolver: actorResolver('operator:fixture'),
    });
    const body = validPolicyBody();

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/optimization/autopilot-policy/revisions`)
      .send(body)
      .expect(201);

    expect(response.body.data.status).toBe('APPLIED');
    expect(command.calls).toHaveLength(1);
    expect(command.calls[0]).toEqual({
      projectId: project.id,
      requestId: body.requestId,
      expectedUpdatedAt: null,
      actorId: 'operator:fixture',
      policy: body.policy,
    });
  });

  it('maps idempotent replay and policy command conflicts to the public HTTP contract', async () => {
    const project = await createProject('ADVANCED');
    const command = new FakePolicyRevisionCommand();
    const app = createApp({
      policyRevisionCommand: command,
      operationsActorResolver: actorResolver(),
    });
    const url = `/api/v1/projects/${project.id}/optimization/autopilot-policy/revisions`;

    command.result = { ...command.result, status: 'IDEMPOTENT_REPLAY' };
    const replay = await request(app).post(url).send(validPolicyBody()).expect(200);
    expect(replay.body.data.status).toBe('IDEMPOTENT_REPLAY');

    command.error = new Error('AUTOPILOT_POLICY_REVISION_CONFLICT');
    const conflict = await request(app).post(url).send(validPolicyBody()).expect(409);
    expect(conflict.body.error.code).toBe('AUTOPILOT_POLICY_CONFLICT');

    command.error = new Error('AUTOPILOT_POLICY_REVISION_IDEMPOTENCY_CONFLICT');
    const collision = await request(app).post(url).send(validPolicyBody()).expect(409);
    expect(collision.body.error.code).toBe('AUTOPILOT_POLICY_REQUEST_COLLISION');
  });
});
