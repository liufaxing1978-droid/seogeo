import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  contentQualityObservability,
  type ContentQualityCategoryCounts,
  type ContentQualityObservability,
  type ContentQualityPriorityCounts
} from './content-quality.observability.js';
import type {
  ComparableSnapshot,
  ContentQualityEvaluation,
  P5ContentOpportunityReference,
  P5ContentSignalReference
} from './content-quality.types.js';

const ACTIVE_RUN_STATUSES = ['QUEUED', 'RUNNING'] as const;

export interface ContentQualityInputDocument {
  id: string;
  pageId: string;
  latestPageSnapshotId: string;
  internalLinkCount: number | null;
  snapshots: ComparableSnapshot[];
  opportunities: P5ContentOpportunityReference[];
  signals: P5ContentSignalReference[];
}

export interface ContentQualityInput {
  cutoffAt: Date;
  documents: ContentQualityInputDocument[];
}

export interface ContentQualityMaterialization {
  count: number;
  categoryCounts: ContentQualityCategoryCounts;
  priorityCounts: ContentQualityPriorityCounts;
}

function errorWithCode(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function prismaCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

function asSourceReferences(value: Prisma.JsonValue): P5ContentSignalReference['sourceReferences'] {
  return Array.isArray(value) ? value as unknown as P5ContentSignalReference['sourceReferences'] : [];
}

function snapshotIds(evidence: Prisma.JsonValue): string[] {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return [];
  const references = (evidence as Record<string, unknown>).sourceReferences;
  if (!Array.isArray(references)) return [];
  return references.flatMap((reference) => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return [];
    const value = (reference as Record<string, unknown>);
    return value.type === 'PAGE_SNAPSHOT' && typeof value.id === 'string' ? [value.id] : [];
  });
}

function emptyCategoryCounts(): ContentQualityCategoryCounts {
  return { internalLinkSupport: 0, contentDecay: 0, contentQa: 0 };
}

function emptyPriorityCounts(): ContentQualityPriorityCounts {
  return { info: 0, low: 0, medium: 0, high: 0 };
}

function incrementMaterialization(
  counts: ContentQualityMaterialization,
  evaluation: ContentQualityEvaluation
): void {
  if (evaluation.category === 'INTERNAL_LINK_SUPPORT') counts.categoryCounts.internalLinkSupport += 1;
  if (evaluation.category === 'CONTENT_DECAY') counts.categoryCounts.contentDecay += 1;
  if (evaluation.category === 'CONTENT_QA') counts.categoryCounts.contentQa += 1;
  if (evaluation.priority === 'INFO') counts.priorityCounts.info += 1;
  if (evaluation.priority === 'LOW') counts.priorityCounts.low += 1;
  if (evaluation.priority === 'MEDIUM') counts.priorityCounts.medium += 1;
  if (evaluation.priority === 'HIGH') counts.priorityCounts.high += 1;
}

export class ContentQualityRepository {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly observability: ContentQualityObservability = contentQualityObservability
  ) {}

  async claimActiveRun(projectId: string, actorId: string) {
    const existing = await this.findActiveRun(projectId);
    if (existing) return { run: existing, claimed: false };
    try {
      const run = await this.db.contentQualityRun.create({
        data: { projectId, rulesetVersion: 1, requestedByActorId: actorId, activeRunKey: projectId }
      });
      return { run, claimed: true };
    } catch (error) {
      if (prismaCode(error) !== 'P2002') throw error;
      const active = await this.findActiveRun(projectId);
      if (active) return { run: active, claimed: false };
      throw error;
    }
  }

  findActiveRun(projectId: string) {
    return this.db.contentQualityRun.findFirst({
      where: { projectId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
  }

  getRun(projectId: string, runId: string) {
    return this.db.contentQualityRun.findFirst({
      where: { id: runId, projectId },
      select: { id: true, status: true }
    });
  }

  async startRun(projectId: string, runId: string): Promise<{ cutoffAt: Date } | null> {
    const cutoffAt = new Date();
    const updated = await this.db.contentQualityRun.updateMany({
      where: { id: runId, projectId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: cutoffAt, inputSnapshotCutoffAt: cutoffAt, errorCode: null }
    });
    return updated.count === 1 ? { cutoffAt } : null;
  }

  async loadInput(projectId: string, cutoffAt: Date): Promise<ContentQualityInput> {
    const documents = await this.db.contentDocument.findMany({
      where: { projectId },
      select: { id: true, pageId: true, latestPageSnapshotId: true, internalLinkCount: true },
      orderBy: { id: 'asc' }
    });
    const documentIds = documents.map((document) => document.id);
    const pageIds = documents.map((document) => document.pageId);
    const [snapshots, opportunities, signals] = await Promise.all([
      this.db.pageSnapshot.findMany({
        where: { pageId: { in: pageIds }, capturedAt: { lte: cutoffAt } },
        select: {
          id: true, pageId: true, capturedAt: true, statusCode: true, contentType: true,
          indexable: true, wordCount: true, title: true, h1: true
        },
        orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }]
      }),
      this.db.contentOpportunity.findMany({
        where: { projectId, contentDocumentId: { in: documentIds } },
        select: {
          id: true, contentDocumentId: true, opportunityKey: true, opportunityVersion: true,
          status: true, priority: true
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      }),
      this.db.contentSignal.findMany({
        where: { projectId, contentDocumentId: { in: documentIds } },
        select: {
          id: true, contentDocumentId: true, ruleKey: true, ruleVersion: true,
          status: true, sourceReferences: true
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      })
    ]);
    const snapshotsByPage = new Map<string, ComparableSnapshot[]>();
    for (const snapshot of snapshots) {
      const history = snapshotsByPage.get(snapshot.pageId) ?? [];
      history.push({
        id: snapshot.id,
        capturedAt: snapshot.capturedAt,
        statusCode: snapshot.statusCode,
        contentType: snapshot.contentType,
        indexable: snapshot.indexable,
        wordCount: snapshot.wordCount,
        title: snapshot.title,
        h1: snapshot.h1
      });
      snapshotsByPage.set(snapshot.pageId, history);
    }
    const opportunitiesByDocument = new Map<string, P5ContentOpportunityReference[]>();
    for (const opportunity of opportunities) {
      const rows = opportunitiesByDocument.get(opportunity.contentDocumentId) ?? [];
      rows.push(opportunity);
      opportunitiesByDocument.set(opportunity.contentDocumentId, rows);
    }
    const signalsByDocument = new Map<string, P5ContentSignalReference[]>();
    for (const signal of signals) {
      const rows = signalsByDocument.get(signal.contentDocumentId) ?? [];
      rows.push({ ...signal, sourceReferences: asSourceReferences(signal.sourceReferences) });
      signalsByDocument.set(signal.contentDocumentId, rows);
    }

    return {
      cutoffAt,
      documents: documents.map((document) => ({
        ...document,
        snapshots: snapshotsByPage.get(document.pageId) ?? [],
        opportunities: opportunitiesByDocument.get(document.id) ?? [],
        signals: signalsByDocument.get(document.id) ?? []
      }))
    };
  }

  async materializeFailures(
    projectId: string,
    runId: string,
    rows: Array<{ contentDocumentId: string; evaluation: ContentQualityEvaluation }>
  ): Promise<ContentQualityMaterialization> {
    const now = new Date();
    const materialized: ContentQualityMaterialization = {
      count: 0,
      categoryCounts: emptyCategoryCounts(),
      priorityCounts: emptyPriorityCounts()
    };
    await this.db.$transaction(async (tx) => {
      for (const row of rows) {
        const { evaluation } = row;
        if (evaluation.status !== 'FAIL') continue;
        const where = {
          contentDocumentId_findingKey_ruleVersion: {
            contentDocumentId: row.contentDocumentId,
            findingKey: evaluation.findingKey,
            ruleVersion: evaluation.ruleVersion
          }
        };
        const existing = await tx.contentQualityFinding.findUnique({ where });
        if (!existing) {
          await tx.contentQualityFinding.create({
            data: {
              projectId,
              contentDocumentId: row.contentDocumentId,
              latestRunId: runId,
              findingKey: evaluation.findingKey,
              ruleVersion: evaluation.ruleVersion,
              category: evaluation.category,
              priority: evaluation.priority,
              summary: evaluation.summary,
              evidence: evaluation.evidence as unknown as Prisma.InputJsonValue,
              firstDetectedAt: now,
              lastDetectedAt: now
            }
          });
          materialized.count += 1;
          incrementMaterialization(materialized, evaluation);
          continue;
        }
        if (existing.status === 'OPEN' || existing.status === 'IN_REVIEW') {
          await tx.contentQualityFinding.update({
            where: { id: existing.id },
            data: {
              latestRunId: runId,
              category: evaluation.category,
              priority: evaluation.priority,
              summary: evaluation.summary,
              evidence: evaluation.evidence as unknown as Prisma.InputJsonValue,
              lastDetectedAt: now
            }
          });
          materialized.count += 1;
          incrementMaterialization(materialized, evaluation);
        }
      }
    });
    return materialized;
  }

  completeRun(projectId: string, runId: string, inputDocumentCount: number, findingCount: number) {
    return this.db.contentQualityRun.updateMany({
      where: { id: runId, projectId, status: 'RUNNING' },
      data: {
        status: 'COMPLETED',
        activeRunKey: null,
        inputDocumentCount,
        findingCount,
        completedAt: new Date(),
        errorCode: null
      }
    });
  }

  failRun(projectId: string, runId: string, errorCode: string) {
    return this.db.contentQualityRun.updateMany({
      where: { id: runId, projectId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', activeRunKey: null, completedAt: new Date(), errorCode: errorCode.slice(0, 80) }
    });
  }

  async transitionFinding(
    projectId: string,
    findingId: string,
    toStatus: 'IN_REVIEW' | 'DISMISSED' | 'OPEN',
    actorId: string,
    reason?: string
  ) {
    const updated = await this.serializable(async (tx) => {
      const finding = await tx.contentQualityFinding.findFirst({ where: { id: findingId, projectId } });
      if (!finding) throw errorWithCode('Content quality finding not found.', 'CONTENT_QUALITY_FINDING_NOT_FOUND');
      const allowed = (finding.status === 'OPEN' && (toStatus === 'IN_REVIEW' || toStatus === 'DISMISSED'))
        || (finding.status === 'IN_REVIEW' && (toStatus === 'OPEN' || toStatus === 'DISMISSED'));
      if (!allowed) throw errorWithCode('Content quality finding transition is not allowed.', 'CONTENT_QUALITY_INVALID_TRANSITION');
      const conditional = await tx.contentQualityFinding.updateMany({
        where: {
          id: finding.id,
          projectId,
          status: finding.status,
          acceptedPublicationProposalId: null
        },
        data: { status: toStatus }
      });
      if (conditional.count !== 1) {
        throw errorWithCode('Content quality finding changed during transition.', 'CONTENT_QUALITY_CONCURRENT_TRANSITION');
      }
      await tx.contentQualityFindingHistory.create({
        data: {
          findingId: finding.id,
          fromStatus: finding.status,
          toStatus,
          actorId,
          reason: reason ?? null,
          metadata: { program: 'P13-A', action: 'manual-transition' }
        }
      });
      return tx.contentQualityFinding.findUniqueOrThrow({ where: { id: finding.id } });
    });
    this.observability.emit({
      event: 'content.quality.finding.transitioned',
      projectId,
      findingId,
      toStatus,
      transitionCount: 1
    });
    return updated;
  }

  async acceptFinding(projectId: string, findingId: string, actorId: string) {
    try {
      const result = await this.serializable(async (tx) => {
      const finding = await tx.contentQualityFinding.findFirst({ where: { id: findingId, projectId } });
      if (!finding) throw errorWithCode('Content quality finding not found.', 'CONTENT_QUALITY_FINDING_NOT_FOUND');
      if (finding.acceptedPublicationProposalId) {
        const proposal = await tx.publicationProposal.findUnique({ where: { id: finding.acceptedPublicationProposalId } });
        if (proposal) return { proposal, accepted: false };
        throw errorWithCode('Accepted finding proposal is missing.', 'CONTENT_QUALITY_ACCEPTANCE_CORRUPT');
      }
      if (finding.status !== 'OPEN' && finding.status !== 'IN_REVIEW') {
        throw errorWithCode('Content quality finding is not eligible for acceptance.', 'CONTENT_QUALITY_INVALID_TRANSITION');
      }
      const proposal = await tx.publicationProposal.create({
        data: {
          projectId,
          sourceType: 'CONTENT_REFRESH',
          reason: `P13-A content-quality finding: ${finding.summary}`,
          createdBy: actorId,
          sourceReferenceId: finding.id,
          sourceSnapshotId: snapshotIds(finding.evidence)[0] ?? null,
          p13aFindingHandoffKey: finding.id,
          sourceMetadata: {
            program: 'P13-A',
            findingId: finding.id,
            ruleVersion: finding.ruleVersion,
            snapshotIds: snapshotIds(finding.evidence)
          }
        }
      });
      const conditional = await tx.contentQualityFinding.updateMany({
        where: {
          id: finding.id,
          projectId,
          status: finding.status,
          acceptedPublicationProposalId: null
        },
        data: { status: 'ACCEPTED', acceptedPublicationProposalId: proposal.id }
      });
      if (conditional.count !== 1) {
        throw errorWithCode('Content quality finding changed during acceptance.', 'CONTENT_QUALITY_CONCURRENT_TRANSITION');
      }
      await tx.contentQualityFindingHistory.create({
        data: {
          findingId: finding.id,
          fromStatus: finding.status,
          toStatus: 'ACCEPTED',
          actorId,
          metadata: { program: 'P13-A', action: 'accept', publicationProposalId: proposal.id }
        }
      });
      return { proposal, accepted: true };
    });
      if (result.accepted) {
        this.observability.emit({
          event: 'content.quality.finding.accepted',
          projectId,
          findingId,
          acceptedCount: 1
        });
      }
      return result.proposal;
    } catch (error) {
      if (prismaCode(error) !== 'P2002') throw error;
      const existing = await this.db.publicationProposal.findUnique({ where: { p13aFindingHandoffKey: findingId } });
      if (!existing) throw error;
      return existing;
    }
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (prismaCode(error) !== 'P2034' || attempt === 2) throw error;
      }
    }
    throw errorWithCode('Content quality transaction did not complete.', 'CONTENT_QUALITY_TRANSACTION_FAILED');
  }
}

export const contentQualityRepository = new ContentQualityRepository();
