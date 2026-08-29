import { MarketCode } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import {
  SEARCH_PROVIDER_CODES,
  type SearchProviderCode,
} from '../search-providers/search-provider.types.js';
import type {
  SearchFactSnapshotView,
  SearchFactView,
} from '../search-facts/search-fact.types.js';
import { normalizeSearchEvidenceQuery } from './keyword-search-evidence-normalize.js';
import {
  aggregateKeywordSearchEvidenceLane,
  projectProviderPlaceholders,
  type KeywordSearchEvidenceItem,
  type KeywordSearchEvidenceLaneSource,
} from './keyword-search-evidence.js';
import {
  KeywordSearchEvidenceRepository,
  type KeywordSearchEvidenceWindow,
} from './keyword-search-evidence.repository.js';
import { KeywordRepository } from './keyword.repository.js';
import type { KeywordListRecord } from './keyword.types.js';

export type KeywordSearchEvidenceFilters = {
  from?: string;
  to?: string;
  provider?: SearchProviderCode;
  marketCode?: MarketCode;
  locale?: string;
  propertyRef?: string;
};

export type KeywordSearchEvidenceResult = {
  keyword: {
    id: string;
    text: string;
    normalizedMatchText: string;
  };
  dateFrom: string;
  dateTo: string;
  evidence: KeywordSearchEvidenceItem[];
};

const DAY_MS = 86_400_000;
const MAX_DAYS = 93;
const DEFAULT_DAYS = 28;
const providerSet = new Set<string>(SEARCH_PROVIDER_CODES);
const marketSet = new Set<string>(Object.values(MarketCode));

function rangeError(): AppError {
  return new AppError(
    'Invalid keyword search evidence date range',
    400,
    'KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID',
  );
}

function filterError(): AppError {
  return new AppError(
    'Invalid keyword search evidence filter',
    400,
    'KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID',
  );
}

function keywordNotFound(): AppError {
  return new AppError('Keyword not found', 404, 'KEYWORD_NOT_FOUND');
}

function parseUtcDate(value: unknown): Date {
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

function resolveRange(
  filters: KeywordSearchEvidenceFilters,
  now: Date,
): { dateFrom: Date; dateTo: Date; from: string; to: string } {
  const hasFrom = filters.from !== undefined;
  const hasTo = filters.to !== undefined;

  let dateFrom: Date;
  let dateTo: Date;

  if (!hasFrom && !hasTo) {
    if (Number.isNaN(now.getTime())) throw rangeError();
    const today = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ));
    dateTo = new Date(today.getTime() - DAY_MS);
    dateFrom = new Date(dateTo.getTime() - (DEFAULT_DAYS - 1) * DAY_MS);
  } else {
    if (!hasFrom || !hasTo) throw rangeError();
    dateFrom = parseUtcDate(filters.from);
    dateTo = parseUtcDate(filters.to);
  }

  if (dateFrom.getTime() > dateTo.getTime()) throw rangeError();
  const inclusiveDays = Math.floor((dateTo.getTime() - dateFrom.getTime()) / DAY_MS) + 1;
  if (inclusiveDays > MAX_DAYS) throw rangeError();

  return {
    dateFrom,
    dateTo,
    from: isoDay(dateFrom),
    to: isoDay(dateTo),
  };
}

function parseProvider(value: unknown): SearchProviderCode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !providerSet.has(value)) throw filterError();
  return value as SearchProviderCode;
}

function parseMarket(value: unknown): MarketCode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !marketSet.has(value)) throw filterError();
  return value as MarketCode;
}

function parseOptionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw filterError();
  const normalized = value.trim();
  if (!normalized) throw filterError();
  return normalized;
}

function normalizeFilters(filters: KeywordSearchEvidenceFilters): KeywordSearchEvidenceFilters {
  return {
    ...(filters.from !== undefined ? { from: filters.from } : {}),
    ...(filters.to !== undefined ? { to: filters.to } : {}),
    ...(parseProvider(filters.provider) ? { provider: parseProvider(filters.provider) } : {}),
    ...(parseMarket(filters.marketCode) ? { marketCode: parseMarket(filters.marketCode) } : {}),
    ...(parseOptionalText(filters.locale) ? { locale: parseOptionalText(filters.locale) } : {}),
    ...(parseOptionalText(filters.propertyRef)
      ? { propertyRef: parseOptionalText(filters.propertyRef) }
      : {}),
  };
}

function laneKey(snapshot: SearchFactSnapshotView): string {
  return [
    snapshot.provider,
    snapshot.marketCode,
    snapshot.locale,
    snapshot.propertyRef,
  ].join('\0');
}

function latestSnapshot(rows: readonly SearchFactSnapshotView[]): SearchFactSnapshotView {
  return [...rows].sort((left, right) =>
    right.sourceCutoffAt.getTime() - left.sourceCutoffAt.getTime()
    || left.snapshotId.localeCompare(right.snapshotId))[0]!;
}

function latestAvailableSourceDate(rows: readonly SearchFactSnapshotView[]): string | null {
  if (rows.length === 0) return null;
  return rows
    .map((row) => isoDay(row.sourceCutoffAt))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function compareEvidence(left: KeywordSearchEvidenceItem, right: KeywordSearchEvidenceItem): number {
  return left.provider.localeCompare(right.provider)
    || String(left.marketCode ?? '').localeCompare(String(right.marketCode ?? ''))
    || String(left.locale ?? '').localeCompare(String(right.locale ?? ''))
    || String(left.propertyRef ?? '').localeCompare(String(right.propertyRef ?? ''));
}

function evidenceForKeyword(input: {
  keyword: Pick<KeywordListRecord, 'id' | 'text'>;
  window: KeywordSearchEvidenceWindow;
  filters: KeywordSearchEvidenceFilters;
  dateFrom: string;
  dateTo: string;
}): KeywordSearchEvidenceResult {
  const normalizedMatchText = normalizeSearchEvidenceQuery(input.keyword.text);
  const grouped = new Map<string, SearchFactSnapshotView[]>();

  for (const snapshot of input.window.snapshots) {
    const key = laneKey(snapshot);
    const rows = grouped.get(key) ?? [];
    rows.push(snapshot);
    grouped.set(key, rows);
  }

  const lanes: KeywordSearchEvidenceItem[] = [];
  const providersWithRealLanes = new Set<SearchProviderCode>();

  for (const snapshots of grouped.values()) {
    const representative = latestSnapshot(snapshots);
    const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.snapshotId));
    const laneFacts = input.window.facts.filter((fact) =>
      snapshotIds.has(fact.snapshotId)
      && fact.provider === representative.provider
      && fact.marketCode === representative.marketCode
      && fact.locale === representative.locale
      && fact.propertyRef === representative.propertyRef);

    const laneSource: KeywordSearchEvidenceLaneSource = {
      provider: representative.provider,
      marketCode: representative.marketCode,
      locale: representative.locale,
      propertyRef: representative.propertyRef,
      propertyType: representative.propertyType,
      sourceCompleteness: snapshots.map((snapshot) => snapshot.sourceCompleteness),
      snapshotIds: snapshots.map((snapshot) => snapshot.snapshotId),
      latestAvailableSourceDate: latestAvailableSourceDate(snapshots),
    };

    lanes.push(aggregateKeywordSearchEvidenceLane({
      normalizedKeyword: normalizedMatchText,
      lane: laneSource,
      facts: laneFacts,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
    }));
    providersWithRealLanes.add(representative.provider);
  }

  let placeholders = projectProviderPlaceholders({
    providersWithRealLanes,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  });
  if (input.filters.provider) {
    placeholders = placeholders.filter((item) => item.provider === input.filters.provider);
  }

  return {
    keyword: {
      id: input.keyword.id,
      text: input.keyword.text,
      normalizedMatchText,
    },
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    evidence: [...lanes, ...placeholders].sort(compareEvidence),
  };
}

export class KeywordSearchEvidenceService {
  constructor(
    private readonly repository = new KeywordSearchEvidenceRepository(),
    private readonly keywordRepository = new KeywordRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async evaluateKeyword(
    projectId: string,
    keywordId: string,
    filters: KeywordSearchEvidenceFilters = {},
  ): Promise<KeywordSearchEvidenceResult> {
    const keyword = await this.keywordRepository.findKeyword(projectId, keywordId);
    if (!keyword) throw keywordNotFound();

    const normalizedFilters = normalizeFilters(filters);
    const range = resolveRange(normalizedFilters, this.now());
    const window = await this.repository.loadProjectWindow({
      projectId,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      ...(normalizedFilters.provider ? { provider: normalizedFilters.provider } : {}),
      ...(normalizedFilters.marketCode ? { marketCode: normalizedFilters.marketCode } : {}),
      ...(normalizedFilters.locale ? { locale: normalizedFilters.locale } : {}),
      ...(normalizedFilters.propertyRef ? { propertyRef: normalizedFilters.propertyRef } : {}),
    });

    return evidenceForKeyword({
      keyword,
      window,
      filters: normalizedFilters,
      dateFrom: range.from,
      dateTo: range.to,
    });
  }

  async evaluateProject(
    projectId: string,
    keywords: KeywordListRecord[],
    filters: KeywordSearchEvidenceFilters = {},
  ): Promise<Map<string, KeywordSearchEvidenceResult>> {
    if (keywords.some((keyword) => keyword.projectId !== projectId)) {
      throw keywordNotFound();
    }

    const normalizedFilters = normalizeFilters(filters);
    const range = resolveRange(normalizedFilters, this.now());
    const window = await this.repository.loadProjectWindow({
      projectId,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      ...(normalizedFilters.provider ? { provider: normalizedFilters.provider } : {}),
      ...(normalizedFilters.marketCode ? { marketCode: normalizedFilters.marketCode } : {}),
      ...(normalizedFilters.locale ? { locale: normalizedFilters.locale } : {}),
      ...(normalizedFilters.propertyRef ? { propertyRef: normalizedFilters.propertyRef } : {}),
    });

    return new Map(keywords.map((keyword) => [
      keyword.id,
      evidenceForKeyword({
        keyword,
        window,
        filters: normalizedFilters,
        dateFrom: range.from,
        dateTo: range.to,
      }),
    ]));
  }
}

export const keywordSearchEvidenceService = new KeywordSearchEvidenceService();
