import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { createApp } from '../../src/app.js';
import { GeoService, type GeoAuditJobQueue } from '../../src/modules/geo/geo.service.js';
import { geoApiRepository } from '../../src/modules/geo/geo.api.repository.js';

class FakeGeoQueue implements GeoAuditJobQueue {
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

function testApp(queue = new FakeGeoQueue()) {
  const service = new GeoService(geoApiRepository, queue);
  return { app: createApp({ geoService: service }), queue };
}

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function createProject() {
  return prisma.project.create({
    data: {
      name: 'GEO API Project',
      slug: `geo-api-${Date.now()}-${Math.random()}`,
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

describe('GEO audit REST API', () => {
  it('creates one queued audit for the latest completed crawl and enqueues a deterministic job', async () => {
    const project = await createProject();
    const crawl = await createCrawl(project.id, 'COMPLETED');
    const { app, queue } = testApp();

    const response = await request(app)
      .post(`/api/projects/${project.id}/geo-audits`)
      .send({})
      .expect(202);

    expect(response.body).toMatchObject({ status: 'QUEUED', existing: false });
    expect(queue.calls).toEqual([
      {
        name: 'geo-audit',
        data: { auditRunId: response.body.id },
        options: { jobId: `geo-audit-${response.body.id}` }
      }
    ]);

    const audit = await prisma.geoAuditRun.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(audit.crawlRunId).toBe(crawl.id);
  });

  it('returns the existing audit and refuses incomplete crawls', async () => {
    const project = await createProject();
    const completed = await createCrawl(project.id, 'COMPLETED');
    const running = await createCrawl(project.id, 'RUNNING');
    const { app, queue } = testApp();

    const first = await request(app)
      .post(`/api/projects/${project.id}/geo-audits`)
      .send({ crawlRunId: completed.id })
      .expect(202);
    const duplicate = await request(app)
      .post(`/api/projects/${project.id}/geo-audits`)
      .send({ crawlRunId: completed.id })
      .expect(200);

    expect(duplicate.body).toMatchObject({ id: first.body.id, existing: true });
    expect(queue.calls).toHaveLength(1);

    const rejected = await request(app)
      .post(`/api/projects/${project.id}/geo-audits`)
      .send({ crawlRunId: running.id })
      .expect(409);
    expect(rejected.body.error.code).toBe('GEO_CRAWL_NOT_COMPLETED');
  });

  it('returns summary, history, detail and deterministic GEO result views', async () => {
    const project = await createProject();
    const crawl = await createCrawl(project.id, 'COMPLETED');
    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        host: 'example.com',
        path: '/'
      }
    });
    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'COMPLETED',
        engineVersion: 'geo-readiness-1',
        eligiblePages: 1,
        rulesEvaluated: 3,
        finishedAt: new Date()
      }
    });
    const score = await prisma.geoScore.create({
      data: {
        geoAuditRunId: audit.id,
        projectId: project.id,
        scoreType: 'GEO_READINESS_V1',
        score: 82.5,
        formulaVersion: 'GEO_READINESS_V1_NORMALIZED_AVAILABLE',
        engineVersion: 'geo-readiness-1'
      }
    });
    await prisma.geoScoreComponent.create({
      data: {
        geoScoreId: score.id,
        componentCode: 'CITABILITY',
        componentName: 'Citability',
        rawScore: 80,
        weight: 30,
        weightedScore: 24,
        sourceType: 'CITABILITY_RESULTS'
      }
    });
    await prisma.citabilityResult.create({
      data: {
        geoAuditRunId: audit.id,
        pageId: page.id,
        headingStructureScore: 80,
        sourceSupportScore: 60,
        extractabilityScore: 90,
        overallScore: 76.67,
        engineVersion: 'geo-readiness-1'
      }
    });
    const entity = await prisma.entity.create({
      data: {
        projectId: project.id,
        entityType: 'ORGANIZATION',
        canonicalName: 'Example Brand',
        normalizedName: 'example brand',
        officialUrl: 'https://example.com/',
        confidence: 1
      }
    });
    await prisma.entityObservation.create({
      data: {
        geoAuditRunId: audit.id,
        entityId: entity.id,
        pageId: page.id,
        sourceType: 'SCHEMA',
        property: '@type',
        value: 'Organization'
      }
    });
    await prisma.aiCrawlerResult.create({
      data: {
        geoAuditRunId: audit.id,
        crawlerCode: 'OAI_SEARCHBOT',
        robotsAllowed: true,
        reachable: true,
        status: 'PASS'
      }
    });

    const rule = await prisma.geoRule.create({
      data: {
        ruleCode: `GEO_TEST_${Date.now()}`,
        name: 'Fixture opportunity',
        category: 'Citability',
        description: 'Fixture'
      }
    });
    const version = await prisma.geoRuleVersion.create({
      data: {
        geoRuleId: rule.id,
        version: 1,
        dimension: 'CITABILITY',
        severity: 'HIGH',
        weight: 2,
        detectionType: 'PAGE_FACT',
        geoImpact: 'Fixture impact',
        fixGuide: 'Fixture fix',
        releasedAt: new Date()
      }
    });
    await prisma.geoRuleResult.create({
      data: {
        geoAuditRunId: audit.id,
        pageId: page.id,
        ruleVersionId: version.id,
        resultKey: 'fixture:page',
        outcome: 'FAIL',
        evidence: { observed: true }
      }
    });

    const { app } = testApp();

    const summary = await request(app).get(`/api/projects/${project.id}/geo/summary`).expect(200);
    expect(summary.body.data).toMatchObject({
      auditId: audit.id,
      scoreType: 'GEO_READINESS_V1',
      score: 82.5,
      aiVisibility: null
    });

    const history = await request(app).get(`/api/projects/${project.id}/geo/audits`).expect(200);
    expect(history.body.data[0]).toMatchObject({ id: audit.id, status: 'COMPLETED' });

    const detail = await request(app).get(`/api/geo/audits/${audit.id}`).expect(200);
    expect(detail.body.data).toMatchObject({ id: audit.id, score: 82.5 });

    const citability = await request(app).get(`/api/projects/${project.id}/geo/citability`).expect(200);
    expect(citability.body.data[0]).toMatchObject({ pageId: page.id, overallScore: 76.67 });

    const entities = await request(app).get(`/api/projects/${project.id}/geo/entities`).expect(200);
    expect(entities.body.data[0]).toMatchObject({ id: entity.id, canonicalName: 'Example Brand' });

    const crawlers = await request(app).get(`/api/projects/${project.id}/geo/ai-crawlers`).expect(200);
    expect(crawlers.body.data[0]).toMatchObject({ crawlerCode: 'OAI_SEARCHBOT', status: 'PASS' });

    const opportunities = await request(app).get(`/api/projects/${project.id}/geo/opportunities`).expect(200);
    expect(opportunities.body.data[0]).toMatchObject({
      ruleCode: rule.ruleCode,
      outcome: 'FAIL',
      pageId: page.id
    });
  });
});
