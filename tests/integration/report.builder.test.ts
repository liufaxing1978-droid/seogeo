import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { generateProjectReport } from '../../src/modules/reporting/report-builder.js';

describe('P5-C deterministic report builder', () => {
  const projects: string[] = [];

  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('separates persisted facts from advisory AI summaries and preserves missing GEO as null', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: { name: 'Report Builder', slug: `report-builder-${suffix}`, primaryDomain: `report-builder-${suffix}.example.com` }
    });
    projects.push(project.id);
    const crawl = await prisma.crawlRun.create({
      data: { projectId: project.id, runType: 'MANUAL', status: 'COMPLETED', seedUrl: `https://${project.primaryDomain}/`, crawlerVersion: 'test', finishedAt: new Date() }
    });
    const seoAudit = await prisma.seoAuditRun.create({
      data: { projectId: project.id, crawlRunId: crawl.id, status: 'COMPLETED', engineVersion: 'test', finishedAt: new Date() }
    });
    const seoScore = await prisma.seoScore.create({
      data: { auditRunId: seoAudit.id, projectId: project.id, score: 88, previousScore: 84, change: 4, engineVersion: 'test' }
    });
    const page = await prisma.page.create({
      data: { projectId: project.id, url: `https://${project.primaryDomain}/guide`, normalizedUrl: `https://${project.primaryDomain}/guide`, host: project.primaryDomain, path: '/guide' }
    });
    const snapshot = await prisma.pageSnapshot.create({
      data: { pageId: page.id, crawlRunId: crawl.id, finalUrl: page.url, title: 'Guide', h1: 'Guide', wordCount: 900, contentHash: `hash-${suffix}`, parserVersion: 'test' }
    });
    const document = await prisma.contentDocument.create({
      data: { projectId: project.id, pageId: page.id, latestPageSnapshotId: snapshot.id, canonicalUrl: page.url, title: 'Guide', h1: 'Guide', wordCount: 900, headingCount: 3, internalLinkCount: 4, schemaTypes: [], contentHash: `hash-${suffix}`, extractedAt: snapshot.capturedAt }
    });
    await prisma.contentOpportunity.create({
      data: { projectId: project.id, contentDocumentId: document.id, opportunityKey: 'CONTENT_CITABILITY_SUPPORT', opportunityVersion: 1, category: 'CITABILITY', priority: 'HIGH', summary: 'Add stronger evidence support.', sourceReferences: [{ type: 'CONTENT_DOCUMENT', id: document.id }], firstDetectedAt: new Date(), lastDetectedAt: new Date() }
    });
    const competitor = await prisma.competitor.create({ data: { projectId: project.id, name: 'Reference Site', domain: `reference-${suffix}.example.com` } });
    const rivalCrawl = await prisma.competitorCrawl.create({
      data: { competitorId: competitor.id, status: 'COMPLETED', seedUrl: `https://${competitor.domain}/`, maxPages: 25, pagesCrawled: 3, crawlerVersion: 'COMPETITOR_CRAWLER_V1', startedAt: new Date(), finishedAt: new Date() }
    });
    const comparison = await prisma.competitorComparison.create({
      data: { projectId: project.id, competitorId: competitor.id, competitorCrawlId: rivalCrawl.id, comparisonVersion: 'COMPETITOR_COMPARISON_V1', ownedMetrics: { averageWordCount: 900 }, competitorMetrics: { averageWordCount: 1200 }, gaps: [{ metric: 'averageWordCount', owned: 900, competitor: 1200, delta: -300, state: 'BEHIND' }], sourceReferences: [{ type: 'COMPETITOR_CRAWL', id: rivalCrawl.id }] }
    });

    const report = await generateProjectReport(project.id);
    const facts = report.factSnapshot as any;
    const advisory = report.advisorySnapshot as any;

    expect(report.reportVersion).toBe('PROJECT_REPORT_V1');
    expect(facts.seo.score.value).toBe(88);
    expect(facts.geo.score).toBeNull();
    expect(facts.content.documentCount).toBe(1);
    expect(facts.content.openOpportunityCount).toBe(1);
    expect(facts.competitors.count).toBe(1);
    expect(facts.competitors.gapStates.BEHIND).toBe(1);
    expect(advisory.ai).toEqual([]);
    expect(JSON.stringify(report.sourceReferences)).toContain(seoScore.id);
    expect(JSON.stringify(report.sourceReferences)).toContain(comparison.id);
    expect(JSON.stringify(facts)).not.toContain('aiVisibility');
  });
});
