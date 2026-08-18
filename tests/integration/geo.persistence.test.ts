import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
  await prisma.geoRule.deleteMany();
});

describe('P3 GEO persistence foundation', () => {
  it('persists audit-linked GEO facts while preserving P1/P2 history when a GEO audit is removed', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'GEO Fixture',
        slug: `geo-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const crawlRun = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        maxPages: 10,
        pagesDiscovered: 1,
        pagesCrawled: 1,
        pagesSucceeded: 1,
        crawlerVersion: '0.1.0',
        startedAt: new Date(),
        finishedAt: new Date()
      }
    });

    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        host: 'example.com',
        path: '/'
      }
    });

    const snapshot = await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawlRun.id,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Example Organization',
        canonicalUrl: 'https://example.com/',
        h1: 'Example Organization',
        h1Count: 1,
        wordCount: 500,
        schemaCount: 1,
        indexable: true,
        parserVersion: '0.1.0'
      }
    });

    const seoAudit = await prisma.seoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'COMPLETED',
        engineVersion: 'p2-test',
        eligiblePages: 1,
        rulesEvaluated: 20,
        startedAt: new Date(),
        finishedAt: new Date()
      }
    });

    const geoAudit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'COMPLETED',
        eligiblePages: 1,
        rulesEvaluated: 1,
        engineVersion: 'geo-0.1.0',
        startedAt: new Date(),
        finishedAt: new Date()
      }
    });

    const rule = await prisma.geoRule.create({
      data: {
        ruleCode: 'CITABILITY_NO_CLEAR_H1',
        name: 'No clear H1',
        category: 'Citability',
        description: 'A citation-ready page should expose a clear primary heading.'
      }
    });

    const ruleVersion = await prisma.geoRuleVersion.create({
      data: {
        geoRuleId: rule.id,
        version: 1,
        dimension: 'CITABILITY',
        severity: 'MEDIUM',
        weight: 1.5,
        detectionType: 'PAGE_FACT',
        detectionConfig: { requiredH1Count: 1 },
        geoImpact: 'Weak heading identity reduces extractability.',
        fixGuide: 'Expose one factual primary heading.',
        releasedAt: new Date()
      }
    });

    const organization = await prisma.entity.create({
      data: {
        projectId: project.id,
        entityType: 'ORGANIZATION',
        canonicalName: 'Example Organization',
        normalizedName: 'example organization',
        officialUrl: 'https://example.com/',
        confidence: 1
      }
    });

    const service = await prisma.entity.create({
      data: {
        projectId: project.id,
        entityType: 'SERVICE',
        canonicalName: 'Example Service',
        normalizedName: 'example service',
        officialUrl: 'https://example.com/service',
        confidence: 0.95
      }
    });

    await prisma.entityAlias.create({
      data: {
        entityId: organization.id,
        alias: 'Example',
        normalizedAlias: 'example',
        sourceType: 'SCHEMA'
      }
    });

    await prisma.entityRelation.create({
      data: {
        projectId: project.id,
        sourceEntityId: organization.id,
        relationType: 'OFFERS',
        targetEntityId: service.id,
        sourcePageId: page.id,
        confidence: 1,
        evidence: { source: 'schema' }
      }
    });

    await prisma.entityObservation.create({
      data: {
        geoAuditRunId: geoAudit.id,
        entityId: organization.id,
        pageId: page.id,
        sourceType: 'SCHEMA',
        property: 'name',
        value: 'Example Organization',
        evidence: { schemaType: 'Organization' }
      }
    });

    await prisma.pageEntity.create({
      data: {
        pageId: page.id,
        entityId: organization.id,
        role: 'PUBLISHER',
        confidence: 1,
        sourceType: 'SCHEMA'
      }
    });

    await prisma.geoRuleResult.create({
      data: {
        geoAuditRunId: geoAudit.id,
        pageId: page.id,
        entityId: organization.id,
        ruleVersionId: ruleVersion.id,
        resultKey: `page:${page.id}`,
        outcome: 'PASS',
        evidence: { h1Count: 1 }
      }
    });

    await prisma.citabilityResult.create({
      data: {
        geoAuditRunId: geoAudit.id,
        pageId: page.id,
        answerFirstScore: 80,
        headingStructureScore: 100,
        factualDensityScore: 70,
        sourceSupportScore: 60,
        extractabilityScore: 85,
        definitionClarityScore: 75,
        overallScore: 78,
        evidence: { h1Count: 1, wordCount: 500 },
        engineVersion: 'geo-0.1.0'
      }
    });

    await prisma.aiCrawlerResult.create({
      data: {
        geoAuditRunId: geoAudit.id,
        crawlerCode: 'GPTBOT',
        robotsAllowed: true,
        metaRobotsAllowed: true,
        xRobotsAllowed: null,
        reachable: true,
        status: 'PASS',
        evidence: { robotsSource: 'stored-p1-fact' }
      }
    });

    await prisma.brandAuthorityResult.create({
      data: {
        geoAuditRunId: geoAudit.id,
        officialIdentityPresent: true,
        organizationSchemaPresent: true,
        sameAsCount: 2,
        publisherConsistency: 100,
        contactIdentityConsistency: 100,
        aboutPagePresent: true,
        overallScore: 95,
        evidence: { source: 'owned-signals' }
      }
    });

    const score = await prisma.geoScore.create({
      data: {
        geoAuditRunId: geoAudit.id,
        projectId: project.id,
        scoreType: 'GEO_READINESS_V1',
        score: 82,
        formulaVersion: 'GEO_READINESS_V1',
        engineVersion: 'geo-0.1.0'
      }
    });

    await prisma.geoScoreComponent.createMany({
      data: [
        {
          geoScoreId: score.id,
          componentCode: 'CITABILITY',
          componentName: 'Citability',
          rawScore: 78,
          weight: 0.3,
          weightedScore: 23.4,
          sourceType: 'CITABILITY_RESULT'
        },
        {
          geoScoreId: score.id,
          componentCode: 'ENTITY',
          componentName: 'Entity clarity',
          rawScore: 90,
          weight: 0.25,
          weightedScore: 22.5,
          sourceType: 'ENTITY_OBSERVATION'
        }
      ]
    });

    expect(await prisma.geoAuditRun.count({ where: { projectId: project.id } })).toBe(1);
    expect(await prisma.geoRuleResult.count({ where: { geoAuditRunId: geoAudit.id } })).toBe(1);
    expect(await prisma.citabilityResult.count({ where: { geoAuditRunId: geoAudit.id } })).toBe(1);
    expect(await prisma.entity.count({ where: { projectId: project.id } })).toBe(2);
    expect(await prisma.entityObservation.count({ where: { geoAuditRunId: geoAudit.id } })).toBe(1);
    expect(await prisma.aiCrawlerResult.count({ where: { geoAuditRunId: geoAudit.id } })).toBe(1);
    expect(await prisma.brandAuthorityResult.count({ where: { geoAuditRunId: geoAudit.id } })).toBe(1);
    expect(await prisma.geoScoreComponent.count({ where: { geoScoreId: score.id } })).toBe(2);

    await prisma.geoAuditRun.delete({ where: { id: geoAudit.id } });

    expect(await prisma.geoRuleResult.count()).toBe(0);
    expect(await prisma.citabilityResult.count()).toBe(0);
    expect(await prisma.entityObservation.count()).toBe(0);
    expect(await prisma.aiCrawlerResult.count()).toBe(0);
    expect(await prisma.brandAuthorityResult.count()).toBe(0);
    expect(await prisma.geoScore.count()).toBe(0);

    expect(await prisma.crawlRun.findUnique({ where: { id: crawlRun.id } })).not.toBeNull();
    expect(await prisma.pageSnapshot.findUnique({ where: { id: snapshot.id } })).not.toBeNull();
    expect(await prisma.seoAuditRun.findUnique({ where: { id: seoAudit.id } })).not.toBeNull();
    expect(await prisma.entity.count({ where: { projectId: project.id } })).toBe(2);
  });

  it('keeps GEO readiness history append-only across separate audit runs', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'GEO History',
        slug: `geo-history-${Date.now()}`,
        primaryDomain: 'history.example.com'
      }
    });

    const crawlRun = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://history.example.com/',
        crawlerVersion: '0.1.0'
      }
    });

    const firstAudit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'COMPLETED',
        engineVersion: 'geo-0.1.0'
      }
    });
    const secondAudit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'COMPLETED',
        engineVersion: 'geo-0.2.0'
      }
    });

    await prisma.geoScore.createMany({
      data: [
        {
          geoAuditRunId: firstAudit.id,
          projectId: project.id,
          scoreType: 'GEO_READINESS_V1',
          score: 60,
          formulaVersion: 'GEO_READINESS_V1',
          engineVersion: 'geo-0.1.0'
        },
        {
          geoAuditRunId: secondAudit.id,
          projectId: project.id,
          scoreType: 'GEO_READINESS_V1',
          score: 75,
          previousScore: 60,
          change: 15,
          formulaVersion: 'GEO_READINESS_V1',
          engineVersion: 'geo-0.2.0'
        }
      ]
    });

    const scores = await prisma.geoScore.findMany({
      where: { projectId: project.id },
      orderBy: { calculatedAt: 'asc' }
    });

    expect(scores).toHaveLength(2);
    expect(scores.map((item) => item.score)).toEqual([60, 75]);
    expect(scores[1]?.previousScore).toBe(60);
    expect(scores[1]?.change).toBe(15);
  });
});
