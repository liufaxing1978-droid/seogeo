import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { contentRepository } from '../../src/modules/content/content.repository.js';
import { evaluateContentDocument } from '../../src/modules/content/content-rules.js';
import { buildContentFacts } from '../../src/modules/content/content-facts.js';

describe('P5-A content opportunities', () => {
  const ids: string[] = [];
  afterAll(async () => {
    for (const id of ids) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('opens deterministic failures and only deterministic PASS verifies them fixed', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'opp', slug: `opp-${suffix}`, primaryDomain: `opp-${suffix}.example.com` } });
    ids.push(project.id);
    const crawl = await prisma.crawlRun.create({ data: { projectId: project.id, runType: 'MANUAL', status: 'COMPLETED', seedUrl: `https://${project.primaryDomain}`, crawlerVersion: 'test' } });
    const page = await prisma.page.create({ data: { projectId: project.id, url: `https://${project.primaryDomain}/a`, normalizedUrl: `https://${project.primaryDomain}/a`, host: project.primaryDomain, path: '/a' } });
    const snapshot = await prisma.pageSnapshot.create({ data: { pageId: page.id, crawlRunId: crawl.id, finalUrl: page.url, title: '', h1: '', wordCount: 100, h1Count: 1, h2Count: 0, h3Count: 0, internalLinksCount: 0, contentHash: `h-${suffix}`, parserVersion: 'test' } });

    const facts = buildContentFacts({ projectId: project.id, pageId: page.id, normalizedUrl: page.normalizedUrl, snapshotId: snapshot.id, canonicalUrl: null, title: '', metaDescription: '', h1: '', language: null, wordCount: 100, h1Count: 1, h2Count: 0, h3Count: 0, imagesCount: 0, internalLinksCount: 0, externalLinksCount: 0, schemaTypes: [], contentHash: snapshot.contentHash, capturedAt: snapshot.capturedAt });
    const document = await contentRepository.upsertContentDocument(facts);
    await contentRepository.replaceEvaluation(project.id, document.id, evaluateContentDocument(facts, { entityCount: 0, citabilityStatus: 'FAIL', schemaTypesKnown: true }));
    expect(await prisma.contentOpportunity.count({ where: { projectId: project.id, status: 'OPEN' } })).toBeGreaterThan(0);

    const healthy = { ...facts, title: 'Title', metaDescription: 'Description', h1: 'Title', wordCount: 900, headingCount: 4, internalLinkCount: 5, schemaTypes: ['Article'] };
    await contentRepository.replaceEvaluation(project.id, document.id, evaluateContentDocument(healthy, { entityCount: 2, citabilityStatus: 'PASS', schemaTypesKnown: true }));
    expect(await prisma.contentOpportunity.count({ where: { projectId: project.id, status: 'VERIFIED_FIXED' } })).toBeGreaterThan(0);
  });
});
