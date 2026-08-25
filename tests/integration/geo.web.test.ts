import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const app = createApp();

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('GEO overview UI', () => {
  it('renders deterministic GEO readiness and keeps AI Visibility explicitly unavailable', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'GEO UI Project',
        slug: `geo-ui-${suffix}`,
        primaryDomain: 'example.com',
        planLevel: 'ADVANCED'
      }
    });
    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        status: 'COMPLETED',
        startedAt: new Date(),
        finishedAt: new Date(),
        pagesDiscovered: 8,
        pagesCrawled: 8
      }
    });
    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'COMPLETED',
        scoreType: 'GEO_READINESS_V1',
        score: 78.5,
        previousScore: 74,
        scoreChange: 4.5,
        completedAt: new Date()
      }
    });
    await prisma.geoScoreBreakdown.createMany({
      data: [
        { geoAuditRunId: audit.id, dimension: 'AI_CRAWLER', label: 'Technical AI Readiness', rawScore: 83, weight: 0.2, weightedScore: 16.6, sourceType: 'AI_CRAWLER_RESULTS' },
        { geoAuditRunId: audit.id, dimension: 'BRAND', label: 'Brand Authority / Consistency', rawScore: 76, weight: 0.15, weightedScore: 11.4, sourceType: 'BRAND_READINESS' },
        { geoAuditRunId: audit.id, dimension: 'CITABILITY', label: 'Citability', rawScore: 82, weight: 0.3, weightedScore: 24.6, sourceType: 'CITABILITY_RESULTS' },
        { geoAuditRunId: audit.id, dimension: 'CONTENT_GEO', label: 'Content GEO Quality', rawScore: 84, weight: 0.1, weightedScore: 8.4, sourceType: 'PAGE_FACTS' },
        { geoAuditRunId: audit.id, dimension: 'ENTITY', label: 'Entity Authority / Clarity', rawScore: 70, weight: 0.25, weightedScore: 17.5, sourceType: 'ENTITY_OBSERVATIONS' }
      ]
    });
    await prisma.geoCrawlerReadiness.createMany({
      data: [
        { geoAuditRunId: audit.id, crawler: 'GPTBOT', outcome: 'FAIL', robotsAllowed: false, reachable: true },
        { geoAuditRunId: audit.id, crawler: 'OAI_SEARCHBOT', outcome: 'PASS', robotsAllowed: true, reachable: true }
      ]
    });
    const rule = await prisma.geoRule.create({
      data: {
        ruleKey: `UI_OPPORTUNITY_${Date.now()}`,
        dimension: 'CITABILITY',
        title: 'Improve citation support',
        description: 'Add explicit source links',
        severity: 'HIGH',
        scope: 'PROJECT'
      }
    });
    const version = await prisma.geoRuleVersion.create({
      data: {
        geoRuleId: rule.id,
        version: 1,
        engineVersion: 'geo-readiness-1',
        active: true,
        config: {}
      }
    });
    await prisma.geoRuleResult.create({
      data: {
        geoAuditRunId: audit.id,
        ruleVersionId: version.id,
        resultKey: 'ui-opportunity',
        outcome: 'FAIL'
      }
    });

    const response = await request(createApp()).get(`/projects/${project.id}/geo`).expect(200);

    expect(response.text).toContain('GEO Readiness');
    expect(response.text).toContain('78.5');
    expect(response.text).toContain('Citability');
    expect(response.text).toContain('Entity Authority');
    expect(response.text).toContain('Technical AI Readiness');
    expect(response.text).toContain('Brand');
    expect(response.text).toContain('Content GEO');
    expect(response.text).toContain('Improve citation support');
    expect(response.text).toContain('AI Visibility');
    expect(response.text).toContain('尚未采样');
    expect(response.text).not.toContain('AI Visibility</div><div class="metric-value">0');

    expect(response.text).toContain(`href="/projects/${project.id}/geo"`);
    expect(response.text).toContain(`href="/projects/${project.id}/geo/citability"`);
    expect(response.text).toContain(`href="/projects/${project.id}/geo/entities"`);
    expect(response.text).toContain(`href="/projects/${project.id}/geo/ai-crawlers"`);
    expect(response.text).toContain('当前 P3 的 GEO Readiness 来自站内可验证事实');
  });
});
