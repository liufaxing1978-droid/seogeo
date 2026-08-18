import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { createApp } from '../../src/app.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('GEO overview UI', () => {
  it('renders deterministic GEO readiness and keeps AI Visibility explicitly unavailable', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'GEO UI Project',
        slug: `geo-ui-${Date.now()}`,
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
    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'COMPLETED',
        eligiblePages: 8,
        rulesEvaluated: 42,
        engineVersion: 'geo-readiness-1',
        finishedAt: new Date()
      }
    });
    const score = await prisma.geoScore.create({
      data: {
        geoAuditRunId: audit.id,
        projectId: project.id,
        scoreType: 'GEO_READINESS_V1',
        score: 78.5,
        previousScore: 74,
        change: 4.5,
        formulaVersion: 'GEO_READINESS_V1_NORMALIZED_AVAILABLE',
        engineVersion: 'geo-readiness-1'
      }
    });
    for (const component of [
      ['CITABILITY', 'Citability', 82, 30, 24.6, 'CITABILITY_RESULTS'],
      ['ENTITY', 'Entity Authority / Clarity', 70, 25, 17.5, 'ENTITY_OBSERVATIONS'],
      ['AI_CRAWLER', 'Technical AI Readiness', 83, 20, 16.6, 'AI_CRAWLER_RESULTS'],
      ['BRAND', 'Brand Authority / Consistency', 76, 15, 11.4, 'BRAND_READINESS'],
      ['CONTENT_GEO', 'Content GEO Quality', 84, 10, 8.4, 'PAGE_FACTS']
    ] as const) {
      await prisma.geoScoreComponent.create({
        data: {
          geoScoreId: score.id,
          componentCode: component[0],
          componentName: component[1],
          rawScore: component[2],
          weight: component[3],
          weightedScore: component[4],
          sourceType: component[5]
        }
      });
    }
    await prisma.brandAuthorityResult.create({
      data: {
        geoAuditRunId: audit.id,
        officialIdentityPresent: true,
        organizationSchemaPresent: true,
        sameAsCount: 3,
        publisherConsistency: 100,
        contactIdentityConsistency: 0,
        aboutPagePresent: true,
        overallScore: 86,
        evidence: { availability: { contactIdentityConsistency: false } }
      }
    });
    await prisma.aiCrawlerResult.createMany({
      data: [
        { geoAuditRunId: audit.id, crawlerCode: 'OAI_SEARCHBOT', robotsAllowed: true, reachable: true, status: 'PASS' },
        { geoAuditRunId: audit.id, crawlerCode: 'GPTBOT', robotsAllowed: false, reachable: true, status: 'FAIL' }
      ]
    });

    const rule = await prisma.geoRule.create({
      data: {
        ruleCode: `UI_OPPORTUNITY_${Date.now()}`,
        name: 'Improve citation support',
        category: 'Citability',
        description: 'Fixture opportunity'
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
        geoImpact: 'Weak source support',
        fixGuide: 'Add explicit source links',
        releasedAt: new Date()
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
  });
});
