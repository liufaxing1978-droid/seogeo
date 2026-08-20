import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { dedupeGrowthEvidence, loadGrowthEvidence } from '../../src/modules/growth/growth-evidence.js';

const prisma = new PrismaClient();

describe('P7-A persisted growth evidence adapters', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const canonicalPage = `https://growth-${suffix}.example.com/guide`;
  let projectId = '';
  let crawlRunId = '';
  let pageId = '';
  let pageSnapshotId = '';
  let geoResultId = '';

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `Growth evidence ${suffix}`,
        slug: `growth-evidence-${suffix}`,
        primaryDomain: `growth-${suffix}.example.com`
      }
    });
    projectId = project.id;

    const crawl = await prisma.crawlRun.create({
      data: {
        projectId,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: canonicalPage,
        crawlerVersion: 'test'
      }
    });
    crawlRunId = crawl.id;

    const page = await prisma.page.create({
      data: {
        projectId,
        url: canonicalPage,
        normalizedUrl: canonicalPage,
        host: project.primaryDomain,
        path: '/guide'
      }
    });
    pageId = page.id;

    const snapshot = await prisma.pageSnapshot.create({
      data: {
        pageId,
        crawlRunId,
        finalUrl: canonicalPage,
        statusCode: 200,
        title: 'Growth evidence guide',
        h1: 'Growth evidence guide',
        wordCount: 800,
        contentHash: `growth-evidence-${suffix}`,
        parserVersion: 'test'
      }
    });
    pageSnapshotId = snapshot.id;

    const seoAudit = await prisma.seoAuditRun.create({
      data: {
        projectId,
        crawlRunId,
        status: 'COMPLETED',
        engineVersion: 'test',
        finishedAt: new Date('2026-08-17T12:00:00.000Z')
      }
    });
    const seoRule = await prisma.seoRule.create({
      data: {
        ruleCode: `GROWTH_TEST_TITLE_${suffix}`,
        name: 'Growth test title',
        category: 'ON_PAGE',
        description: 'Fixture rule.'
      }
    });
    const seoVersion = await prisma.seoRuleVersion.create({
      data: {
        seoRuleId: seoRule.id,
        version: 1,
        severity: 'HIGH',
        weight: 1,
        detectionType: 'fixture',
        seoImpact: 'Fixture impact',
        fixGuide: 'Fixture fix',
        releasedAt: new Date('2026-08-01T00:00:00.000Z')
      }
    });
    await prisma.seoRuleResult.create({
      data: {
        auditRunId: seoAudit.id,
        pageId,
        ruleVersionId: seoVersion.id,
        resultKey: `page:${pageId}`,
        outcome: 'FAIL',
        evidence: { fixture: true }
      }
    });

    const geoAudit = await prisma.geoAuditRun.create({
      data: {
        projectId,
        crawlRunId,
        status: 'COMPLETED',
        engineVersion: 'test',
        finishedAt: new Date('2026-08-17T12:00:00.000Z')
      }
    });
    const geoRule = await prisma.geoRule.create({
      data: {
        ruleCode: `GROWTH_TEST_CITABILITY_${suffix}`,
        name: 'Growth test citability',
        category: 'CITABILITY',
        description: 'Fixture rule.'
      }
    });
    const geoVersion = await prisma.geoRuleVersion.create({
      data: {
        geoRuleId: geoRule.id,
        version: 1,
        dimension: 'CITABILITY',
        severity: 'HIGH',
        weight: 1,
        detectionType: 'fixture',
        geoImpact: 'Fixture impact',
        fixGuide: 'Fixture fix',
        releasedAt: new Date('2026-08-01T00:00:00.000Z')
      }
    });
    const geoResult = await prisma.geoRuleResult.create({
      data: {
        geoAuditRunId: geoAudit.id,
        pageId,
        ruleVersionId: geoVersion.id,
        resultKey: `page:${pageId}`,
        outcome: 'FAIL',
        evidence: { fixture: true }
      }
    });
    geoResultId = geoResult.id;

    const document = await prisma.contentDocument.create({
      data: {
        projectId,
        pageId,
        latestPageSnapshotId: pageSnapshotId,
        canonicalUrl: canonicalPage,
        schemaTypes: ['Article'],
        contentHash: `growth-content-${suffix}`,
        extractedAt: new Date('2026-08-17T12:00:00.000Z')
      }
    });
    await prisma.contentSignal.createMany({
      data: [
        {
          projectId,
          contentDocumentId: document.id,
          ruleKey: 'CONTENT_CITABILITY_SUPPORT',
          ruleVersion: 1,
          status: 'FAIL',
          priority: 'MEDIUM',
          sourceReferences: [{ type: 'P3_CITABILITY', id: geoResultId }]
        },
        {
          projectId,
          contentDocumentId: document.id,
          ruleKey: 'CONTENT_BODY_SUBSTANTIVE',
          ruleVersion: 1,
          status: 'UNKNOWN',
          priority: 'LOW',
          sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: pageSnapshotId }]
        }
      ]
    });

    const competitor = await prisma.competitor.create({
      data: { projectId, name: 'Fixture competitor', domain: `competitor-${suffix}.example.com` }
    });
    const competitorCrawl = await prisma.competitorCrawl.create({
      data: {
        competitorId: competitor.id,
        status: 'COMPLETED',
        seedUrl: `https://${competitor.domain}/`,
        crawlerVersion: 'test',
        finishedAt: new Date('2026-08-17T12:00:00.000Z')
      }
    });
    await prisma.competitorComparison.create({
      data: {
        projectId,
        competitorId: competitor.id,
        competitorCrawlId: competitorCrawl.id,
        comparisonVersion: 'COMPETITOR_COMPARISON_V1',
        ownedMetrics: { wordCount: 800 },
        competitorMetrics: { wordCount: 1600 },
        gaps: [{ type: 'CONTENT_DEPTH', canonicalPage, severity: 'MEDIUM' }],
        sourceReferences: [{ type: 'CONTENT_DOCUMENT', id: document.id }]
      }
    });

    const metricSnapshot = await prisma.visibilityMetricSnapshot.create({
      data: {
        projectId,
        status: 'COMPLETED',
        formulaVersion: 'VISIBILITY_METRICS_V1',
        extractorVersion: 'test',
        subjectSetHash: `subjects-${suffix}`,
        subjectSnapshotJson: { fixture: true },
        windowStart: new Date('2026-07-21T00:00:00.000Z'),
        windowEnd: new Date('2026-08-17T23:59:59.999Z'),
        inputCutoffAt: new Date('2026-08-18T00:00:00.000Z'),
        scopeJson: { dimension: 'OVERALL' },
        scopeHash: `scope-${suffix}`,
        completedAt: new Date('2026-08-18T01:00:00.000Z')
      }
    });
    await prisma.visibilityMetricRow.create({
      data: {
        visibilityMetricSnapshotId: metricSnapshot.id,
        projectId,
        metricType: 'MENTION_RATE',
        metricStatus: 'CALCULATED',
        dimensionType: 'OVERALL',
        dimensionKey: 'overall',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'owned',
        numerator: 2,
        denominator: 10,
        candidateObservationCount: 10,
        eligibleObservationCount: 10,
        notEligibleObservationCount: 0,
        unknownObservationCount: 0
      }
    });
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.visibilityMetricRow.deleteMany({ where: { projectId } });
      await prisma.visibilityMetricSnapshot.deleteMany({ where: { projectId } });
      await prisma.competitorComparison.deleteMany({ where: { projectId } });
      const competitors = await prisma.competitor.findMany({ where: { projectId }, select: { id: true } });
      if (competitors.length > 0) {
        await prisma.competitorCrawl.deleteMany({ where: { competitorId: { in: competitors.map((row) => row.id) } } });
        await prisma.competitor.deleteMany({ where: { projectId } });
      }
      await prisma.contentSignal.deleteMany({ where: { projectId } });
      await prisma.contentDocument.deleteMany({ where: { projectId } });
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('loads bounded persisted facts from P2/P3/P5/P6 without recomputing upstream systems', async () => {
    const rows = await loadGrowthEvidence(projectId, [canonicalPage], {
      start: new Date('2026-07-21T00:00:00.000Z'),
      end: new Date('2026-08-17T23:59:59.999Z')
    });

    const modules = new Set(rows.map((row) => row.sourceModule));
    expect(modules.has('P2_SEO')).toBe(true);
    expect(modules.has('P3_CITABILITY')).toBe(true);
    expect(modules.has('P5_CONTENT')).toBe(true);
    expect(modules.has('P5_COMPETITOR')).toBe(true);
    expect(modules.has('P6_VISIBILITY')).toBe(true);

    const unknown = rows.find((row) => row.ruleKey === 'CONTENT_BODY_SUBSTANTIVE');
    expect(unknown?.evidenceState).toBe('UNKNOWN');

    const p3 = rows.find((row) => row.sourceId === geoResultId);
    const wrapped = rows.find((row) => row.ruleKey === 'CONTENT_CITABILITY_SUPPORT');
    expect(p3?.rootCauseKey).toBe(wrapped?.rootCauseKey);

    const set = dedupeGrowthEvidence(rows);
    const citability = set.scoringGroups.find((group) => group.rootCauseKey === p3?.rootCauseKey);
    expect(citability?.provenance.length).toBe(2);
  });
});
