import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { createApp } from '../../src/app.js';
import {
  SeoService,
  type SeoAuditJobQueue
} from '../../src/modules/seo/seo.service.js';
import { seoApiRepository } from '../../src/modules/seo/seo.api.repository.js';

class FakeSeoQueue implements SeoAuditJobQueue {
  readonly calls: Array<{
    name: string;
    data: { auditRunId: string };
    options: { jobId: string };
  }> = [];

  async add(name: string, data: { auditRunId: string }, options: { jobId: string }) {
    this.calls.push({ name, data, options });
    return { id: options.jobId };
  }
}

function testApp(queue = new FakeSeoQueue()) {
  const service = new SeoService(seoApiRepository, queue);
  return { app: createApp({ seoService: service }), queue };
}

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function createProject() {
  return prisma.project.create({
    data: {
      name: 'SEO API Project',
      slug: `seo-api-${Date.now()}-${Math.random()}`,
      primaryDomain: 'example.com'
    }
  });
}

async function createCrawl(projectId: string, status: 'QUEUED' | 'RUNNING' | 'COMPLETED' = 'COMPLETED') {
  return prisma.crawlRun.create({
    data: {
      projectId,
      runType: 'MANUAL',
      status,
      seedUrl: 'https://example.com/',
      crawlerVersion: '0.1.0'
    }
  });
}

describe('SEO audit REST API', () => {
  it('creates one queued audit for the latest completed crawl and enqueues a deterministic job', async () => {
    const project = await createProject();
    const crawl = await createCrawl(project.id, 'COMPLETED');
    const { app, queue } = testApp();

    const response = await request(app)
      .post(`/api/projects/${project.id}/seo-audits`)
      .send({})
      .expect(202);

    expect(response.body).toMatchObject({ status: 'QUEUED', existing: false });
    expect(queue.calls).toEqual([
      {
        name: 'seo-audit',
        data: { auditRunId: response.body.id },
        options: { jobId: `seo-audit-${response.body.id}` }
      }
    ]);

    const audit = await prisma.seoAuditRun.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(audit.crawlRunId).toBe(crawl.id);
  });

  it('returns the existing audit and does not enqueue a duplicate for the same crawl', async () => {
    const project = await createProject();
    const crawl = await createCrawl(project.id, 'COMPLETED');
    const { app, queue } = testApp();

    const first = await request(app)
      .post(`/api/projects/${project.id}/seo-audits`)
      .send({ crawlRunId: crawl.id })
      .expect(202);

    const second = await request(app)
      .post(`/api/projects/${project.id}/seo-audits`)
      .send({ crawlRunId: crawl.id })
      .expect(200);

    expect(second.body).toMatchObject({ id: first.body.id, existing: true });
    expect(queue.calls).toHaveLength(1);
  });

  it('rejects an audit for a crawl that is not completed', async () => {
    const project = await createProject();
    const crawl = await createCrawl(project.id, 'RUNNING');
    const { app, queue } = testApp();

    const response = await request(app)
      .post(`/api/projects/${project.id}/seo-audits`)
      .send({ crawlRunId: crawl.id })
      .expect(409);

    expect(response.body.error.code).toBe('SEO_CRAWL_NOT_COMPLETED');
    expect(queue.calls).toHaveLength(0);
  });

  it('returns audit history and summary from persisted deterministic results', async () => {
    const project = await createProject();
    const crawl = await createCrawl(project.id, 'COMPLETED');
    const audit = await prisma.seoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'COMPLETED',
        engineVersion: '0.1.0',
        eligiblePages: 3,
        rulesEvaluated: 20,
        finishedAt: new Date()
      }
    });
    await prisma.seoScore.create({
      data: {
        auditRunId: audit.id,
        projectId: project.id,
        score: 87.5,
        previousScore: 82,
        change: 5.5,
        engineVersion: '0.1.0'
      }
    });

    const { app } = testApp();
    const history = await request(app)
      .get(`/api/projects/${project.id}/seo/audits`)
      .expect(200);
    expect(history.body.data[0]).toMatchObject({ id: audit.id, status: 'COMPLETED' });

    const summary = await request(app)
      .get(`/api/projects/${project.id}/seo/summary`)
      .expect(200);
    expect(summary.body.data).toMatchObject({
      auditId: audit.id,
      score: 87.5,
      previousScore: 82,
      change: 5.5,
      eligiblePages: 3
    });

    const detail = await request(app).get(`/api/seo/audits/${audit.id}`).expect(200);
    expect(detail.body.data).toMatchObject({ id: audit.id, score: 87.5 });
  });

  it('lists issue filters, returns issue detail, and forbids manual RESOLVED state', async () => {
    const project = await createProject();
    const rule = await prisma.seoRule.create({
      data: {
        ruleCode: `TITLE_MISSING_${Date.now()}`,
        name: 'Missing title fixture',
        category: 'Metadata',
        description: 'Fixture rule'
      }
    });
    const issue = await prisma.seoIssue.create({
      data: {
        projectId: project.id,
        ruleId: rule.id,
        issueKey: `rule:${rule.ruleCode}`,
        title: 'Missing title fixture',
        category: 'Metadata',
        currentSeverity: 'HIGH',
        status: 'OPEN',
        firstSeenAt: new Date(),
        lastSeenAt: new Date()
      }
    });

    const { app } = testApp();
    const listed = await request(app)
      .get(`/api/projects/${project.id}/seo/issues?severity=HIGH&status=OPEN&limit=10&offset=0`)
      .expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(issue.id);

    const detail = await request(app).get(`/api/seo/issues/${issue.id}`).expect(200);
    expect(detail.body.data).toMatchObject({ id: issue.id, status: 'OPEN' });

    await request(app)
      .patch(`/api/seo/issues/${issue.id}/status`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
    expect((await prisma.seoIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('IN_PROGRESS');

    const resolved = await request(app)
      .patch(`/api/seo/issues/${issue.id}/status`)
      .send({ status: 'RESOLVED' })
      .expect(400);
    expect(resolved.body.error.code).toBe('VALIDATION_ERROR');
  });
});
