import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

describe('P5-B Competitor Center web', () => {
  const projects: string[] = [];

  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('renders competitor facts and deterministic comparison separately from AI explanation', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: { name: 'Competitor Web', slug: `competitor-web-${suffix}`, primaryDomain: `owned-${suffix}.example.com`, planLevel: 'STANDARD' }
    });
    projects.push(project.id);
    const competitor = await prisma.competitor.create({
      data: { projectId: project.id, name: 'Reference Site', domain: `reference-${suffix}.example.com` }
    });
    const crawl = await prisma.competitorCrawl.create({
      data: {
        competitorId: competitor.id,
        status: 'COMPLETED',
        seedUrl: `https://${competitor.domain}/`,
        maxPages: 25,
        pagesCrawled: 3,
        crawlerVersion: 'COMPETITOR_CRAWLER_V1',
        startedAt: new Date(),
        finishedAt: new Date()
      }
    });
    const comparison = await prisma.competitorComparison.create({
      data: {
        projectId: project.id,
        competitorId: competitor.id,
        competitorCrawlId: crawl.id,
        comparisonVersion: 'COMPETITOR_COMPARISON_V1',
        ownedMetrics: { averageWordCount: 900 },
        competitorMetrics: { averageWordCount: 1200 },
        gaps: [{ metric: 'averageWordCount', state: 'BEHIND', owned: 900, competitor: 1200, delta: -300 }],
        sourceReferences: [{ type: 'COMPETITOR_CRAWL', id: crawl.id }]
      }
    });

    const app = createApp();
    const center = await request(app).get(`/projects/${project.id}/competitors`).expect(200);
    expect(center.text).toContain('竞争对手中心');
    expect(center.text).toContain('Reference Site');
    expect(center.text).toContain('确定性比较优先');

    const detail = await request(app).get(`/projects/${project.id}/competitors/${competitor.id}`).expect(200);
    expect(detail.text).toContain('COMPETITOR_COMPARISON_V1');
    expect(detail.text).toContain('BEHIND');
    expect(detail.text).toContain('DeepSeek 只解释已保存差距');
    expect(detail.text).toContain(comparison.id);
  });
});
