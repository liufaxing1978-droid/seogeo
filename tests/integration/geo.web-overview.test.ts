import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const app = createApp();

describe('GEO overview web page', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  it('renders a factual empty state and keeps AI Visibility waiting for P6 sampling', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'GEO Project',
        slug: `geo-web-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const response = await request(app).get(`/projects/${project.id}/geo`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('GEO Readiness');
    expect(response.text).toContain('尚无 GEO 审计');
    expect(response.text).toContain('等待 P6 真实采样');
    expect(response.text).not.toContain('AI Visibility</div><div class="metric-value">0');
  });

  it('renders stored GEO_READINESS_V1 dimensions without inventing AI Visibility', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Scored GEO Project',
        slug: `geo-scored-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });
    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: '0.1.0',
        finishedAt: new Date()
      }
    });
    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'COMPLETED',
        engineVersion: 'geo-readiness-1',
        eligiblePages: 4,
        rulesEvaluated: 12,
        finishedAt: new Date()
      }
    });
    await prisma.geoScore.create({
      data: {
        geoAuditRunId: audit.id,
        projectId: project.id,
        scoreType: 'GEO_READINESS_V1',
        score: 82,
        formulaVersion: 'GEO_READINESS_V1_NORMALIZED_AVAILABLE',
        engineVersion: 'geo-readiness-1',
        components: {
          create: [
            {
              componentCode: 'CITABILITY',
              componentName: 'Citability',
              rawScore: 80,
              weight: 30,
              weightedScore: 24,
              sourceType: 'CITABILITY_RESULTS'
            },
            {
              componentCode: 'ENTITY',
              componentName: 'Entity Authority / Clarity',
              rawScore: 84,
              weight: 25,
              weightedScore: 21,
              sourceType: 'ENTITY_OBSERVATIONS'
            }
          ]
        }
      }
    });

    const response = await request(app).get(`/projects/${project.id}/geo`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('82');
    expect(response.text).toContain('Citability');
    expect(response.text).toContain('80');
    expect(response.text).toContain('Entity');
    expect(response.text).toContain('84');
    expect(response.text).toContain('等待 P6 真实采样');
  });
});
