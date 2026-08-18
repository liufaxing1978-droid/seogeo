import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService, type AiTaskJobQueue } from '../../src/modules/ai/ai.service.js';

class FakeQueue implements AiTaskJobQueue {
  calls: Array<{ name: string; data: { taskId: string }; options: { jobId: string; attempts: number } }> = [];
  async add(name: string, data: { taskId: string }, options: { jobId: string; attempts: number }) {
    this.calls.push({ name, data, options });
    return undefined;
  }
}

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function fixture(planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' = 'STANDARD') {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: { name: 'AI Center', slug: `ai-center-${suffix}`, primaryDomain: 'example.com', planLevel }
  });
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId: project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com/',
      maxPages: 10,
      crawlerVersion: 'fixture',
      finishedAt: new Date()
    }
  });
  const seoAudit = await prisma.seoAuditRun.create({
    data: {
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'COMPLETED',
      eligiblePages: 0,
      rulesEvaluated: 0,
      engineVersion: 'seo-fixture',
      finishedAt: new Date()
    }
  });
  const geoAudit = await prisma.geoAuditRun.create({
    data: {
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'COMPLETED',
      eligiblePages: 0,
      rulesEvaluated: 0,
      engineVersion: 'geo-fixture',
      finishedAt: new Date()
    }
  });
  return { project, seoAudit, geoAudit };
}

describe('P4 AI REST API', () => {
  it('creates idempotent SEO/GEO/entity tasks for a STANDARD project without exposing provider secrets', async () => {
    const { project, seoAudit, geoAudit } = await fixture('STANDARD');
    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);
    const app = createApp({ aiTaskService: service });

    const seo1 = await request(app)
      .post(`/api/v1/projects/${project.id}/ai/seo-analysis`)
      .send({ auditRunId: seoAudit.id })
      .expect(202);
    const seo2 = await request(app)
      .post(`/api/v1/projects/${project.id}/ai/seo-analysis`)
      .send({ auditRunId: seoAudit.id })
      .expect(202);
    const geo = await request(app)
      .post(`/api/v1/projects/${project.id}/ai/geo-analysis`)
      .send({ geoAuditRunId: geoAudit.id })
      .expect(202);
    const entity = await request(app)
      .post(`/api/v1/projects/${project.id}/ai/entity-enrichment`)
      .send({ geoAuditRunId: geoAudit.id })
      .expect(202);

    expect(seo2.body.data.id).toBe(seo1.body.data.id);
    expect(geo.body.data.taskType).toBe('GEO_READINESS_ANALYSIS');
    expect(entity.body.data.taskType).toBe('ENTITY_ENRICHMENT');
    expect(queue.calls).toHaveLength(3);
    const serialized = JSON.stringify([seo1.body, geo.body, entity.body]);
    expect(serialized).not.toMatch(/apiKey|authorization|DEEPSEEK_API_KEY/i);
  });

  it('lists and reads project-scoped tasks and rejects cross-project task reads', async () => {
    const first = await fixture();
    const second = await fixture();
    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);
    const app = createApp({ aiTaskService: service });

    const created = await request(app)
      .post(`/api/v1/projects/${first.project.id}/ai/seo-analysis`)
      .send({ auditRunId: first.seoAudit.id })
      .expect(202);

    const list = await request(app).get(`/api/v1/projects/${first.project.id}/ai/tasks`).expect(200);
    expect(list.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.data.id })]));

    await request(app).get(`/api/v1/ai/tasks/${created.body.data.id}?projectId=${first.project.id}`).expect(200);
    await request(app).get(`/api/v1/ai/tasks/${created.body.data.id}?projectId=${second.project.id}`).expect(404);
  });

  it('retries FAILED tasks but rejects retry while task is not failed', async () => {
    const { project, seoAudit } = await fixture();
    const queue = new FakeQueue();
    const repository = new AiRepository();
    const service = new AiTaskService(repository, queue);
    const app = createApp({ aiTaskService: service });

    const created = await request(app)
      .post(`/api/v1/projects/${project.id}/ai/seo-analysis`)
      .send({ auditRunId: seoAudit.id })
      .expect(202);
    const taskId = created.body.data.id as string;

    await request(app).post(`/api/v1/ai/tasks/${taskId}/retry`).send({ projectId: project.id }).expect(409);
    await repository.markTaskFailed(taskId, 'FIXTURE', 'fixture failure');
    const retried = await request(app)
      .post(`/api/v1/ai/tasks/${taskId}/retry`)
      .send({ projectId: project.id })
      .expect(202);
    expect(retried.body.data.status).toBe('QUEUED');
    expect(queue.calls).toHaveLength(2);
  });
});
