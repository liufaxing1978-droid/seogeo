import type { KeywordDiscoveryCandidate } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { normalizeKeywordText } from './keyword-normalize.js';
import { projectKeywordDiscoveryEvidence } from './keyword-discovery.js';
import {
  KeywordDiscoveryRepository,
  type KeywordDiscoveryRepositoryWindow,
} from './keyword-discovery.repository.js';
import type {
  AcceptKeywordDiscoveryInput,
  KeywordDiscoveryReadModel,
  KeywordDiscoveryRefreshResult,
  RejectKeywordDiscoveryInput,
} from './keyword-discovery.types.js';

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 28;
const MAX_DAYS = 93;

function rangeError(): Error {
  return new Error('KEYWORD_DISCOVERY_RANGE_INVALID');
}

function parseUtcDay(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw rangeError();
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw rangeError();
  }
  return date;
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function resolveWindow(
  input: { dateFrom?: string; dateTo?: string },
  now: Date,
): { dateFrom: Date; dateTo: Date } {
  if (Number.isNaN(now.getTime())) throw rangeError();

  const today = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const yesterday = new Date(today.getTime() - DAY_MS);

  let dateFrom: Date;
  let dateTo: Date;
  if (input.dateFrom === undefined && input.dateTo === undefined) {
    dateTo = yesterday;
    dateFrom = new Date(dateTo.getTime() - (DEFAULT_DAYS - 1) * DAY_MS);
  } else {
    if (input.dateFrom === undefined || input.dateTo === undefined) throw rangeError();
    dateFrom = parseUtcDay(input.dateFrom);
    dateTo = parseUtcDay(input.dateTo);
  }

  if (dateFrom.getTime() > dateTo.getTime() || dateTo.getTime() > yesterday.getTime()) {
    throw rangeError();
  }
  const inclusiveDays = Math.floor((dateTo.getTime() - dateFrom.getTime()) / DAY_MS) + 1;
  if (inclusiveDays > MAX_DAYS) throw rangeError();

  return { dateFrom, dateTo };
}

function asUtcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function nextRepresentative(
  candidate: KeywordDiscoveryCandidate,
  projectedRepresentative: string,
  projectedLastObservedAt: Date,
): string {
  const currentLast = candidate.lastObservedAt.getTime();
  const projectedLast = projectedLastObservedAt.getTime();
  if (projectedLast > currentLast) return projectedRepresentative;
  if (projectedLast < currentLast) return candidate.representativeText;
  return [candidate.representativeText, projectedRepresentative]
    .sort((left, right) => left.localeCompare(right))[0]!;
}

function discoveryNotFound(): AppError {
  return new AppError('Keyword discovery candidate not found', 404, 'KEYWORD_DISCOVERY_NOT_FOUND');
}

function discoveryAlreadyDecided(): AppError {
  return new AppError('Keyword discovery candidate already decided', 409, 'KEYWORD_DISCOVERY_ALREADY_DECIDED');
}

function archivedKeywordRestoreRequired(): AppError {
  return new AppError(
    'Archived keyword must be restored rather than recreated',
    409,
    'KEYWORD_ARCHIVED_RESTORE_REQUIRED',
  );
}

export class KeywordDiscoveryService {
  private readonly repository: KeywordDiscoveryRepository;
  private readonly now: () => Date;

  constructor(input: {
    repository: KeywordDiscoveryRepository;
    now?: () => Date;
  }) {
    this.repository = input.repository;
    this.now = input.now ?? (() => new Date());
  }

  private async load(input: {
    projectId: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{
    window: KeywordDiscoveryRepositoryWindow;
    projections: ReturnType<typeof projectKeywordDiscoveryEvidence>;
  }> {
    const range = resolveWindow(input, this.now());
    const window = await this.repository.loadWindow({
      projectId: input.projectId,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    });
    const projections = projectKeywordDiscoveryEvidence({
      facts: window.facts,
      trackedKeywords: window.trackedKeywords,
    });
    return { window, projections };
  }

  async refresh(input: {
    projectId: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<KeywordDiscoveryRefreshResult> {
    const { window, projections } = await this.load(input);
    const candidates = new Map(
      window.candidates.map((candidate) => [candidate.normalizedQuery, candidate]),
    );

    let created = 0;
    let updated = 0;
    let preserved = 0;

    for (const projection of projections) {
      const existing = candidates.get(projection.normalizedQuery);
      if (!existing) {
        if (projection.trackedKeywordId !== null) continue;
        const candidate = await this.repository.createCandidate({
          projectId: input.projectId,
          normalizedQuery: projection.normalizedQuery,
          representativeText: projection.representativeText,
          firstObservedAt: asUtcDay(projection.firstObservedAt),
          lastObservedAt: asUtcDay(projection.lastObservedAt),
        });
        candidates.set(candidate.normalizedQuery, candidate);
        created += 1;
        continue;
      }

      const projectedFirst = asUtcDay(projection.firstObservedAt);
      const projectedLast = asUtcDay(projection.lastObservedAt);
      const firstObservedAt = new Date(Math.min(
        existing.firstObservedAt.getTime(),
        projectedFirst.getTime(),
      ));
      const lastObservedAt = new Date(Math.max(
        existing.lastObservedAt.getTime(),
        projectedLast.getTime(),
      ));
      const representativeText = nextRepresentative(
        existing,
        projection.representativeText,
        projectedLast,
      );

      const changed = firstObservedAt.getTime() !== existing.firstObservedAt.getTime()
        || lastObservedAt.getTime() !== existing.lastObservedAt.getTime()
        || representativeText !== existing.representativeText;

      if (!changed) {
        preserved += 1;
        continue;
      }

      await this.repository.updateObservation({
        projectId: input.projectId,
        candidateId: existing.id,
        representativeText,
        firstObservedAt,
        lastObservedAt,
      });
      updated += 1;
    }

    return { created, updated, preserved };
  }

  async list(input: {
    projectId: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<KeywordDiscoveryReadModel[]> {
    const { window, projections } = await this.load(input);
    const candidates = new Map(
      window.candidates.map((candidate) => [candidate.normalizedQuery, candidate]),
    );

    return projections.map((projection) => {
      const candidate = candidates.get(projection.normalizedQuery);
      if (candidate) {
        return {
          candidateId: candidate.id,
          normalizedQuery: projection.normalizedQuery,
          representativeText: projection.representativeText,
          trackedKeywordId: projection.trackedKeywordId ?? candidate.acceptedKeywordId,
          status: candidate.status,
          firstObservedAt: projection.firstObservedAt,
          lastObservedAt: projection.lastObservedAt,
          providers: projection.providers,
        };
      }

      return {
        candidateId: null,
        normalizedQuery: projection.normalizedQuery,
        representativeText: projection.representativeText,
        trackedKeywordId: projection.trackedKeywordId,
        status: projection.trackedKeywordId === null ? 'PENDING' : 'TRACKED',
        firstObservedAt: projection.firstObservedAt,
        lastObservedAt: projection.lastObservedAt,
        providers: projection.providers,
      };
    });
  }

  async accept(input: AcceptKeywordDiscoveryInput) {
    return this.repository.withSerializableTransaction(async ({ discovery, keywords }) => {
      const candidate = await discovery.findCandidate(input.projectId, input.candidateId);
      if (!candidate) throw discoveryNotFound();

      if (candidate.status === 'ACCEPTED') {
        if (!candidate.acceptedKeywordId) throw discoveryAlreadyDecided();
        const linked = await keywords.findKeyword(input.projectId, candidate.acceptedKeywordId);
        if (!linked) throw discoveryAlreadyDecided();
        return linked;
      }
      if (candidate.status !== 'PENDING') throw discoveryAlreadyDecided();

      const rawText = candidate.representativeText.trim();
      const normalizedText = normalizeKeywordText(rawText);
      if (!normalizedText) {
        throw new AppError('Keyword discovery text is required', 400, 'KEYWORD_DISCOVERY_TEXT_INVALID');
      }

      let keyword = await keywords.findByNormalized(input.projectId, normalizedText);
      if (keyword?.status === 'ARCHIVED') throw archivedKeywordRestoreRequired();

      if (!keyword) {
        keyword = await keywords.createKeyword({
          projectId: input.projectId,
          text: rawText,
          normalizedText,
          type: input.type,
          intent: input.intent ?? 'UNKNOWN',
          priority: input.priority ?? 'MEDIUM',
          status: 'ACTIVE',
          locked: false,
          source: 'SEARCH_DISCOVERY_ACCEPTED',
          language: input.language ?? null,
          targetCountry: input.targetCountry ?? null,
          notes: null,
          createdByUserId: input.actorUserId,
        });
      }

      const decidedAt = this.now();
      await discovery.updateDecision({
        projectId: input.projectId,
        candidateId: candidate.id,
        status: 'ACCEPTED',
        acceptedKeywordId: keyword.id,
        decidedAt,
        decidedByUserId: input.actorUserId,
      });
      await keywords.appendAudit(
        input.projectId,
        keyword.id,
        input.actorUserId,
        'KEYWORD_DISCOVERY_ACCEPTED',
        {
          candidateId: candidate.id,
          source: 'SEARCH_DISCOVERY_ACCEPTED',
        },
      );

      return keyword;
    });
  }

  async reject(input: RejectKeywordDiscoveryInput): Promise<KeywordDiscoveryCandidate> {
    return this.repository.withSerializableTransaction(async ({ discovery }) => {
      const candidate = await discovery.findCandidate(input.projectId, input.candidateId);
      if (!candidate) throw discoveryNotFound();
      if (candidate.status === 'REJECTED') return candidate;
      if (candidate.status === 'ACCEPTED') throw discoveryAlreadyDecided();

      const decidedAt = this.now();
      await discovery.updateDecision({
        projectId: input.projectId,
        candidateId: candidate.id,
        status: 'REJECTED',
        acceptedKeywordId: null,
        decidedAt,
        decidedByUserId: input.actorUserId,
      });

      const updated = await discovery.findCandidate(input.projectId, candidate.id);
      if (!updated) throw discoveryNotFound();
      return updated;
    });
  }
}
