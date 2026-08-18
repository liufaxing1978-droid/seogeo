import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

describe('P5-A Content Center web', () => {
  const projects: string[] = [];
  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('renders deterministic content facts separately from AI advice', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'Content Web', slug: `content-web-${suffix}`, primaryDomain: `content-web-${suffix}.example.com`, planLevel: 'STANDARD' } });
    projects.push(project.id);
    const crawl = await prisma.crawlRun.create({ data: { projectId: project.id, runType: 'MANUAL', status: 'COMPLETED', seedUrl: `https://${project.primaryDomain}`, crawlerVersion: 'test' } });
    const page = await prisma.page.create({ data: { projectId: project.id, url: `https://${project.primaryDomain}/guide`, normalizedUrl: `https://${project.primaryDomain}/guide`, host: project.primaryDomain, path: '/guide' } });
    const snapshot = await prisma.pageSnapshot.create({ data: { pageId: page.id, crawlRunId: crawl.id, finalUrl: page.url, title: 'Content Guide', h1: 'Content Guide', h1Count: 1, h2Count: 2, h3Count: 0, wordCount: 900, internalLinksCount: 4, contentHash: `hash-${suffix}`, parserVersion: 'test' } });
    const document = await prisma.contentDocument.create({ data: { projectId: project.id, pageId: page.id, latestPageSnapshotId: snapshot.id, canonicalUrl: page.url, title: 'Content Guide', h1: 'Content Guide', wordCount: 900, headingCount: 3, internalLinkCount: 4, schemaTypes: [], contentHash: `hash-${suffix}`, extractedAt: snapshot.capturedAt } });
    await prisma.contentSignal.create({ data: { projectId: project.id, contentDocumentId: document.id, ruleKey: 'CONTENT_BODY_SUBSTANTIVE', ruleVersion: 1, status: 'PASS', priority: 'HIGH', numericValue: 900, sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: snapshot.id }] } });

    const app = createApp();
    const center = await request(app).get(`/projects/${project.id}/content`).expect(200);
    expect(center.text).toContain('内容中心');
    expect(center.text).toContain('Content Guide');
    expect(center.text).toContain('确定性事实优先');

    const detail = await request(app).get(`/projects/${project.id}/content/documents/${document.id}`).expect(200);
    expect(detail.text).toContain('确定性 Signals');
    expect(detail.text).toContain('DeepSeek 建议');
    expect(detail.text).toContain('CONTENT_BODY_SUBSTANTIVE');
  });
});
