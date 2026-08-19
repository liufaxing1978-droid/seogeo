import { prisma } from '../../db/prisma.js';

const WEB_LIMIT = 100;

export class VisibilityIntelligenceWebRepository {
  async getCitationMonitor(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const [citations, mentions, extractions] = await Promise.all([
      prisma.citationObservation.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: WEB_LIMIT,
        select: {
          id: true,
          visibilityExtractionId: true,
          platformObservationId: true,
          normalizedUrl: true,
          domain: true,
          position: true,
          title: true,
          sourceType: true,
          occurrenceCount: true,
          isOwnedDomain: true,
          ownedSubjectId: true,
          competitorId: true,
          competitorSubjectId: true,
          extractorVersion: true,
          createdAt: true
        }
      }),
      prisma.mentionObservation.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: WEB_LIMIT,
        select: {
          id: true,
          visibilityExtractionId: true,
          platformObservationId: true,
          subjectId: true,
          subjectType: true,
          subjectValue: true,
          matchedValue: true,
          mentionType: true,
          occurrenceCount: true,
          firstPosition: true,
          extractorVersion: true,
          createdAt: true
        }
      }),
      prisma.visibilityExtraction.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: WEB_LIMIT,
        select: {
          id: true,
          platformObservationId: true,
          status: true,
          extractorVersion: true,
          subjectSetHash: true,
          mentionStatus: true,
          citationStatus: true,
          mentionCount: true,
          citationCount: true,
          errorCode: true,
          completedAt: true,
          createdAt: true
        }
      })
    ]);

    return { project, citations, mentions, extractions, limit: WEB_LIMIT };
  }

  async getSubjects(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const [subjects, aliases] = await Promise.all([
      prisma.visibilitySubject.findMany({
        where: { projectId },
        orderBy: [{ status: 'asc' }, { subjectType: 'asc' }, { normalizedValue: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          subjectType: true,
          canonicalValue: true,
          normalizedValue: true,
          status: true,
          sourceType: true,
          entityId: true,
          competitorId: true,
          createdAt: true
        }
      }),
      prisma.visibilitySubjectAlias.findMany({
        where: { projectId },
        orderBy: [{ normalizedAlias: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          subjectId: true,
          alias: true,
          normalizedAlias: true,
          aliasType: true,
          sourceType: true,
          status: true,
          createdAt: true
        }
      })
    ]);

    return { project, subjects, aliases };
  }

  async getExtractionDetail(projectId: string, extractionId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const extraction = await prisma.visibilityExtraction.findFirst({
      where: { id: extractionId, projectId },
      select: {
        id: true,
        platformObservationId: true,
        status: true,
        extractorVersion: true,
        subjectSetHash: true,
        answerHash: true,
        mentionStatus: true,
        citationStatus: true,
        mentionCount: true,
        citationCount: true,
        errorCode: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
    if (!extraction) return null;

    const [mentions, citations] = await Promise.all([
      prisma.mentionObservation.findMany({
        where: { projectId, visibilityExtractionId: extractionId },
        orderBy: [{ firstPosition: 'asc' }, { id: 'asc' }],
        take: WEB_LIMIT,
        select: {
          id: true,
          subjectId: true,
          subjectType: true,
          subjectValue: true,
          matchedValue: true,
          mentionType: true,
          occurrenceCount: true,
          firstPosition: true,
          extractorVersion: true,
          createdAt: true
        }
      }),
      prisma.citationObservation.findMany({
        where: { projectId, visibilityExtractionId: extractionId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: WEB_LIMIT,
        select: {
          id: true,
          normalizedUrl: true,
          domain: true,
          position: true,
          title: true,
          sourceType: true,
          occurrenceCount: true,
          isOwnedDomain: true,
          ownedSubjectId: true,
          competitorId: true,
          competitorSubjectId: true,
          extractorVersion: true,
          createdAt: true
        }
      })
    ]);

    return { project, extraction, mentions, citations };
  }
}

export const visibilityIntelligenceWebRepository = new VisibilityIntelligenceWebRepository();
