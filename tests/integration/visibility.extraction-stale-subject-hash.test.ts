import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { P6B_EXTRACTION_VERSION } from '../../src/modules/visibility/visibility-extraction.service.js';
import { processVisibilityExtractionJob } from '../../src/modules/visibility/visibility-extraction.worker.js';
import { VisibilitySubjectService } from '../../src/modules/visibility/visibility-subject.service.js';

describe('P6-B queued subject snapshot identity', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('fails closed when the active subject set changed after enqueue and writes no derived facts', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Stale Subject Snapshot',
        slug: `stale-subject-snapshot-${suffix}`,
        primaryDomain: `stale-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const subjectService = new VisibilitySubjectService();
    await subjectService.bootstrapOwnedDomain(project.id);
    const queuedSnapshot = await subjectService.buildActiveSnapshot(project.id);

    const promptSet = await prisma.visibilityPromptSet.create({
      data: { projectId: project.id, name: 'Stale snapshot fixture' }
    });
    const prompt = await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: promptSet.id,
        promptKey: 'stale-subject-snapshot',
        version: 1,
        promptText: 'Which sources explain the topic?',
        promptHash: `prompt-${suffix}`
      }
    });
    const run = await prisma.visibilityRun.create({
      data: {
        projectId: project.id,
        status: 'COMPLETED',
        runType: 'MANUAL',
        promptSetId: promptSet.id,
        requestedProviderConfigs: [],
        maxObservations: 1,
        currency: 'USD',
        policySnapshotJson: {}
      }
    });
    const observation = await prisma.platformObservation.create({
      data: {
        projectId: project.id,
        visibilityRunId: run.id,
        visibilityPromptId: prompt.id,
        promptVersion: 1,
        samplingUnitKey: `stale-subject-snapshot:${suffix}`,
        provider: 'OPENAI',
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        status: 'COMPLETED',
        answerText: 'The owned brand is mentioned in this fixture.',
        citationsJson: [],
        searchMetadataJson: {},
        citationEvidenceState: 'KNOWN_EMPTY'
      }
    });

    await subjectService.createSubject(project.id, {
      subjectType: 'OWNED_BRAND',
      canonicalValue: 'Stale Snapshot Brand'
    });
    const currentSnapshot = await subjectService.buildActiveSnapshot(project.id);
    expect(currentSnapshot.subjectSetHash).not.toBe(queuedSnapshot.subjectSetHash);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('P6-B extraction must never call the network');
    });

    await expect(processVisibilityExtractionJob({
      name: 'extract-observation',
      data: {
        projectId: project.id,
        observationId: observation.id,
        extractorVersion: P6B_EXTRACTION_VERSION,
        subjectSetHash: queuedSnapshot.subjectSetHash
      }
    })).rejects.toMatchObject({ code: 'VISIBILITY_SUBJECT_SNAPSHOT_STALE' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.visibilityExtraction.count({
      where: { projectId: project.id, platformObservationId: observation.id }
    })).toBe(0);
    expect(await prisma.mentionObservation.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.citationObservation.count({ where: { projectId: project.id } })).toBe(0);

    fetchSpy.mockRestore();
  });
});
