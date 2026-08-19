import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

describe('P6-B Citation Monitor and subject web UI', () => {
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

  async function createProject(planLevel: 'STANDARD' | 'ADVANCED', label: string) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: `Citation Monitor ${label}`,
        slug: `citation-monitor-${suffix}`,
        primaryDomain: `citation-${suffix}.example.com`,
        planLevel
      }
    });
    projectIds.push(project.id);
    return project;
  }

  async function seedFacts(projectId: string) {
    const promptSet = await prisma.visibilityPromptSet.create({
      data: { projectId, name: 'Citation Monitor fixture' }
    });
    const prompt = await prisma.visibilityPrompt.create({
      data: {
        projectId,
        promptSetId: promptSet.id,
        promptKey: 'citation-monitor',
        version: 1,
        promptText: 'PRIVATE PROMPT MUST NOT APPEAR ON CITATION MONITOR',
        promptHash: `hash-${Date.now()}-${Math.random()}`
      }
    });
    const run = await prisma.visibilityRun.create({
      data: {
        projectId,
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
        projectId,
        visibilityRunId: run.id,
        visibilityPromptId: prompt.id,
        promptVersion: 1,
        samplingUnitKey: `citation-monitor:${Date.now()}:${Math.random()}`,
        provider: 'OPENAI',
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        status: 'COMPLETED',
        answerText: 'PRIVATE ANSWER MUST NOT APPEAR ON CITATION MONITOR',
        citationsJson: [],
        searchMetadataJson: {},
        citationEvidenceState: 'KNOWN_EMPTY'
      }
    });
    const subject = await prisma.visibilitySubject.create({
      data: {
        projectId,
        subjectType: 'OWNED_BRAND',
        canonicalValue: '兴善堂',
        normalizedValue: '兴善堂',
        sourceType: 'PROJECT_CONFIG'
      }
    });
    await prisma.visibilitySubjectAlias.create({
      data: {
        projectId,
        subjectId: subject.id,
        alias: 'Xingshantang',
        normalizedAlias: 'xingshantang',
        aliasType: 'NAME',
        sourceType: 'PROJECT_CONFIG'
      }
    });
    const extraction = await prisma.visibilityExtraction.create({
      data: {
        projectId,
        platformObservationId: observation.id,
        status: 'COMPLETED',
        extractorVersion: 'P6B_EXTRACTION_V1',
        subjectSetHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        subjectSnapshotJson: { private: 'SNAPSHOT MUST NOT APPEAR' },
        mentionStatus: 'EXTRACTED',
        citationStatus: 'KNOWN_EMPTY',
        mentionCount: 1,
        citationCount: 0,
        completedAt: new Date()
      }
    });
    await prisma.mentionObservation.create({
      data: {
        projectId,
        visibilityExtractionId: extraction.id,
        platformObservationId: observation.id,
        subjectId: subject.id,
        subjectType: 'OWNED_BRAND',
        subjectValue: '兴善堂',
        matchedValue: '兴善堂',
        mentionType: 'EXACT',
        occurrenceCount: 1,
        firstPosition: 3,
        extractorVersion: 'P6B_EXTRACTION_V1'
      }
    });
    return { subject, extraction };
  }

  it('renders facts, evidence states and provenance without P6-C metrics or private bodies', async () => {
    const project = await createProject('ADVANCED', 'facts');
    const { extraction } = await seedFacts(project.id);
    const app = createApp();

    const monitor = await request(app)
      .get(`/projects/${project.id}/visibility/citations`)
      .expect(200);
    expect(monitor.text).toContain('Citation 监控');
    expect(monitor.text).toContain('KNOWN_EMPTY');
    expect(monitor.text).toContain('P6B_EXTRACTION_V1');
    expect(monitor.text).toContain('0123456789ab');
    expect(monitor.text).toContain('兴善堂');
    expect(monitor.text).not.toContain('PRIVATE PROMPT MUST NOT APPEAR');
    expect(monitor.text).not.toContain('PRIVATE ANSWER MUST NOT APPEAR');
    expect(monitor.text).not.toContain('SNAPSHOT MUST NOT APPEAR');
    expect(monitor.text).not.toContain('Mention Rate');
    expect(monitor.text).not.toContain('Citation Rate');
    expect(monitor.text).not.toContain('Share of Voice');

    const detail = await request(app)
      .get(`/projects/${project.id}/visibility/extractions/${extraction.id}`)
      .expect(200);
    expect(detail.text).toContain(extraction.subjectSetHash);
    expect(detail.text).toContain('P6B_EXTRACTION_V1');
    expect(detail.text).toContain('KNOWN_EMPTY');
    expect(detail.text).not.toContain('PRIVATE PROMPT MUST NOT APPEAR');
    expect(detail.text).not.toContain('PRIVATE ANSWER MUST NOT APPEAR');
  });

  it('bootstraps owned domain only after Advanced gating and supports safe alias configuration', async () => {
    const project = await createProject('ADVANCED', 'subjects');
    const app = createApp();

    const subjectsPage = await request(app)
      .get(`/projects/${project.id}/visibility/subjects`)
      .expect(200);
    expect(subjectsPage.text).toContain('监控主体');
    const ownedDomain = await prisma.visibilitySubject.findFirst({
      where: { projectId: project.id, subjectType: 'OWNED_DOMAIN' }
    });
    expect(ownedDomain).not.toBeNull();

    const brandResponse = await request(app)
      .post(`/projects/${project.id}/visibility/subjects`)
      .type('form')
      .send({ subjectType: 'OWNED_BRAND', canonicalValue: '兴善堂' })
      .expect(303);
    expect(brandResponse.headers.location).toBe(`/projects/${project.id}/visibility/subjects`);
    const brand = await prisma.visibilitySubject.findFirstOrThrow({
      where: { projectId: project.id, subjectType: 'OWNED_BRAND' }
    });

    await request(app)
      .post(`/projects/${project.id}/visibility/subjects/${brand.id}/aliases`)
      .type('form')
      .send({ alias: 'Xingshantang', aliasType: 'NAME' })
      .expect(303);
    expect(await prisma.visibilitySubjectAlias.count({
      where: { projectId: project.id, subjectId: brand.id, normalizedAlias: 'xingshantang' }
    })).toBe(1);
  });

  it('blocks Standard before subject bootstrap and hides cross-project extraction IDs', async () => {
    const standard = await createProject('STANDARD', 'standard');
    const owner = await createProject('ADVANCED', 'owner');
    const stranger = await createProject('ADVANCED', 'stranger');
    const { extraction } = await seedFacts(owner.id);
    const app = createApp();

    await request(app).get(`/projects/${standard.id}/visibility/citations`).expect(403);
    await request(app).get(`/projects/${standard.id}/visibility/subjects`).expect(403);
    expect(await prisma.visibilitySubject.count({ where: { projectId: standard.id } })).toBe(0);

    await request(app)
      .get(`/projects/${stranger.id}/visibility/extractions/${extraction.id}`)
      .expect(404);
  });
});
