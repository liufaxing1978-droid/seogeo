import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import {
  VisibilityExtractionQueue,
  type VisibilityExtractionQueuePort
} from '../../src/modules/visibility/visibility-extraction.queue.js';

class FakeExtractionQueuePort implements VisibilityExtractionQueuePort {
  readonly calls: Array<{
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

describe('P6-B visibility intelligence REST API', () => {
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
        name: `Visibility Intelligence ${label}`,
        slug: `visibility-intelligence-${suffix}`,
        primaryDomain: `visibility-intelligence-${suffix}.example.com`,
        planLevel
      }
    });
    projectIds.push(project.id);
    return project;
  }

  async function createObservation(projectId: string, label: string) {
    const promptSet = await prisma.visibilityPromptSet.create({
      data: { projectId, name: `Intelligence ${label}` }
    });
    const prompt = await prisma.visibilityPrompt.create({
      data: {
        projectId,
        promptSetId: promptSet.id,
        promptKey: `intelligence-${label}`,
        version: 1,
        promptText: 'PRIVATE PROMPT BODY MUST NOT BE LISTED',
        promptHash: `prompt-hash-${label}-${Date.now()}`
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
    return prisma.platformObservation.create({
      data: {
        projectId,
        visibilityRunId: run.id,
        visibilityPromptId: prompt.id,
        promptVersion: 1,
        samplingUnitKey: `visibility-intelligence:${label}:${Date.now()}:${Math.random()}`,
        provider: 'OPENAI',
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        status: 'COMPLETED',
        answerText: 'PRIVATE ANSWER BODY MUST NOT BE LISTED',
        citationsJson: [{
          url: 'https://xingshantang.org/source',
          title: 'Owned source',
          position: 1,
          sourceType: 'url_citation'
        }],
        searchMetadataJson: {},
        citationEvidenceState: 'KNOWN_PRESENT'
      }
    });
  }

  it('manages project-scoped subjects/aliases and queues refresh/backfill without provider calls', async () => {
    const project = await createProject('ADVANCED', 'advanced');
    const observation = await createObservation(project.id, 'advanced');
    const port = new FakeExtractionQueuePort();
    const queue = new VisibilityExtractionQueue(port);
    const app = createApp({ visibilityExtractionQueue: queue });

    const createdSubject = await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/subjects`)
      .send({ subjectType: 'OWNED_BRAND', canonicalValue: '兴善堂' })
      .expect(201);
    expect(createdSubject.body.data).toMatchObject({
      projectId: project.id,
      subjectType: 'OWNED_BRAND',
      canonicalValue: '兴善堂',
      status: 'ACTIVE'
    });
    const subjectId = createdSubject.body.data.id as string;

    await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/subjects/${subjectId}/aliases`)
      .send({ alias: 'Xingshantang', aliasType: 'NAME' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({ subjectId, alias: 'Xingshantang', status: 'ACTIVE' });
      });

    const subjects = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/subjects`)
      .expect(200);
    expect(subjects.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: subjectId, subjectType: 'OWNED_BRAND' }),
        expect.objectContaining({ subjectType: 'OWNED_DOMAIN' })
      ])
    );

    await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/extractions/refresh`)
      .send({ observationId: observation.id })
      .expect(202);
    expect(port.calls.at(-1)).toMatchObject({
      name: 'extract-observation',
      data: { projectId: project.id, observationId: observation.id },
      options: { attempts: 2 }
    });

    await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/extractions/backfill`)
      .send({ limit: 1000 })
      .expect(202);
    expect(port.calls.at(-1)).toMatchObject({
      name: 'backfill-project',
      data: { projectId: project.id, afterObservationId: null, limit: 100 },
      options: { attempts: 2 }
    });
  });

  it('lists mention/citation/extraction facts with bounded pagination and no prompt/answer bodies', async () => {
    const project = await createProject('ADVANCED', 'facts');
    const observation = await createObservation(project.id, 'facts');
    const subject = await prisma.visibilitySubject.create({
      data: {
        projectId: project.id,
        subjectType: 'OWNED_BRAND',
        canonicalValue: '兴善堂',
        normalizedValue: '兴善堂',
        sourceType: 'PROJECT_CONFIG'
      }
    });
    const extraction = await prisma.visibilityExtraction.create({
      data: {
        projectId: project.id,
        platformObservationId: observation.id,
        status: 'COMPLETED',
        extractorVersion: 'P6B_EXTRACTION_V1',
        subjectSetHash: `subject-hash-${Date.now()}`,
        subjectSnapshotJson: { subjects: [], ambiguousAliases: [] },
        mentionStatus: 'EXTRACTED',
        citationStatus: 'EXTRACTED',
        mentionCount: 1,
        citationCount: 1,
        completedAt: new Date()
      }
    });
    await prisma.mentionObservation.create({
      data: {
        projectId: project.id,
        visibilityExtractionId: extraction.id,
        platformObservationId: observation.id,
        subjectId: subject.id,
        subjectType: 'OWNED_BRAND',
        subjectValue: '兴善堂',
        matchedValue: '兴善堂',
        mentionType: 'EXACT',
        occurrenceCount: 1,
        firstPosition: 0,
        extractorVersion: 'P6B_EXTRACTION_V1'
      }
    });
    await prisma.citationObservation.create({
      data: {
        projectId: project.id,
        visibilityExtractionId: extraction.id,
        platformObservationId: observation.id,
        citationKey: 'https://xingshantang.org/source',
        url: 'https://xingshantang.org/source',
        normalizedUrl: 'https://xingshantang.org/source',
        domain: 'xingshantang.org',
        position: 1,
        title: 'Owned source',
        sourceType: 'url_citation',
        occurrenceCount: 1,
        isOwnedDomain: true,
        extractorVersion: 'P6B_EXTRACTION_V1'
      }
    });

    const app = createApp({ visibilityExtractionQueue: new VisibilityExtractionQueue(new FakeExtractionQueuePort()) });
    for (const resource of ['mentions', 'citations', 'extractions'] as const) {
      const response = await request(app)
        .get(`/api/v1/projects/${project.id}/visibility/${resource}?limit=1000`)
        .expect(200);
      expect(response.body.meta.limit).toBe(100);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('PRIVATE PROMPT BODY MUST NOT BE LISTED');
      expect(serialized).not.toContain('PRIVATE ANSWER BODY MUST NOT BE LISTED');
      expect(serialized).not.toMatch(/reasoning|thought|search planning/i);
    }
  });

  it('blocks Standard projects before writes/queueing and does not expose cross-project subject IDs', async () => {
    const standard = await createProject('STANDARD', 'standard');
    const owner = await createProject('ADVANCED', 'owner');
    const stranger = await createProject('ADVANCED', 'stranger');
    const ownerSubject = await prisma.visibilitySubject.create({
      data: {
        projectId: owner.id,
        subjectType: 'OWNED_BRAND',
        canonicalValue: 'Owner Brand',
        normalizedValue: 'owner brand',
        sourceType: 'PROJECT_CONFIG'
      }
    });
    const port = new FakeExtractionQueuePort();
    const app = createApp({ visibilityExtractionQueue: new VisibilityExtractionQueue(port) });

    await request(app)
      .post(`/api/v1/projects/${standard.id}/visibility/subjects`)
      .send({ subjectType: 'OWNED_BRAND', canonicalValue: 'Blocked Brand' })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));

    await request(app)
      .post(`/api/v1/projects/${standard.id}/visibility/extractions/backfill`)
      .send({ limit: 10 })
      .expect(403);
    await request(app)
      .get(`/api/v1/projects/${standard.id}/visibility/citations`)
      .expect(403);

    await request(app)
      .post(`/api/v1/projects/${stranger.id}/visibility/subjects/${ownerSubject.id}/aliases`)
      .send({ alias: 'Must not leak', aliasType: 'NAME' })
      .expect(404);

    expect(port.calls).toHaveLength(0);
    expect(await prisma.visibilitySubject.count({ where: { projectId: standard.id } })).toBe(0);
  });
});
