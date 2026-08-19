import { createHash } from 'node:crypto';
import type {
  Prisma,
  VisibilityMetricSnapshot,
  VisibilityProvider
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { calculateVisibilityMetrics } from './visibility-metrics.calculator.js';
import {
  P6C_FORMULA_VERSION,
  type VisibilityMetricActor,
  type VisibilityMetricEvidenceStatus,
  type VisibilityMetricInputRecord,
  type VisibilityMetricProvider
} from './visibility-metrics.types.js';
import {
  VisibilityMetricsRepository,
  visibilityMetricsRepository
} from './visibility-metrics.repository.js';
import { VisibilitySubjectService } from './visibility-subject.service.js';

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_PROMPT_SET_FILTERS = 20;
const MAX_CANDIDATES = 20_000;
const BATCH_SIZE = 500;
const PROVIDERS = new Set<VisibilityMetricProvider>([
  'OPENAI',
  'GEMINI',
  'PERPLEXITY',
  'ANTHROPIC',
  'DEEPSEEK'
]);

export interface VisibilityMetricScope {
  providers: VisibilityMetricProvider[];
  promptSetIds: string[];
}

export interface PrepareVisibilityMetricSnapshotInput {
  projectId: string;
  windowStart: Date;
  windowEnd: Date;
  inputCutoffAt: Date;
  extractorVersion: string;
  subjectSetHash: string;
  scope: VisibilityMetricScope;
}

type VisibilityMetricsErrorCode =
  | 'VISIBILITY_METRICS_PROJECT_NOT_FOUND'
  | 'VISIBILITY_METRICS_WINDOW_INVALID'
  | 'VISIBILITY_METRICS_WINDOW_TOO_LARGE'
  | 'VISIBILITY_METRICS_CUTOFF_IN_FUTURE'
  | 'VISIBILITY_METRICS_SCOPE_INVALID'
  | 'VISIBILITY_METRICS_PROMPT_SET_NOT_FOUND'
  | 'VISIBILITY_METRICS_SCOPE_TOO_LARGE'
  | 'VISIBILITY_METRICS_CONTRACT_NOT_FOUND'
  | 'VISIBILITY_METRICS_SUBJECT_SNAPSHOT_MISMATCH'
  | 'VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND'
  | 'VISIBILITY_METRICS_SNAPSHOT_BUSY'
  | 'VISIBILITY_METRICS_MATERIALIZATION_FAILED';

export class VisibilityMetricsError extends Error {
  readonly code: VisibilityMetricsErrorCode;

  constructor(code: VisibilityMetricsErrorCode, message: string) {
    super(message);
    this.name = 'VisibilityMetricsError';
    this.code = code;
  }
}

interface VisibilityMetricsServiceDependencies {
  repository?: VisibilityMetricsRepository;
  subjectService?: VisibilitySubjectService;
  now?: () => Date;
}

type SubjectSnapshotItem = {
  id: string;
  subjectType: 'OWNED_BRAND' | 'OWNED_DOMAIN' | 'OWNED_ENTITY' | 'COMPETITOR';
};

type Candidate = {
  id: string;
  provider: VisibilityMetricProvider;
  promptSetId: string;
  promptSetName: string;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function normalizeScope(scope: VisibilityMetricScope): VisibilityMetricScope {
  const providers = [...new Set(scope.providers)].sort();
  const promptSetIds = [...new Set(scope.promptSetIds)].sort();
  if (providers.some((provider) => !PROVIDERS.has(provider))) {
    throw new VisibilityMetricsError('VISIBILITY_METRICS_SCOPE_INVALID', 'Visibility metric provider scope is invalid');
  }
  if (promptSetIds.length > MAX_PROMPT_SET_FILTERS) {
    throw new VisibilityMetricsError('VISIBILITY_METRICS_SCOPE_INVALID', 'Too many visibility metric Prompt Set filters');
  }
  return { providers, promptSetIds };
}

function snapshotItems(value: unknown): SubjectSnapshotItem[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const subjects = (value as Record<string, unknown>).subjects;
  if (!Array.isArray(subjects)) return [];
  return subjects.flatMap((subject) => {
    if (!subject || typeof subject !== 'object' || Array.isArray(subject)) return [];
    const item = subject as Record<string, unknown>;
    if (typeof item.id !== 'string') return [];
    if (!['OWNED_BRAND', 'OWNED_DOMAIN', 'OWNED_ENTITY', 'COMPETITOR'].includes(String(item.subjectType))) return [];
    return [{ id: item.id, subjectType: item.subjectType as SubjectSnapshotItem['subjectType'] }];
  });
}

function actorsFromSnapshot(value: unknown): VisibilityMetricActor[] {
  const subjects = snapshotItems(value);
  const actors: VisibilityMetricActor[] = [];
  if (subjects.some((subject) => subject.subjectType !== 'COMPETITOR')) {
    actors.push({ actorType: 'OWNED_ROLLUP', actorKey: 'OWNED_ROLLUP', actorSubjectId: null });
  }
  for (const subject of subjects
    .filter((item) => item.subjectType === 'COMPETITOR')
    .sort((left, right) => left.id.localeCompare(right.id))) {
    actors.push({
      actorType: 'COMPETITOR',
      actorKey: `COMPETITOR:${subject.id}`,
      actorSubjectId: subject.id
    });
  }
  return actors;
}

function metricEvidenceStatus(value: string): VisibilityMetricEvidenceStatus {
  if (value === 'EXTRACTED' || value === 'KNOWN_EMPTY' || value === 'NOT_ELIGIBLE') return value;
  return 'UNKNOWN';
}

export class VisibilityMetricsService {
  private readonly repository: VisibilityMetricsRepository;
  private readonly subjectService: VisibilitySubjectService;
  private readonly now: () => Date;

  constructor(dependencies: VisibilityMetricsServiceDependencies = {}) {
    this.repository = dependencies.repository ?? visibilityMetricsRepository;
    this.subjectService = dependencies.subjectService ?? new VisibilitySubjectService();
    this.now = dependencies.now ?? (() => new Date());
  }

  private validateWindow(input: PrepareVisibilityMetricSnapshotInput) {
    if (!(input.windowStart instanceof Date) || !(input.windowEnd instanceof Date)
      || Number.isNaN(input.windowStart.getTime()) || Number.isNaN(input.windowEnd.getTime())
      || input.windowStart >= input.windowEnd) {
      throw new VisibilityMetricsError('VISIBILITY_METRICS_WINDOW_INVALID', 'Visibility metric window is invalid');
    }
    if (input.windowEnd.getTime() - input.windowStart.getTime() > MAX_WINDOW_MS) {
      throw new VisibilityMetricsError('VISIBILITY_METRICS_WINDOW_TOO_LARGE', 'Visibility metric window exceeds 31 days');
    }
    if (input.inputCutoffAt.getTime() > this.now().getTime()) {
      throw new VisibilityMetricsError('VISIBILITY_METRICS_CUTOFF_IN_FUTURE', 'Visibility metric cutoff cannot be in the future');
    }
  }

  private async resolveSubjectContract(
    projectId: string,
    extractorVersion: string,
    subjectSetHash: string
  ): Promise<Prisma.InputJsonValue> {
    const existing = await prisma.visibilityExtraction.findFirst({
      where: { projectId, extractorVersion, subjectSetHash },
      orderBy: { createdAt: 'desc' },
      select: { subjectSnapshotJson: true }
    });
    if (existing) return existing.subjectSnapshotJson as Prisma.InputJsonValue;

    const current = await this.subjectService.buildActiveSnapshot(projectId);
    if (current.subjectSetHash !== subjectSetHash) {
      throw new VisibilityMetricsError(
        'VISIBILITY_METRICS_CONTRACT_NOT_FOUND',
        'Visibility metric subject contract was not found'
      );
    }
    return {
      subjects: current.subjects,
      ambiguousAliases: current.ambiguousAliases
    } as Prisma.InputJsonValue;
  }

  async prepareSnapshot(input: PrepareVisibilityMetricSnapshotInput): Promise<VisibilityMetricSnapshot> {
    this.validateWindow(input);
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) {
      throw new VisibilityMetricsError('VISIBILITY_METRICS_PROJECT_NOT_FOUND', 'Visibility metric project not found');
    }
    if (!input.extractorVersion.trim() || !input.subjectSetHash.trim()) {
      throw new VisibilityMetricsError('VISIBILITY_METRICS_SCOPE_INVALID', 'Visibility metric contract is required');
    }

    const scope = normalizeScope(input.scope);
    if (scope.promptSetIds.length > 0) {
      const count = await prisma.visibilityPromptSet.count({
        where: { projectId: input.projectId, id: { in: scope.promptSetIds } }
      });
      if (count !== scope.promptSetIds.length) {
        throw new VisibilityMetricsError(
          'VISIBILITY_METRICS_PROMPT_SET_NOT_FOUND',
          'Visibility metric Prompt Set was not found in the project'
        );
      }
    }

    const subjectSnapshotJson = await this.resolveSubjectContract(
      input.projectId,
      input.extractorVersion,
      input.subjectSetHash
    );
    const scopeJson = { providers: scope.providers, promptSetIds: scope.promptSetIds };
    return this.repository.createOrGetShell({
      projectId: input.projectId,
      formulaVersion: P6C_FORMULA_VERSION,
      extractorVersion: input.extractorVersion,
      subjectSetHash: input.subjectSetHash,
      subjectSnapshotJson,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      inputCutoffAt: input.inputCutoffAt,
      scopeJson,
      scopeHash: hashJson(scopeJson)
    });
  }

  private candidateWhere(snapshot: VisibilityMetricSnapshot, scope: VisibilityMetricScope): Prisma.PlatformObservationWhereInput {
    return {
      projectId: snapshot.projectId,
      observedAt: { gte: snapshot.windowStart, lt: snapshot.windowEnd },
      createdAt: { lte: snapshot.inputCutoffAt },
      ...(scope.providers.length > 0
        ? { provider: { in: scope.providers as VisibilityProvider[] } }
        : {}),
      ...(scope.promptSetIds.length > 0
        ? { prompt: { promptSetId: { in: scope.promptSetIds } } }
        : {})
    };
  }

  private async loadCandidates(snapshot: VisibilityMetricSnapshot, scope: VisibilityMetricScope): Promise<Candidate[]> {
    const where = this.candidateWhere(snapshot, scope);
    const count = await prisma.platformObservation.count({ where });
    if (count > MAX_CANDIDATES) {
      throw new VisibilityMetricsError(
        'VISIBILITY_METRICS_SCOPE_TOO_LARGE',
        'Visibility metric scope exceeds 20,000 candidate observations'
      );
    }

    const candidates: Candidate[] = [];
    for (let skip = 0; skip < count; skip += BATCH_SIZE) {
      const page = await prisma.platformObservation.findMany({
        where,
        orderBy: { id: 'asc' },
        skip,
        take: BATCH_SIZE,
        select: {
          id: true,
          provider: true,
          prompt: {
            select: {
              promptSetId: true,
              promptSet: { select: { name: true } }
            }
          }
        }
      });
      candidates.push(...page.map((row) => ({
        id: row.id,
        provider: row.provider as VisibilityMetricProvider,
        promptSetId: row.prompt.promptSetId,
        promptSetName: row.prompt.promptSet.name
      })));
    }
    return candidates;
  }

  async materializeSnapshot(projectId: string, snapshotId: string): Promise<VisibilityMetricSnapshot> {
    const snapshot = await this.repository.get(projectId, snapshotId);
    if (!snapshot) {
      throw new VisibilityMetricsError('VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND', 'Visibility metric snapshot not found');
    }
    if (snapshot.status === 'COMPLETED') return snapshot;
    if (!await this.repository.claim(projectId, snapshotId)) {
      throw new VisibilityMetricsError('VISIBILITY_METRICS_SNAPSHOT_BUSY', 'Visibility metric snapshot is already running');
    }

    try {
      const rawScope = snapshot.scopeJson as Record<string, unknown>;
      const scope = normalizeScope({
        providers: Array.isArray(rawScope.providers) ? rawScope.providers as VisibilityMetricProvider[] : [],
        promptSetIds: Array.isArray(rawScope.promptSetIds) ? rawScope.promptSetIds.filter((id): id is string => typeof id === 'string') : []
      });
      const candidates = await this.loadCandidates(snapshot, scope);
      const records: VisibilityMetricInputRecord[] = [];
      const fingerprintRows: Array<Record<string, unknown>> = [];
      let completedExtractionCount = 0;
      let missingExtractionCount = 0;
      let failedExtractionCount = 0;

      for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
        const page = candidates.slice(offset, offset + BATCH_SIZE);
        const observationIds = page.map((candidate) => candidate.id);
        const extractions = await prisma.visibilityExtraction.findMany({
          where: {
            projectId,
            platformObservationId: { in: observationIds },
            extractorVersion: snapshot.extractorVersion,
            subjectSetHash: snapshot.subjectSetHash
          },
          select: {
            id: true,
            platformObservationId: true,
            status: true,
            mentionStatus: true,
            citationStatus: true,
            subjectSnapshotJson: true,
            createdAt: true,
            completedAt: true
          }
        });
        const byObservation = new Map(extractions.map((extraction) => [extraction.platformObservationId, extraction]));
        const usable = extractions.filter((extraction) =>
          extraction.createdAt <= snapshot.inputCutoffAt
          && extraction.status === 'COMPLETED'
          && extraction.completedAt !== null
          && extraction.completedAt <= snapshot.inputCutoffAt
        );
        for (const extraction of usable) {
          if (stableJson(extraction.subjectSnapshotJson) !== stableJson(snapshot.subjectSnapshotJson)) {
            throw new VisibilityMetricsError(
              'VISIBILITY_METRICS_SUBJECT_SNAPSHOT_MISMATCH',
              'Visibility metric extraction subject snapshot is inconsistent'
            );
          }
        }
        const usableIds = usable.map((extraction) => extraction.id);
        const [mentions, citations] = usableIds.length === 0 ? [[], []] : await Promise.all([
          prisma.mentionObservation.findMany({
            where: { visibilityExtractionId: { in: usableIds } },
            select: { visibilityExtractionId: true, subjectId: true, subjectType: true }
          }),
          prisma.citationObservation.findMany({
            where: { visibilityExtractionId: { in: usableIds } },
            select: { visibilityExtractionId: true, ownedSubjectId: true, competitorSubjectId: true }
          })
        ]);
        const mentionsByExtraction = new Map<string, typeof mentions>();
        for (const mention of mentions) {
          const values = mentionsByExtraction.get(mention.visibilityExtractionId) ?? [];
          values.push(mention);
          mentionsByExtraction.set(mention.visibilityExtractionId, values);
        }
        const citationsByExtraction = new Map<string, typeof citations>();
        for (const citation of citations) {
          const values = citationsByExtraction.get(citation.visibilityExtractionId) ?? [];
          values.push(citation);
          citationsByExtraction.set(citation.visibilityExtractionId, values);
        }
        const usableByObservation = new Map(usable.map((extraction) => [extraction.platformObservationId, extraction]));

        for (const candidate of page) {
          const extraction = usableByObservation.get(candidate.id);
          const anyExtraction = byObservation.get(candidate.id);
          if (!extraction) {
            if (anyExtraction?.status === 'FAILED' && anyExtraction.createdAt <= snapshot.inputCutoffAt) failedExtractionCount += 1;
            else missingExtractionCount += 1;
            records.push({
              observationId: candidate.id,
              provider: candidate.provider,
              promptSetId: candidate.promptSetId,
              promptSetName: candidate.promptSetName,
              mentionStatus: 'UNKNOWN',
              citationStatus: 'UNKNOWN',
              ownedMentioned: false,
              competitorMentionedSubjectIds: [],
              ownedCited: false,
              competitorCitedSubjectIds: []
            });
            fingerprintRows.push({
              observationId: candidate.id,
              provider: candidate.provider,
              promptSetId: candidate.promptSetId,
              extractionId: null,
              mentionStatus: 'UNKNOWN',
              citationStatus: 'UNKNOWN'
            });
            continue;
          }

          completedExtractionCount += 1;
          const mentionRows = mentionsByExtraction.get(extraction.id) ?? [];
          const citationRows = citationsByExtraction.get(extraction.id) ?? [];
          records.push({
            observationId: candidate.id,
            provider: candidate.provider,
            promptSetId: candidate.promptSetId,
            promptSetName: candidate.promptSetName,
            mentionStatus: metricEvidenceStatus(extraction.mentionStatus),
            citationStatus: metricEvidenceStatus(extraction.citationStatus),
            ownedMentioned: mentionRows.some((row) => row.subjectType !== 'COMPETITOR'),
            competitorMentionedSubjectIds: [...new Set(mentionRows
              .filter((row) => row.subjectType === 'COMPETITOR')
              .map((row) => row.subjectId))].sort(),
            ownedCited: citationRows.some((row) => row.ownedSubjectId !== null),
            competitorCitedSubjectIds: [...new Set(citationRows
              .map((row) => row.competitorSubjectId)
              .filter((id): id is string => id !== null))].sort()
          });
          fingerprintRows.push({
            observationId: candidate.id,
            provider: candidate.provider,
            promptSetId: candidate.promptSetId,
            extractionId: extraction.id,
            mentionStatus: extraction.mentionStatus,
            citationStatus: extraction.citationStatus,
            completedAt: extraction.completedAt?.toISOString() ?? null
          });
        }
      }

      const actors = actorsFromSnapshot(snapshot.subjectSnapshotJson);
      const rows = calculateVisibilityMetrics({ records, actors });
      return await this.repository.completeAtomic(snapshot, {
        inputFingerprint: hashJson(fingerprintRows.sort((left, right) =>
          String(left.observationId).localeCompare(String(right.observationId)))),
        candidateObservationCount: candidates.length,
        completedExtractionCount,
        missingExtractionCount,
        failedExtractionCount,
        rows
      });
    } catch (error) {
      const code = error instanceof VisibilityMetricsError
        ? error.code
        : 'VISIBILITY_METRICS_MATERIALIZATION_FAILED';
      await this.repository.fail(projectId, snapshotId, code);
      throw error;
    }
  }
}
