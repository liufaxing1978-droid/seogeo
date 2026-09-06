import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { ContentQualityRepository } from '../../src/modules/content/content-quality.repository.js';
import {
  processContentQualityJob,
  type ContentQualityJobData
} from '../../src/modules/content/content-quality.worker.js';

describe('P13-A persisted-facts content-quality worker', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let projectId: string;
  let documentId: string;
  let currentSnapshotId: string;
  let previousSnapshotId: string;

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `P13A worker ${suffix}`,
        slug: `p13a-worker-${suffix}`,
        primaryDomain: `p13a-worker-${suffix}.example.com`
      }
    });
    projectId = project.id;
    const crawl = await prisma.crawlRun.create({
      data: {
        projectId,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: `https://${project.primaryDomain}`,
        crawlerVersion: 'test'
      }
    });
    const page = await prisma.page.create({
      data: {
        projectId,
        url: `https://${project.primaryDomain}/guide`,
        normalizedUrl: `https://${project.primaryDomain}/guide`,
        host: project.primaryDomain,
        path: '/guide'
      }
    });
    const previous = await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawl.id,
        finalUrl: page.url,
        statusCode: 200,
        contentType: 'text/html',
        indexable: true,
        wordCount: 1000,
        title: 'Guide',
        h1: 'Guide',
        capturedAt: new Date('2026-09-01T00:00:00.000Z'),
        parserVersion: 'test'
      }
    });
    const current = await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawl.id,
        finalUrl: page.url,
        statusCode: 200,
        contentType: 'text/html',
        indexable: true,
        wordCount: 400,
        title: 'Guide',
        h1: 'Guide',
        capturedAt: new Date('2026-09-02T00:00:00.000Z'),
        parserVersion: 'test'
      }
    });
    previousSnapshotId = previous.id;
    currentSnapshotId = current.id;
    const document = await prisma.contentDocument.create({
      data: {
        projectId,
        pageId: page.id,
        latestPageSnapshotId: current.id,
        canonicalUrl: page.normalizedUrl,
        internalLinkCount: 1,
        schemaTypes: [],
        contentHash: `content-${suffix}`,
        extractedAt: current.capturedAt
      }
    });
    documentId = document.id;
    const signal = await prisma.contentSignal.create({
      data: {
        projectId,
        contentDocumentId: documentId,
        ruleKey: 'CONTENT_BODY_SUBSTANTIVE',
        ruleVersion: 1,
        status: 'FAIL',
        priority: 'HIGH',
        sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: current.id }]
      }
    });
    await prisma.contentOpportunity.create({
      data: {
        projectId,
        contentDocumentId: documentId,
        opportunityKey: 'CONTENT_BODY_SUBSTANTIVE:v1',
        opportunityVersion: 1,
        category: 'CONTENT_QUALITY',
        priority: 'HIGH',
        status: 'OPEN',
        summary: 'Persisted P5-A failure',
        sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: current.id }],
        firstDetectedAt: new Date('2026-09-02T00:00:00.000Z'),
        lastDetectedAt: new Date('2026-09-02T00:00:00.000Z')
      }
    });
    expect(signal.id).toBeTruthy();
  });

  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  });

  it('materializes deterministic failures without fetch, AI, draft, or mutation-adapter calls', async () => {
    const run = await prisma.contentQualityRun.create({
      data: { projectId, rulesetVersion: 1, requestedByActorId: 'user-1' }
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('P13-A must never fetch');
    });

    await processContentQualityJob({
      name: 'content-quality-run',
      data: { projectId, runId: run.id }
    } as Job<ContentQualityJobData>);

    const completed = await prisma.contentQualityRun.findUniqueOrThrow({ where: { id: run.id } });
    const findings = await prisma.contentQualityFinding.findMany({
      where: { projectId },
      orderBy: { findingKey: 'asc' }
    });
    expect(completed).toMatchObject({ status: 'COMPLETED', inputDocumentCount: 1, findingCount: 3 });
    expect(findings.map((finding) => finding.findingKey)).toEqual([
      'CONTENT_DECAY_WORD_COUNT_DROP',
      'CONTENT_INTERNAL_LINK_SUPPORT',
      'CONTENT_QA_P5A_FAILED_OPPORTUNITY'
    ]);
    expect(findings.find((finding) => finding.findingKey === 'CONTENT_DECAY_WORD_COUNT_DROP')?.evidence).toMatchObject({
      previousSnapshotId,
      currentSnapshotId
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.contentDraft.count({ where: { projectId } })).toBe(0);
    expect(await prisma.publicationPlan.count({ where: { projectId } })).toBe(0);
    expect(await prisma.publicationExecution.count({ where: { projectId } })).toBe(0);
    fetchSpy.mockRestore();
  });

  it('accepts a finding into exactly one proposal without drafting or publication', async () => {
    const finding = await prisma.contentQualityFinding.findFirstOrThrow({
      where: { projectId, contentDocumentId: documentId, findingKey: 'CONTENT_DECAY_WORD_COUNT_DROP' }
    });
    const repository = new ContentQualityRepository();

    const first = await repository.acceptFinding(projectId, finding.id, 'reviewer-1');
    const second = await repository.acceptFinding(projectId, finding.id, 'reviewer-1');

    expect(second.id).toBe(first.id);
    expect(await prisma.publicationProposal.count({ where: { projectId, sourceReferenceId: finding.id } })).toBe(1);
    expect(first).toMatchObject({
      sourceType: 'CONTENT_REFRESH',
      sourceReferenceId: finding.id,
      sourceMetadata: expect.objectContaining({
        program: 'P13-A',
        findingId: finding.id,
        ruleVersion: 1,
        snapshotIds: expect.arrayContaining([previousSnapshotId, currentSnapshotId])
      })
    });
    expect(await prisma.contentQualityFindingHistory.count({ where: { findingId: finding.id } })).toBe(1);
    expect(await prisma.contentDraft.count({ where: { projectId } })).toBe(0);
    expect(await prisma.publicationPlan.count({ where: { projectId } })).toBe(0);
    expect(await prisma.publicationExecution.count({ where: { projectId } })).toBe(0);
  });

  it('writes exactly one append-only history row for a manual finding transition', async () => {
    const finding = await prisma.contentQualityFinding.findFirstOrThrow({
      where: { projectId, contentDocumentId: documentId, findingKey: 'CONTENT_INTERNAL_LINK_SUPPORT' }
    });
    const repository = new ContentQualityRepository();

    await repository.transitionFinding(projectId, finding.id, 'IN_REVIEW', 'reviewer-1', 'Review requested.');

    const history = await prisma.contentQualityFindingHistory.findMany({ where: { findingId: finding.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: 'OPEN',
      toStatus: 'IN_REVIEW',
      actorId: 'reviewer-1',
      reason: 'Review requested.'
    });
  });

  it('records a bounded failure code when persisted-facts analysis fails', async () => {
    const run = await prisma.contentQualityRun.create({
      data: { projectId, rulesetVersion: 1, requestedByActorId: 'user-1' }
    });
    const failure = Object.assign(new Error('fixture input failure'), { code: 'P13A_INPUT_FAILURE' });
    const loadInput = vi.spyOn(ContentQualityRepository.prototype, 'loadInput').mockRejectedValueOnce(failure);

    await expect(processContentQualityJob({
      name: 'content-quality-run',
      data: { projectId, runId: run.id }
    } as Job<ContentQualityJobData>)).rejects.toBe(failure);

    const failed = await prisma.contentQualityRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'P13A_INPUT_FAILURE' });
    loadInput.mockRestore();
  });
});
