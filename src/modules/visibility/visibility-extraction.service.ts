import { createHash } from 'node:crypto';
import type { Prisma, VisibilityEvidenceStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  extractCitations,
  type CitationExtractionResult
} from './visibility-citation.extractor.js';
import {
  VisibilityExtractionRepository,
  visibilityExtractionRepository
} from './visibility-extraction.repository.js';
import {
  extractMentions,
  type MentionExtractionResult
} from './visibility-mention.extractor.js';
import {
  VisibilitySubjectService,
  type VisibilitySubjectSnapshot
} from './visibility-subject.service.js';

export const P6B_EXTRACTION_VERSION = 'P6B_EXTRACTION_V1';

export type MentionExtractor = (
  answerText: unknown,
  snapshot: VisibilitySubjectSnapshot
) => MentionExtractionResult;

export type CitationExtractor = (
  observation: {
    id?: string;
    status: string;
    citationEvidenceState: string;
    citationsJson: unknown;
    answerText?: unknown;
  },
  snapshot: VisibilitySubjectSnapshot
) => CitationExtractionResult;

export interface VisibilityExtractionServiceOptions {
  extractorVersion?: string;
  repository?: VisibilityExtractionRepository;
  subjectService?: VisibilitySubjectService;
  mentionExtractor?: MentionExtractor;
  citationExtractor?: CitationExtractor;
}

export class VisibilityExtractionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'VisibilityExtractionError';
    this.code = code;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeSubjectSetHash(snapshot: VisibilitySubjectSnapshot): string {
  return createHash('sha256')
    .update(stableJson({
      subjects: snapshot.subjects,
      ambiguousAliases: snapshot.ambiguousAliases
    }))
    .digest('hex');
}

function answerHash(answerText: string | null, persistedHash: string | null): string | null {
  if (persistedHash) return persistedHash;
  if (answerText === null) return null;
  return createHash('sha256').update(answerText).digest('hex');
}

function mentionStatus(
  observationStatus: string,
  result: MentionExtractionResult
): VisibilityEvidenceStatus {
  if (observationStatus !== 'COMPLETED') return 'NOT_ELIGIBLE';
  return result.status;
}

function safeFailureCode(error: unknown): string {
  if (error instanceof VisibilityExtractionError) return error.code;
  return 'VISIBILITY_EXTRACTION_MATERIALIZATION_FAILED';
}

export class VisibilityExtractionService {
  private readonly extractorVersion: string;
  private readonly repository: VisibilityExtractionRepository;
  private readonly subjectService: VisibilitySubjectService;
  private readonly mentionExtractor: MentionExtractor;
  private readonly citationExtractor: CitationExtractor;

  constructor(options: VisibilityExtractionServiceOptions = {}) {
    this.extractorVersion = options.extractorVersion ?? P6B_EXTRACTION_VERSION;
    this.repository = options.repository ?? visibilityExtractionRepository;
    this.subjectService = options.subjectService ?? new VisibilitySubjectService();
    this.mentionExtractor = options.mentionExtractor ?? extractMentions;
    this.citationExtractor = options.citationExtractor ?? extractCitations;
  }

  async extractObservation(
    projectId: string,
    observationId: string,
    expectedSubjectSetHash?: string
  ) {
    const observation = await prisma.platformObservation.findFirst({
      where: { id: observationId, projectId }
    });
    if (!observation) {
      throw new VisibilityExtractionError(
        'VISIBILITY_OBSERVATION_NOT_FOUND',
        'Visibility observation not found'
      );
    }

    const snapshot = await this.subjectService.buildActiveSnapshot(projectId);
    const subjectSetHash = computeSubjectSetHash(snapshot);
    if (snapshot.subjectSetHash !== subjectSetHash) {
      throw new VisibilityExtractionError(
        'VISIBILITY_SUBJECT_SNAPSHOT_HASH_MISMATCH',
        'Visibility subject snapshot hash mismatch'
      );
    }
    if (expectedSubjectSetHash && expectedSubjectSetHash !== subjectSetHash) {
      throw new VisibilityExtractionError(
        'VISIBILITY_SUBJECT_SNAPSHOT_STALE',
        'Visibility subject snapshot changed after extraction was queued'
      );
    }

    const extraction = await this.repository.createOrGet({
      projectId,
      platformObservationId: observation.id,
      extractorVersion: this.extractorVersion,
      subjectSetHash,
      subjectSnapshotJson: snapshot as unknown as Prisma.InputJsonValue,
      answerHash: answerHash(observation.answerText, observation.answerHash)
    });

    if (extraction.status === 'COMPLETED') return extraction;

    const claimed = await this.repository.claim(extraction.id);
    if (!claimed) {
      const current = await this.repository.get(extraction.id);
      if (current) return current;
      throw new VisibilityExtractionError(
        'VISIBILITY_EXTRACTION_CLAIM_FAILED',
        'Visibility extraction could not be claimed'
      );
    }

    try {
      const mentionResult: MentionExtractionResult = observation.status === 'COMPLETED'
        ? this.mentionExtractor(observation.answerText, snapshot)
        : { status: 'UNKNOWN', mentions: [] };
      const citationResult = this.citationExtractor({
        id: observation.id,
        status: observation.status,
        citationEvidenceState: observation.citationEvidenceState,
        citationsJson: observation.citationsJson,
        answerText: observation.answerText
      }, snapshot);

      return await this.repository.completeAtomic(extraction.id, {
        projectId,
        platformObservationId: observation.id,
        extractorVersion: this.extractorVersion,
        mentionStatus: mentionStatus(observation.status, mentionResult),
        citationStatus: citationResult.status,
        mentions: mentionResult.mentions,
        citations: citationResult.citations
      });
    } catch (error) {
      await this.repository.fail(extraction.id, safeFailureCode(error));
      throw error;
    }
  }
}
