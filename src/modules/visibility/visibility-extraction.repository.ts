import type {
  Prisma,
  VisibilityEvidenceStatus,
  VisibilityExtraction
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { DerivedCitation } from './visibility-citation.extractor.js';
import type { DerivedMention } from './visibility-mention.extractor.js';

export interface CreateVisibilityExtractionInput {
  projectId: string;
  platformObservationId: string;
  extractorVersion: string;
  subjectSetHash: string;
  subjectSnapshotJson: Prisma.InputJsonValue;
  answerHash: string | null;
}

export interface CompleteVisibilityExtractionInput {
  projectId: string;
  platformObservationId: string;
  extractorVersion: string;
  mentionStatus: VisibilityEvidenceStatus;
  citationStatus: VisibilityEvidenceStatus;
  mentions: DerivedMention[];
  citations: DerivedCitation[];
}

export class VisibilityExtractionRepository {
  async createOrGet(input: CreateVisibilityExtractionInput): Promise<VisibilityExtraction> {
    return prisma.visibilityExtraction.upsert({
      where: {
        platformObservationId_extractorVersion_subjectSetHash: {
          platformObservationId: input.platformObservationId,
          extractorVersion: input.extractorVersion,
          subjectSetHash: input.subjectSetHash
        }
      },
      create: {
        projectId: input.projectId,
        platformObservationId: input.platformObservationId,
        extractorVersion: input.extractorVersion,
        subjectSetHash: input.subjectSetHash,
        subjectSnapshotJson: input.subjectSnapshotJson,
        answerHash: input.answerHash,
        status: 'QUEUED',
        mentionStatus: 'UNKNOWN',
        citationStatus: 'UNKNOWN',
        mentionCount: 0,
        citationCount: 0
      },
      update: {}
    });
  }

  async claim(extractionId: string): Promise<boolean> {
    const result = await prisma.visibilityExtraction.updateMany({
      where: { id: extractionId, status: 'QUEUED' },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        errorCode: null
      }
    });
    return result.count === 1;
  }

  async get(extractionId: string): Promise<VisibilityExtraction | null> {
    return prisma.visibilityExtraction.findUnique({ where: { id: extractionId } });
  }

  async completeAtomic(
    extractionId: string,
    input: CompleteVisibilityExtractionInput
  ): Promise<VisibilityExtraction> {
    return prisma.$transaction(async (tx) => {
      if (input.mentions.length) {
        await tx.mentionObservation.createMany({
          data: input.mentions.map((mention) => ({
            projectId: input.projectId,
            visibilityExtractionId: extractionId,
            platformObservationId: input.platformObservationId,
            subjectId: mention.subjectId,
            subjectType: mention.subjectType,
            subjectValue: mention.subjectValue,
            matchedValue: mention.matchedValue,
            mentionType: mention.mentionType,
            occurrenceCount: mention.occurrenceCount,
            firstPosition: mention.firstPosition,
            extractorVersion: input.extractorVersion
          }))
        });
      }

      if (input.citations.length) {
        await tx.citationObservation.createMany({
          data: input.citations.map((citation) => ({
            projectId: input.projectId,
            visibilityExtractionId: extractionId,
            platformObservationId: input.platformObservationId,
            citationKey: citation.citationKey,
            url: citation.url,
            normalizedUrl: citation.normalizedUrl,
            domain: citation.domain,
            position: citation.position,
            title: citation.title,
            sourceType: citation.sourceType,
            occurrenceCount: citation.occurrenceCount,
            isOwnedDomain: citation.isOwnedDomain,
            ownedSubjectId: citation.ownedSubjectId,
            competitorId: citation.competitorId,
            competitorSubjectId: citation.competitorSubjectId,
            extractorVersion: input.extractorVersion
          }))
        });
      }

      return tx.visibilityExtraction.update({
        where: { id: extractionId },
        data: {
          status: 'COMPLETED',
          mentionStatus: input.mentionStatus,
          citationStatus: input.citationStatus,
          mentionCount: input.mentions.length,
          citationCount: input.citations.length,
          errorCode: null,
          completedAt: new Date()
        }
      });
    });
  }

  async fail(extractionId: string, errorCode: string): Promise<VisibilityExtraction> {
    return prisma.visibilityExtraction.update({
      where: { id: extractionId },
      data: {
        status: 'FAILED',
        errorCode,
        completedAt: new Date()
      }
    });
  }
}

export const visibilityExtractionRepository = new VisibilityExtractionRepository();
