import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function readSourceTree(root: string): Promise<Array<{ path: string; source: string }>> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: Array<{ path: string; source: string }> = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await readSourceTree(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push({ path: fullPath, source: await readFile(fullPath, 'utf8') });
    }
  }
  return files;
}

async function createEligibleProject() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-F authority ${suffix}`,
      slug: `p9f-authority-${suffix}`,
      primaryDomain: `p9f-authority-${suffix}.example.com`,
      planLevel: 'ADVANCED',
    },
  });
  projectIds.push(project.id);
  const policy = await prisma.autopilotPolicy.create({
    data: {
      projectId: project.id,
      enabled: true,
      dailyDraftPrLimit: 3,
      killSwitch: false,
      updatedBy: 'authority-fixture',
    },
  });
  const growth = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `authority:${randomUUID()}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: 'authority fixture',
      canonicalPage: `https://${project.primaryDomain}/authority`,
      identityPayload: { fixture: true },
    },
  });
  return { project, policy, growth };
}

async function authoritySnapshot(projectId: string) {
  return {
    policy: await prisma.autopilotPolicy.findUnique({ where: { projectId } }),
    revisions: await prisma.autopilotPolicyRevision.count({ where: { projectId } }),
    growth: await prisma.growthOpportunityIdentity.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    candidates: await prisma.optimizationCandidate.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    plans: await prisma.optimizationPlan.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    runs: await prisma.optimizationRun.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    decisions: await prisma.optimizationAutopilotDecision.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    executions: await prisma.publicationExecution.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    observations: await prisma.optimizationExperimentObservation.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    evidence: await prisma.optimizationFeedbackEvidence.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
  };
}

afterAll(async () => {
  if (projectIds.length === 0) return;
  const where = { projectId: { in: projectIds } };
  await prisma.autopilotPolicy.deleteMany({ where }).catch(() => undefined);
  await prisma.growthOpportunityIdentity.deleteMany({ where }).catch(() => undefined);
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
});

describe('P9-F Operations authority hardening', () => {
  it('keeps the Operations module free of privileged provider, queue, Git and execution dependencies', async () => {
    const moduleRoot = fileURLToPath(new URL('../../src/modules/optimization-operations/', import.meta.url));
    const files = await readSourceTree(moduleRoot);
    const clientPath = fileURLToPath(new URL('../../src/public/js/optimization-operations.js', import.meta.url));
    const clientSource = await readFile(clientPath, 'utf8');

    const forbiddenImport = /(?:from\s+|import\s*\()\s*['"][^'"]*(?:deepseek|ai[-_.]?gateway|search[^'"]*provider|visibility[^'"]*provider|github|bullmq|queue|publication[^'"]*execution[^'"]*service|experiment[^'"]*evaluator|feedback[^'"]*materializer)[^'"]*['"]/i;
    const privilegedWrite = /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;

    for (const file of files) {
      const relativePath = path.relative(moduleRoot, file.path);
      expect(file.source, `${relativePath} imports privileged runtime authority`).not.toMatch(forbiddenImport);
      if (!relativePath.startsWith('policy-revision.')) {
        expect(file.source, `${relativePath} performs a persistence write`).not.toMatch(privilegedWrite);
      }
    }

    expect(clientSource).not.toMatch(/\/(?:merge|deploy|rollback)(?:\b|\/)/i);
    expect(clientSource).not.toMatch(/global[-_]?kill[-_]?switch/i);
    expect(clientSource).not.toMatch(/deepseek|ai[-_.]?gateway|feedback[-_.]?materializer|experiment[-_.]?evaluator/i);
  });

  it('keeps every Operations GET and SSR route persisted-read only', async () => {
    const { project } = await createEligibleProject();
    const before = await authoritySnapshot(project.id);
    const app = createApp();
    const apiBase = `/api/v1/projects/${project.id}/optimization`;

    const getPaths = [
      `${apiBase}/operations`,
      `${apiBase}/operations/pipeline`,
      `${apiBase}/operations/inbox`,
      `${apiBase}/operations/experiments`,
      `${apiBase}/operations/feedback`,
      `${apiBase}/autopilot-policy`,
      `${apiBase}/autopilot-policy/revisions`,
    ];
    for (const endpoint of getPaths) {
      const response = await request(app).get(endpoint);
      expect(
        { endpoint, status: response.status, body: response.body },
        `GET ${endpoint} must stay a persisted-read success`,
      ).toMatchObject({ status: 200 });
    }
    await request(app).get(`/projects/${project.id}/optimization`).expect(200);

    const after = await authoritySnapshot(project.id);
    expect(after).toEqual(before);
  });

  it('exposes no global kill-switch write authority', async () => {
    const { project } = await createEligibleProject();
    const app = createApp();
    const endpoints = [
      `/api/v1/projects/${project.id}/optimization/global-kill-switch`,
      `/api/v1/projects/${project.id}/optimization/operations/global-kill-switch`,
    ];

    for (const endpoint of endpoints) {
      await request(app).post(endpoint).send({ enabled: true }).expect(404);
      await request(app).put(endpoint).send({ enabled: true }).expect(404);
      await request(app).patch(endpoint).send({ enabled: true }).expect(404);
      await request(app).delete(endpoint).expect(404);
    }
  });

  it('keeps the default actor rollout gate fail-closed while eligible reads remain available', async () => {
    const { project, policy } = await createEligibleProject();
    const app = createApp();

    await request(app).get(`/projects/${project.id}/optimization`).expect(200);
    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/optimization/autopilot-policy/revisions`)
      .send({
        requestId: randomUUID(),
        expectedUpdatedAt: policy.updatedAt.toISOString(),
        policy: {
          enabled: policy.enabled,
          dailyDraftPrLimit: policy.dailyDraftPrLimit,
          maxConcurrentRuns: policy.maxConcurrentRuns,
          requireFreshEvidence: policy.requireFreshEvidence,
          minimumEvidenceCoverage: policy.minimumEvidenceCoverage,
          pauseOnVerificationFailure: policy.pauseOnVerificationFailure,
          killSwitch: policy.killSwitch,
        },
      })
      .expect(503);

    expect(response.body.error.code).toBe('OPERATIONS_ACTOR_UNAVAILABLE');
    await expect(prisma.autopilotPolicyRevision.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it('keeps the development authority guide complete and placeholder-free', async () => {
    const guidePath = fileURLToPath(new URL('../../docs/development/p9-f-autonomous-operations-center.md', import.meta.url));
    const guide = await readFile(guidePath, 'utf8');

    for (const required of [
      'P7', 'P9-A', 'P9-B', 'P9-C', 'P8', 'P9-D', 'P9-E', 'P9-F',
      'farthest', 'Inbox', 'inputCutoffAt', 'quota', 'occurredAt',
      'optimistic concurrency', 'idempotency', 'actor', 'fail-closed',
      'LOW', 'CREATE_CONTENT_PAGE', '/projects/:id/optimization',
      '/api/v1/projects/:projectId/optimization/operations',
      'Merge', 'Deploy', 'Rollback', 'retention', 'vitest', 'typecheck',
    ]) {
      expect(guide, `missing guide contract: ${required}`).toContain(required);
    }
    expect(guide).not.toMatch(/\b(?:TBD|TODO|PLACEHOLDER|implement later)\b/i);
  });
});
