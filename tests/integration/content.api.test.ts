import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import type { ContentService } from '../../src/modules/content/content.service.js';

describe('P5-A content API', () => {
  const projects: string[] = [];
  afterAll(async () => { for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined); });

  it('lists only project content and enqueues a stable refresh', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'api', slug: `api-${suffix}`, primaryDomain: `api-${suffix}.example.com`, planLevel: 'STANDARD' } });
    projects.push(project.id);
    const fakeService = { async enqueueRefresh(projectId: string) { return { jobId: `content-refresh-${projectId}`, deduplicated: false }; } } as unknown as ContentService;
    const app = createApp({ contentService: fakeService });

    const list = await request(app).get(`/api/v1/projects/${project.id}/content/documents`).expect(200);
    expect(list.body.data).toEqual([]);
    const refresh = await request(app).post(`/api/v1/projects/${project.id}/content/refresh`).expect(202);
    expect(refresh.body.data.jobId).toBe(`content-refresh-${project.id}`);
  });

  it('rejects manual VERIFIED_FIXED state', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'state', slug: `state-${suffix}`, primaryDomain: `state-${suffix}.example.com`, planLevel: 'STANDARD' } });
    projects.push(project.id);
    const crawl = await prisma.crawlRun.create({ data: { projectId: project.id, runType: 'MANUAL', status: 'COMPLETED', seedUrl: `https://${project.primaryDomain}`, crawlerVersion: 'test' } });
    const page = await prisma.page.create({ data: { projectId: project.id, url: `https://${project.primaryDomain}/a`, normalizedUrl: `https://${project.primaryDomain}/a`, host: project.primaryDomain, path: '/a' } });
    const snapshot = await prisma.pageSnapshot.create({ data: { pageId: page.id, crawlRunId: crawl.id, finalUrl: page.url, contentHash: `h-${suffix}`, parserVersion: 'test' } });
    const document = await prisma.contentDocument.create({ data: { projectId: project.id, pageId: page.id, latestPageSnapshotId: snapshot.id, canonicalUrl: page.url, schemaTypes: [], contentHash: `h-${suffix}`, extractedAt: snapshot.capturedAt } });
    const opportunity = await prisma.contentOpportunity.create({ data: { projectId: project.id, contentDocumentId: document.id, opportunityKey: 'x:v1', opportunityVersion: 1, category: 'BASICS', priority: 'HIGH', summary: 'Fix', sourceReferences: [], firstDetectedAt: new Date(), lastDetectedAt: new Date() } });
    const app = createApp({ contentService: { enqueueRefresh: async () => ({ jobId: 'x', deduplicated: false }) } as unknown as ContentService });
    await request(app).patch(`/api/v1/projects/${project.id}/content/opportunities/${opportunity.id}`).send({ status: 'VERIFIED_FIXED' }).expect(400);
  });
});
