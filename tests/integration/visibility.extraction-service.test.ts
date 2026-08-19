import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  VisibilityExtractionService,
  computeSubjectSetHash
} from '../../src/modules/visibility/visibility-extraction.service.js';
import { VisibilitySubjectService } from '../../src/modules/visibility/visibility-subject.service.js';

const subjectService = new VisibilitySubjectService();

describe('P6-B immutable extraction materialization and replay', () => {
  const projectIds: string[] = [];

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

  async function createFixture(label: string) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: `P6-B Extraction ${label}`,
        slug: `p6b-extraction-${suffix}`,
        primaryDomain: 'xingshantang.org',
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const promptSet = await prisma.visibilityPromptSet.create({
      data: { projectId: project.id, name: 'Extraction set' }
    });
    const prompt = await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: promptSet.id,
        promptKey: 'extraction',
        version: 1,
        promptText: 'Which sources explain this topic?',
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
        maxObservations: 2,
        currency: 'USD',
        policySnapshotJson: {}
      }
    });

    await subjectService.bootstrapOwnedDomain(project.id);
    const brand = await subjectService.createSubject(project.id, {
      subjectType: 'OWNED_BRAND',
      canonicalValue: '兴善堂'
    });

    async function createObservation(sequence: number) {
      return prisma.platformObservation.create({
        data: {
          projectId: project.id,
          visibilityRunId: run.id,
          visibilityPromptId: prompt.id,
          promptVersion: 1,
          samplingUnitKey: `p6b-extraction:${suffix}:${sequence}`,
          provider: 'OPENAI',
          model: 'gpt-5-mini',
          channel: 'API',
          groundingMode: 'WEB_SEARCH',
          status: 'COMPLETED',
          answerText: '兴善堂 is one monitored source.',
          citationsJson: [{
            url: 'https://xingshantang.org/article',
            title: 'Owned Article',
            position: 1,
            sourceType: 'url_citation'
          }],
          searchMetadataJson: {},
          citationEvidenceState: 'KNOWN_PRESENT'
        }
      });
    }

    return {
      project,
      brand,
      observation: await createObservation(1),
      createObservation
    };
  }

  it('atomically materializes one completed extraction with immutable subject snapshot and derived rows', async () => {
    const { project, observation } = await createFixture('atomic');
    const service = new VisibilityExtractionService();

    const extraction = await service.extractObservation(project.id, observation.id);
    const snapshot = await subjectService.buildActiveSnapshot(project.id);

    expect(extraction).toMatchObject({
      projectId: project.id,
      platformObservationId: observation.id,
      status: 'COMPLETED',
      subjectSetHash: snapshot.subjectSetHash,
      mentionStatus: 'EXTRACTED',
      citationStatus: 'EXTRACTED',
      mentionCount: 1,
      citationCount: 1,
      errorCode: null
    });
    expect(computeSubjectSetHash(snapshot)).toBe(snapshot.subjectSetHash);
    expect(extraction.subjectSnapshotJson).toEqual(snapshot);

    const mentions = await prisma.mentionObservation.findMany({
      where: { visibilityExtractionId: extraction.id }
    });
    const citations = await prisma.citationObservation.findMany({
      where: { visibilityExtractionId: extraction.id }
    });
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({
      subjectType: 'OWNED_BRAND',
      subjectValue: '兴善堂',
      matchedValue: '兴善堂',
      occurrenceCount: 1
    });
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      normalizedUrl: 'https://xingshantang.org/article',
      domain: 'xingshantang.org',
      isOwnedDomain: true,
      occurrenceCount: 1
    });
  });

  it('returns the existing extraction for the same observation/version/subject hash', async () => {
    const { project, observation } = await createFixture('dedup');
    const service = new VisibilityExtractionService();

    const first = await service.extractObservation(project.id, observation.id);
    const second = await service.extractObservation(project.id, observation.id);

    expect(second.id).toBe(first.id);
    expect(await prisma.visibilityExtraction.count({
      where: { projectId: project.id, platformObservationId: observation.id }
    })).toBe(1);
  });

  it('creates a new extraction after subject/alias change while leaving the old extraction unchanged', async () => {
    const { project, brand, observation } = await createFixture('replay');
    const service = new VisibilityExtractionService();

    const first = await service.extractObservation(project.id, observation.id);
    const firstSnapshot = first.subjectSnapshotJson;
    const firstMentionRows = await prisma.mentionObservation.findMany({
      where: { visibilityExtractionId: first.id }
    });

    await subjectService.addAlias(project.id, brand.id, { alias: 'XST', aliasType: 'NAME' });
    const second = await service.extractObservation(project.id, observation.id);

    expect(second.id).not.toBe(first.id);
    expect(second.subjectSetHash).not.toBe(first.subjectSetHash);
    expect(await prisma.visibilityExtraction.count({
      where: { projectId: project.id, platformObservationId: observation.id }
    })).toBe(2);

    const persistedFirst = await prisma.visibilityExtraction.findUniqueOrThrow({ where: { id: first.id } });
    expect(persistedFirst.subjectSnapshotJson).toEqual(firstSnapshot);
    expect(await prisma.mentionObservation.findMany({
      where: { visibilityExtractionId: first.id }
    })).toEqual(firstMentionRows);
  });

  it('rolls back all derived rows when completion materialization fails and records FAILED lifecycle', async () => {
    const { project, createObservation } = await createFixture('rollback');
    const observation = await createObservation(2);
    const service = new VisibilityExtractionService({
      extractorVersion: 'P6B_EXTRACTION_FAILURE_TEST_V1',
      citationExtractor: () => ({
        status: 'EXTRACTED',
        citations: [{
          citationKey: 'a'.repeat(64),
          url: 'https://example.org/failure',
          normalizedUrl: 'https://example.org/failure',
          domain: 'example.org',
          position: 1,
          title: 'Failure fixture',
          sourceType: 'citation',
          occurrenceCount: 1,
          isOwnedDomain: false,
          ownedSubjectId: null,
          competitorId: 'not-a-uuid',
          competitorSubjectId: null
        }]
      })
    });

    await expect(service.extractObservation(project.id, observation.id)).rejects.toBeTruthy();

    const extraction = await prisma.visibilityExtraction.findFirstOrThrow({
      where: {
        projectId: project.id,
        platformObservationId: observation.id,
        extractorVersion: 'P6B_EXTRACTION_FAILURE_TEST_V1'
      }
    });
    expect(extraction.status).toBe('FAILED');
    expect(extraction.errorCode).toBeTruthy();
    expect(await prisma.mentionObservation.count({
      where: { visibilityExtractionId: extraction.id }
    })).toBe(0);
    expect(await prisma.citationObservation.count({
      where: { visibilityExtractionId: extraction.id }
    })).toBe(0);
  });
});
