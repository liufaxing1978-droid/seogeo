import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { createApp } from '../../src/app.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function fixture() {
  const project = await prisma.project.create({
    data: {
      name: 'GEO Detail Project',
      slug: `geo-detail-${Date.now()}-${Math.random()}`,
      primaryDomain: 'example.com'
    }
  });
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId: project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com/',
      crawlerVersion: 'test',
      finishedAt: new Date()
    }
  });
  const page = await prisma.page.create({
    data: {
      projectId: project.id,
      url: 'https://example.com/guide',
      normalizedUrl: 'https://example.com/guide',
      host: 'example.com',
      path: '/guide'
    }
  });
  const audit = await prisma.geoAuditRun.create({
    data: {
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'COMPLETED',
      eligiblePages: 1,
      rulesEvaluated: 10,
      engineVersion: 'geo-readiness-1',
      finishedAt: new Date()
    }
  });

  await prisma.citabilityResult.create({
    data: {
      geoAuditRunId: audit.id,
      pageId: page.id,
      answerFirstScore: null,
      headingStructureScore: 80,
      factualDensityScore: null,
      sourceSupportScore: 60,
      definitionClarityScore: null,
      extractabilityScore: 90,
      overallScore: 76.67,
      engineVersion: 'geo-readiness-1',
      evidence: { unavailable: ['answerFirst', 'factualDensity', 'definitionClarity'] }
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
  await prisma.entityAlias.create({
    data: { entityId: entity.id, alias: 'Example', normalizedAlias: 'example', sourceType: 'SCHEMA' }
  });
  await prisma.entityObservation.createMany({
    data: [
      {
        geoAuditRunId: audit.id,
        entityId: entity.id,
        pageId: page.id,
        sourceType: 'SCHEMA',
        property: '@type',
        value: 'Organization'
      },
      {
        geoAuditRunId: audit.id,
        entityId: entity.id,
        pageId: page.id,
        sourceType: 'SCHEMA',
        property: 'sameAs',
        value: 'https://www.facebook.com/example'
      }
    ]
  });
  await prisma.pageEntity.create({
    data: {
      pageId: page.id,
      entityId: entity.id,
      role: 'PUBLISHER',
      sourceType: 'SCHEMA',
      confidence: 1
    }
  });

  await prisma.aiCrawlerResult.createMany({
    data: [
      {
        geoAuditRunId: audit.id,
        crawlerCode: 'OAI_SEARCHBOT',
        robotsAllowed: true,
        reachable: true,
        status: 'PASS',
        evidence: { source: 'stored robots facts' }
      },
      {
        geoAuditRunId: audit.id,
        crawlerCode: 'GPTBOT',
        robotsAllowed: false,
        reachable: true,
        status: 'FAIL',
        evidence: { source: 'stored robots facts' }
      },
      {
        geoAuditRunId: audit.id,
        crawlerCode: 'GOOGLE_EXTENDED',
        robotsAllowed: null,
        reachable: null,
        status: 'UNKNOWN',
        evidence: { reason: 'robots unavailable' }
      }
    ]
  });

  return { project, page, audit, entity };
}

describe('P3 GEO detail UI', () => {
  it('shows Citability dimensions and renders unavailable semantics as unavailable, not zero', async () => {
    const { project, page } = await fixture();
    const response = await request(createApp())
      .get(`/projects/${project.id}/geo/citability`)
      .expect(200);

    expect(response.text).toContain('Citability');
    expect(response.text).toContain(page.normalizedUrl);
    expect(response.text).toContain('76.67');
    expect(response.text).toContain('Heading Structure');
    expect(response.text).toContain('Answer First');
    expect(response.text).toContain('未采集');
    expect(response.text).not.toContain('Answer First</span><strong>0');
  });

  it('shows only persisted deterministic entities, aliases and observations', async () => {
    const { project } = await fixture();
    const response = await request(createApp())
      .get(`/projects/${project.id}/geo/entities`)
      .expect(200);

    expect(response.text).toContain('Entity');
    expect(response.text).toContain('Example Brand');
    expect(response.text).toContain('ORGANIZATION');
    expect(response.text).toContain('Example');
    expect(response.text).toContain('sameAs');
    expect(response.text).toContain('结构化事实');
  });

  it('shows PASS/FAIL/UNKNOWN AI crawler policies without claiming actual AI visibility', async () => {
    const { project } = await fixture();
    const response = await request(createApp())
      .get(`/projects/${project.id}/geo/ai-crawlers`)
      .expect(200);

    expect(response.text).toContain('AI Crawler');
    expect(response.text).toContain('OAI_SEARCHBOT');
    expect(response.text).toContain('GPTBOT');
    expect(response.text).toContain('GOOGLE_EXTENDED');
    expect(response.text).toContain('PASS');
    expect(response.text).toContain('FAIL');
    expect(response.text).toContain('UNKNOWN');
    expect(response.text).toContain('不等于 AI Visibility');
  });
});
