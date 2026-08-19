import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

describe('P6-B visibility intelligence persistence', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const id of projectIds) {
      await prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it('persists subjects, aliases, immutable extraction snapshots, mentions and citations', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'P6-B Persistence',
        slug: `p6b-${suffix}`,
        primaryDomain: `p6b-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const promptSet = await prisma.visibilityPromptSet.create({
      data: { projectId: project.id, name: 'P6-B fixture set' }
    });
    const prompt = await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: promptSet.id,
        promptKey: 'fixture',
        version: 1,
        promptText: 'Which sources explain Chinese folk religion?',
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
        samplingUnitKey: `p6b:${suffix}`,
        provider: 'OPENAI',
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        status: 'COMPLETED',
        answerText: '兴善堂 is a cited source.',
        answerHash: `answer-${suffix}`,
        citationsJson: [{ url: 'https://xingshantang.org/article', title: 'Article', position: 1, sourceType: 'web' }],
        searchMetadataJson: {},
        citationEvidenceState: 'KNOWN_PRESENT'
      }
    });

    const subject = await prisma.visibilitySubject.create({
      data: {
        projectId: project.id,
        subjectType: 'OWNED_DOMAIN',
        canonicalValue: 'xingshantang.org',
        normalizedValue: 'xingshantang.org',
        sourceType: 'PRIMARY_DOMAIN'
      }
    });

    await prisma.visibilitySubjectAlias.create({
      data: {
        projectId: project.id,
        subjectId: subject.id,
        alias: 'www.xingshantang.org',
        normalizedAlias: 'xingshantang.org',
        aliasType: 'DOMAIN',
        sourceType: 'PRIMARY_DOMAIN'
      }
    });

    const extraction = await prisma.visibilityExtraction.create({
      data: {
        projectId: project.id,
        platformObservationId: observation.id,
        status: 'COMPLETED',
        extractorVersion: 'VISIBILITY_EXTRACTION_V1',
        subjectSetHash: `subject-set-${suffix}`,
        subjectSnapshotJson: [{ id: subject.id, subjectType: 'OWNED_DOMAIN', normalizedValue: 'xingshantang.org', aliases: ['xingshantang.org'] }],
        answerHash: observation.answerHash,
        mentionStatus: 'EXTRACTED',
        citationStatus: 'EXTRACTED',
        mentionCount: 1,
        citationCount: 1,
        completedAt: new Date()
      }
    });

    const mention = await prisma.mentionObservation.create({
      data: {
        projectId: project.id,
        visibilityExtractionId: extraction.id,
        platformObservationId: observation.id,
        subjectId: subject.id,
        subjectType: 'OWNED_DOMAIN',
        subjectValue: 'xingshantang.org',
        matchedValue: 'xingshantang.org',
        mentionType: 'DOMAIN',
        occurrenceCount: 1,
        firstPosition: 0,
        extractorVersion: 'VISIBILITY_MENTION_V1'
      }
    });

    const citation = await prisma.citationObservation.create({
      data: {
        projectId: project.id,
        visibilityExtractionId: extraction.id,
        platformObservationId: observation.id,
        citationKey: `citation-${suffix}`,
        url: 'https://xingshantang.org/article',
        normalizedUrl: 'https://xingshantang.org/article',
        domain: 'xingshantang.org',
        position: 1,
        title: 'Article',
        sourceType: 'web',
        occurrenceCount: 1,
        isOwnedDomain: true,
        ownedSubjectId: subject.id,
        extractorVersion: 'VISIBILITY_CITATION_V1'
      }
    });

    expect(observation.citationEvidenceState).toBe('KNOWN_PRESENT');
    expect(extraction.status).toBe('COMPLETED');
    expect(mention.subjectId).toBe(subject.id);
    expect(citation.ownedSubjectId).toBe(subject.id);
  });

  it('enforces uniqueness and defaults historical citation evidence to UNKNOWN', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'P6-B Uniqueness',
        slug: `p6b-unique-${suffix}`,
        primaryDomain: `p6b-unique-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const subject = await prisma.visibilitySubject.create({
      data: {
        projectId: project.id,
        subjectType: 'OWNED_BRAND',
        canonicalValue: '兴善堂',
        normalizedValue: '兴善堂',
        sourceType: 'PROJECT_CONFIG'
      }
    });

    await expect(prisma.visibilitySubject.create({
      data: {
        projectId: project.id,
        subjectType: 'OWNED_BRAND',
        canonicalValue: '兴善堂 duplicate',
        normalizedValue: '兴善堂',
        sourceType: 'PROJECT_CONFIG'
      }
    })).rejects.toBeTruthy();

    await prisma.visibilitySubjectAlias.create({
      data: {
        projectId: project.id,
        subjectId: subject.id,
        alias: 'XST',
        normalizedAlias: 'xst',
        aliasType: 'NAME',
        sourceType: 'PROJECT_CONFIG'
      }
    });
    await expect(prisma.visibilitySubjectAlias.create({
      data: {
        projectId: project.id,
        subjectId: subject.id,
        alias: 'xst duplicate',
        normalizedAlias: 'xst',
        aliasType: 'NAME',
        sourceType: 'PROJECT_CONFIG'
      }
    })).rejects.toBeTruthy();

    const promptSet = await prisma.visibilityPromptSet.create({ data: { projectId: project.id, name: 'set' } });
    const prompt = await prisma.visibilityPrompt.create({
      data: { projectId: project.id, promptSetId: promptSet.id, promptKey: 'k', version: 1, promptText: 'q', promptHash: `h-${suffix}` }
    });
    const run = await prisma.visibilityRun.create({
      data: { projectId: project.id, promptSetId: promptSet.id, runType: 'MANUAL', requestedProviderConfigs: [], maxObservations: 1, policySnapshotJson: {}, currency: 'USD' }
    });

    // Historical observations created before citation evidence was explicit must remain UNKNOWN;
    // an empty citations array alone is never evidence of zero citations.
    const observation = await prisma.platformObservation.create({
      data: {
        projectId: project.id,
        visibilityRunId: run.id,
        visibilityPromptId: prompt.id,
        promptVersion: 1,
        samplingUnitKey: `legacy-${suffix}`,
        provider: 'OPENAI',
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        status: 'COMPLETED',
        citationsJson: [],
        searchMetadataJson: {}
      }
    });
    expect(observation.citationEvidenceState).toBe('UNKNOWN');
  });

  it('cascades P6-B derived rows with the project without deleting another project', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const survivor = await prisma.project.create({
      data: { name: 'Survivor', slug: `survivor-${suffix}`, primaryDomain: `survivor-${suffix}.example.com` }
    });
    projectIds.push(survivor.id);

    const doomed = await prisma.project.create({
      data: { name: 'Doomed', slug: `doomed-${suffix}`, primaryDomain: `doomed-${suffix}.example.com`, planLevel: 'ADVANCED' }
    });
    await prisma.visibilitySubject.create({
      data: {
        projectId: doomed.id,
        subjectType: 'OWNED_DOMAIN',
        canonicalValue: doomed.primaryDomain,
        normalizedValue: doomed.primaryDomain,
        sourceType: 'PRIMARY_DOMAIN'
      }
    });

    await prisma.project.delete({ where: { id: doomed.id } });

    expect(await prisma.visibilitySubject.count({ where: { projectId: doomed.id } })).toBe(0);
    expect(await prisma.project.findUnique({ where: { id: survivor.id } })).not.toBeNull();
  });
});
