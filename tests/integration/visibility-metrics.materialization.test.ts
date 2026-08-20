import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { VisibilityMetricsService } from '../../src/modules/visibility/visibility-metrics.service.js';
import { VisibilitySubjectService } from '../../src/modules/visibility/visibility-subject.service.js';

const NOW = new Date('2026-08-10T00:00:00.000Z');
const WINDOW_START = new Date('2026-08-01T00:00:00.000Z');
const WINDOW_END = new Date('2026-08-08T00:00:00.000Z');
const CUTOFF = new Date('2026-08-08T12:00:00.000Z');
const EXTRACTOR = 'VISIBILITY_EXTRACTION_V1';

async function createFixture(name: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name,
      slug: `p6c-materialize-${suffix}`,
      primaryDomain: `owned-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  const promptSet = await prisma.visibilityPromptSet.create({
    data: { projectId: project.id, name: 'Discovery Set' }
  });
  const prompt = await prisma.visibilityPrompt.create({
    data: {
      projectId: project.id,
      promptSetId: promptSet.id,
      promptKey: 'discovery',
      version: 1,
      promptText: 'fixture prompt',
      promptHash: `prompt-${suffix}`
    }
  });
  const run = await prisma.visibilityRun.create({
    data: {
      projectId: project.id,
      promptSetId: promptSet.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      requestedProviderConfigs: [],
      maxObservations: 10,
      currency: 'USD',
      policySnapshotJson: {}
    }
  });
  await prisma.visibilitySubject.create({
    data: {
      projectId: project.id,
      subjectType: 'OWNED_DOMAIN',
      canonicalValue: project.primaryDomain,
      normalizedValue: project.primaryDomain,
      sourceType: 'PRIMARY_DOMAIN'
    }
  });
  const subjectSnapshot = await new VisibilitySubjectService().buildActiveSnapshot(project.id);
  return { project, promptSet, prompt, run, subjectSnapshot, suffix };
}

async function createObservation(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  idSuffix: string,
  overrides: { provider?: 'OPENAI' | 'GEMINI'; observedAt?: Date } = {}
) {
  return prisma.platformObservation.create({
    data: {
      projectId: fixture.project.id,
      visibilityRunId: fixture.run.id,
      visibilityPromptId: fixture.prompt.id,
      promptVersion: 1,
      samplingUnitKey: `metrics:${fixture.suffix}:${idSuffix}`,
      provider: overrides.provider ?? 'OPENAI',
      model: 'fixture-model',
      channel: 'API',
      groundingMode: 'WEB_SEARCH',
      status: 'COMPLETED',
      answerText: 'fixture answer',
      answerHash: `answer-${fixture.suffix}-${idSuffix}`,
      citationsJson: [],
      searchMetadataJson: {},
      citationEvidenceState: 'KNOWN_EMPTY',
      observedAt: overrides.observedAt ?? new Date('2026-08-05T00:00:00.000Z'),
      createdAt: new Date('2026-08-05T00:00:00.000Z')
    }
  });
}

describe('P6-C visibility metric materialization', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('keeps P6-A candidates with missing requested P6-B extraction as UNKNOWN instead of zero', async () => {
    const fixture = await createFixture('P6-C Missing Extraction');
    projectIds.push(fixture.project.id);
    await createObservation(fixture, 'missing');

    const service = new VisibilityMetricsService({ now: () => NOW });
    const shell = await service.prepareSnapshot({
      projectId: fixture.project.id,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      inputCutoffAt: CUTOFF,
      extractorVersion: EXTRACTOR,
      subjectSetHash: fixture.subjectSnapshot.subjectSetHash,
      scope: { providers: [], promptSetIds: [] }
    });
    const completed = await service.materializeSnapshot(fixture.project.id, shell.id);

    expect(completed.status).toBe('COMPLETED');
    expect(completed.candidateObservationCount).toBe(1);
    expect(completed.completedExtractionCount).toBe(0);
    expect(completed.missingExtractionCount).toBe(1);

    const rows = await prisma.visibilityMetricRow.findMany({
      where: { visibilityMetricSnapshotId: completed.id, dimensionType: 'OVERALL' }
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.metricStatus === 'UNKNOWN')).toBe(true);
    expect(rows.every((row) => row.denominator === 0)).toBe(true);
    expect(rows.every((row) => row.unknownObservationCount === 1)).toBe(true);
  });

  it('uses only a completed matching extraction as-of cutoff and preserves legitimate calculated zero', async () => {
    const fixture = await createFixture('P6-C Completed Extraction');
    projectIds.push(fixture.project.id);
    const observation = await createObservation(fixture, 'complete');

    await prisma.visibilityExtraction.create({
      data: {
        projectId: fixture.project.id,
        platformObservationId: observation.id,
        status: 'COMPLETED',
        extractorVersion: EXTRACTOR,
        subjectSetHash: fixture.subjectSnapshot.subjectSetHash,
        subjectSnapshotJson: JSON.parse(JSON.stringify({
          subjects: fixture.subjectSnapshot.subjects,
          ambiguousAliases: fixture.subjectSnapshot.ambiguousAliases
        })),
        answerHash: observation.answerHash,
        mentionStatus: 'KNOWN_EMPTY',
        citationStatus: 'KNOWN_EMPTY',
        mentionCount: 0,
        citationCount: 0,
        createdAt: new Date('2026-08-06T00:00:00.000Z'),
        completedAt: new Date('2026-08-06T00:00:00.000Z')
      }
    });

    const service = new VisibilityMetricsService({ now: () => NOW });
    const shell = await service.prepareSnapshot({
      projectId: fixture.project.id,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      inputCutoffAt: CUTOFF,
      extractorVersion: EXTRACTOR,
      subjectSetHash: fixture.subjectSnapshot.subjectSetHash,
      scope: { providers: [], promptSetIds: [] }
    });
    const completed = await service.materializeSnapshot(fixture.project.id, shell.id);

    expect(completed.completedExtractionCount).toBe(1);
    expect(completed.missingExtractionCount).toBe(0);

    const ownedMention = await prisma.visibilityMetricRow.findFirstOrThrow({
      where: {
        visibilityMetricSnapshotId: completed.id,
        metricType: 'MENTION_RATE',
        dimensionType: 'OVERALL',
        actorKey: 'OWNED_ROLLUP'
      }
    });
    expect(ownedMention).toMatchObject({
      metricStatus: 'CALCULATED',
      numerator: 0,
      denominator: 1,
      eligibleObservationCount: 1,
      unknownObservationCount: 0
    });
  });

  it('rejects oversized windows and future cutoffs before creating a snapshot shell', async () => {
    const fixture = await createFixture('P6-C Bounds');
    projectIds.push(fixture.project.id);
    const service = new VisibilityMetricsService({ now: () => NOW });

    await expect(service.prepareSnapshot({
      projectId: fixture.project.id,
      windowStart: new Date('2026-06-01T00:00:00.000Z'),
      windowEnd: new Date('2026-08-01T00:00:00.000Z'),
      inputCutoffAt: CUTOFF,
      extractorVersion: EXTRACTOR,
      subjectSetHash: fixture.subjectSnapshot.subjectSetHash,
      scope: { providers: [], promptSetIds: [] }
    })).rejects.toMatchObject({ code: 'VISIBILITY_METRICS_WINDOW_TOO_LARGE' });

    await expect(service.prepareSnapshot({
      projectId: fixture.project.id,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      inputCutoffAt: new Date('2026-08-11T00:00:00.000Z'),
      extractorVersion: EXTRACTOR,
      subjectSetHash: fixture.subjectSnapshot.subjectSetHash,
      scope: { providers: [], promptSetIds: [] }
    })).rejects.toMatchObject({ code: 'VISIBILITY_METRICS_CUTOFF_IN_FUTURE' });

    expect(await prisma.visibilityMetricSnapshot.count({ where: { projectId: fixture.project.id } })).toBe(0);
  });
});
