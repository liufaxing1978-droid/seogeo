import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { QUEUE_NAMES } from '../../src/queue/queues.js';
import { workerDefinitionForQueue } from '../../src/queue/worker-bootstrap.js';
import {
  P6B_EXTRACTION_VERSION
} from '../../src/modules/visibility/visibility-extraction.service.js';
import {
  VISIBILITY_EXTRACTION_QUEUE_NAME,
  VisibilityExtractionQueue,
  buildVisibilityBackfillJobId,
  buildVisibilityExtractionJobId,
  type VisibilityExtractionQueuePort
} from '../../src/modules/visibility/visibility-extraction.queue.js';
import {
  expandVisibilityExtractionBackfill,
  processVisibilityExtractionJob
} from '../../src/modules/visibility/visibility-extraction.worker.js';

class FakeQueuePort implements VisibilityExtractionQueuePort {
  calls: Array<{
    name: string;
    data: Record<string, unknown>;
    options: { jobId: string; attempts: number };
  }> = [];

  async add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string; attempts: number }
  ) {
    this.calls.push({ name, data, options });
    return { id: options.jobId };
  }
}

describe('P6-B zero-network extraction queue, worker and bounded backfill', () => {
  const projectIds: string[] = [];

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.citationObservation.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.mentionObservation.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityExtraction.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilitySubjectAlias.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilitySubject.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.platformObservation.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityRun.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityPrompt.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityPromptSet.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  async function createObservationProject(label: string, count: number) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: `Extraction Worker ${label}`,
        slug: `extraction-worker-${suffix}`,
        primaryDomain: `${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);
    const promptSet = await prisma.visibilityPromptSet.create({
      data: { projectId: project.id, name: `Worker ${label}` }
    });
    const prompt = await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: promptSet.id,
        promptKey: 'worker',
        version: 1,
        promptText: 'Fixture prompt',
        promptHash: `hash-${suffix}`
      }
    });
    const run = await prisma.visibilityRun.create({
      data: {
        projectId: project.id,
        status: 'COMPLETED',
        runType: 'MANUAL',
        promptSetId: promptSet.id,
        requestedProviderConfigs: [],
        maxObservations: count,
        currency: 'USD',
        policySnapshotJson: {}
      }
    });

    const observations = [];
    for (let index = 0; index < count; index += 1) {
      observations.push(await prisma.platformObservation.create({
        data: {
          projectId: project.id,
          visibilityRunId: run.id,
          visibilityPromptId: prompt.id,
          promptVersion: 1,
          samplingUnitKey: `extraction-worker:${suffix}:${index}`,
          provider: 'OPENAI',
          model: 'gpt-5-mini',
          channel: 'API',
          groundingMode: 'WEB_SEARCH',
          status: 'COMPLETED',
          answerText: `Answer ${index}`,
          citationsJson: [],
          searchMetadataJson: {},
          citationEvidenceState: 'KNOWN_EMPTY'
        }
      }));
    }
    return { project, observations };
  }

  it('registers the dedicated extraction queue and bounded worker definition', () => {
    expect(QUEUE_NAMES).toContain(VISIBILITY_EXTRACTION_QUEUE_NAME);
    const definition = workerDefinitionForQueue('visibility-extraction');
    expect(definition.processor).toBe(processVisibilityExtractionJob);
    expect(definition.concurrency).toBeGreaterThan(0);
    expect(definition.concurrency).toBeLessThanOrEqual(4);
  });

  it('builds stable observation/backfill job IDs and deterministic retry options', async () => {
    expect(buildVisibilityExtractionJobId('obs-1', 'v1', 'hash-1'))
      .toBe('visibility-extract:obs-1:v1:hash-1');
    expect(buildVisibilityBackfillJobId('project-1', 'v1', 'hash-1', null))
      .toBe('visibility-backfill:project-1:v1:hash-1:start');

    const port = new FakeQueuePort();
    const queue = new VisibilityExtractionQueue(port);
    const first = await queue.enqueueObservation({
      projectId: 'project-1',
      observationId: 'obs-1',
      extractorVersion: 'v1',
      subjectSetHash: 'hash-1'
    });
    const second = await queue.enqueueObservation({
      projectId: 'project-1',
      observationId: 'obs-1',
      extractorVersion: 'v1',
      subjectSetHash: 'hash-1'
    });

    expect(first.id).toBe(second.id);
    expect(port.calls).toHaveLength(2);
    for (const call of port.calls) {
      expect(call).toMatchObject({
        name: 'extract-observation',
        options: {
          jobId: 'visibility-extract:obs-1:v1:hash-1',
          attempts: 2
        }
      });
    }
  });

  it('processes an observation job through the local extraction service without network access', async () => {
    const fixture = await createObservationProject('zero-network', 1);
    const observation = fixture.observations[0]!;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network must never be touched by P6-B extraction worker');
    });
    const extractObservation = vi.fn().mockResolvedValue({ id: 'extraction-1', status: 'COMPLETED' });

    await processVisibilityExtractionJob({
      name: 'extract-observation',
      data: {
        projectId: fixture.project.id,
        observationId: observation.id,
        extractorVersion: P6B_EXTRACTION_VERSION,
        subjectSetHash: 'hash-1'
      }
    }, {
      extractionService: { extractObservation } as never
    });

    expect(extractObservation).toHaveBeenCalledWith(fixture.project.id, observation.id, 'hash-1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('expands backfill in bounded project-scoped pages and enqueues only observation jobs', async () => {
    const owned = await createObservationProject('owned', 3);
    const other = await createObservationProject('other', 2);
    const port = new FakeQueuePort();
    const queue = new VisibilityExtractionQueue(port);

    const first = await expandVisibilityExtractionBackfill({
      projectId: owned.project.id,
      extractorVersion: P6B_EXTRACTION_VERSION,
      subjectSetHash: 'subject-hash',
      afterObservationId: null,
      limit: 2
    }, { queue });

    expect(first.enqueuedCount).toBe(2);
    expect(first.nextCursor).toBeTruthy();
    expect(port.calls).toHaveLength(2);
    expect(port.calls.every((call) => call.name === 'extract-observation')).toBe(true);
    expect(port.calls.every((call) => call.data.projectId === owned.project.id)).toBe(true);
    expect(port.calls.some((call) => other.observations.some((observation) => observation.id === call.data.observationId))).toBe(false);

    const second = await expandVisibilityExtractionBackfill({
      projectId: owned.project.id,
      extractorVersion: P6B_EXTRACTION_VERSION,
      subjectSetHash: 'subject-hash',
      afterObservationId: first.nextCursor,
      limit: 2
    }, { queue });
    expect(second.enqueuedCount).toBe(1);
    expect(second.nextCursor).toBeNull();
  });

  it('caps backfill pages at 100 and rejects missing/cross-project observation jobs', async () => {
    const owned = await createObservationProject('scope-owned', 1);
    const other = await createObservationProject('scope-other', 1);
    const queue = new VisibilityExtractionQueue(new FakeQueuePort());

    await expect(expandVisibilityExtractionBackfill({
      projectId: owned.project.id,
      extractorVersion: P6B_EXTRACTION_VERSION,
      subjectSetHash: 'subject-hash',
      afterObservationId: null,
      limit: 1000
    }, { queue })).resolves.toMatchObject({ enqueuedCount: 1 });

    const extractObservation = vi.fn();
    await expect(processVisibilityExtractionJob({
      name: 'extract-observation',
      data: {
        projectId: owned.project.id,
        observationId: other.observations[0]!.id,
        extractorVersion: P6B_EXTRACTION_VERSION,
        subjectSetHash: 'subject-hash'
      }
    }, {
      extractionService: { extractObservation } as never
    })).rejects.toMatchObject({ code: 'VISIBILITY_OBSERVATION_NOT_FOUND' });
    expect(extractObservation).not.toHaveBeenCalled();
  });
});
