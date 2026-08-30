import type { SearchConsoleSyncDependencies } from '../search-console/search-console.worker.js';
import { SearchConsoleSyncError } from '../search-console/search-console.worker.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../search-facts/search-fact.types.js';
import { BingWebmasterTransportError } from '../search-providers/bing-webmaster.client.js';
import { AppError } from '../../core/errors.js';
import {
  officialSearchSyncObservability,
  type OfficialSearchSyncObservability,
} from './official-search-sync.observability.js';
import type {
  BingSearchProviderPort,
  BingSourcePersistencePort,
  GoogleDailySyncPort,
  GoogleSearchPropertyRepositoryPort,
  OfficialSearchBindingRepositoryPort,
  OfficialSearchBindingProvider,
  OfficialSearchSyncCommand,
  OfficialSearchSyncFailureReason,
  OfficialSearchSyncOutcome,
  SearchFactMaterializePort,
} from './official-search-sync.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SYNC_DAYS = 31;

export class OfficialSearchSyncCommandError extends AppError {
  constructor(message = 'Official search sync date range is invalid') {
    super(message, 400, 'OFFICIAL_SEARCH_SYNC_RANGE_INVALID');
  }
}

export type OfficialSearchSyncServiceDependencies = {
  bindingRepository: Pick<OfficialSearchBindingRepositoryPort, 'findBinding'>;
  googlePropertyRepository: GoogleSearchPropertyRepositoryPort;
  googleDailySync: GoogleDailySyncPort;
  googleDependencies: SearchConsoleSyncDependencies;
  bingProvider?: BingSearchProviderPort;
  bingSourcePersistence?: BingSourcePersistencePort;
  materializer: SearchFactMaterializePort;
  observability?: Pick<OfficialSearchSyncObservability, 'emit'>;
  now?: () => Date;
};

function parseUtcDateKey(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OfficialSearchSyncCommandError();
  }
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new OfficialSearchSyncCommandError();
  }
  return parsed;
}

function validateRange(command: OfficialSearchSyncCommand, now: Date): void {
  const from = parseUtcDateKey(command.dateFrom);
  const to = parseUtcDateKey(command.dateTo);
  if (from.getTime() > to.getTime()) {
    throw new OfficialSearchSyncCommandError();
  }
  const spanDays = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (spanDays > MAX_SYNC_DAYS) {
    throw new OfficialSearchSyncCommandError();
  }
  const todayUtc = now.toISOString().slice(0, 10);
  if (command.dateTo > todayUtc) {
    throw new OfficialSearchSyncCommandError();
  }
}

function enumerateUtcDateKeys(dateFrom: string, dateTo: string): string[] {
  const from = parseUtcDateKey(dateFrom);
  const to = parseUtcDateKey(dateTo);
  const dates: string[] = [];
  for (let time = from.getTime(); time <= to.getTime(); time += DAY_MS) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

function elapsedMs(startedAt: Date, endedAt: Date): number {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}

function classifyBingProviderError(error: unknown): OfficialSearchSyncFailureReason {
  if (!(error instanceof BingWebmasterTransportError)) {
    return 'TRANSIENT_PROVIDER_ERROR';
  }
  if (error.httpStatus === 401) return 'TOKEN_REVOKED';
  if (error.httpStatus === 403) return 'PERMISSION_DENIED';
  if (error.httpStatus === 404) return 'PROPERTY_UNAVAILABLE';
  if (error.httpStatus === 429) return 'RATE_LIMITED';
  if (error.httpStatus !== null && error.httpStatus >= 500) {
    return 'TRANSIENT_PROVIDER_ERROR';
  }
  if (/INVALID/i.test(error.code)) return 'INVALID_RESPONSE';
  return 'TRANSIENT_PROVIDER_ERROR';
}

function outcome(input: {
  provider: OfficialSearchBindingProvider | null;
  state: OfficialSearchSyncOutcome['state'];
  command: OfficialSearchSyncCommand;
  sourceRefs?: string[];
  searchFactSnapshotIds?: string[];
  reason?: OfficialSearchSyncFailureReason | null;
}): OfficialSearchSyncOutcome {
  return {
    provider: input.provider,
    state: input.state,
    dateFrom: input.command.dateFrom,
    dateTo: input.command.dateTo,
    sourceRefs: input.sourceRefs ?? [],
    searchFactSnapshotIds: input.searchFactSnapshotIds ?? [],
    discoveryState: 'NOT_RUN',
    reason: input.reason ?? null,
  };
}

export class OfficialSearchSyncService {
  private readonly observability: Pick<OfficialSearchSyncObservability, 'emit'>;
  private readonly now: () => Date;

  constructor(private readonly dependencies: OfficialSearchSyncServiceDependencies) {
    this.observability = dependencies.observability ?? officialSearchSyncObservability;
    this.now = dependencies.now ?? (() => new Date());
  }

  async sync(command: OfficialSearchSyncCommand): Promise<OfficialSearchSyncOutcome> {
    validateRange(command, this.now());
    const operationStartedAt = this.now();

    const binding = await this.dependencies.bindingRepository.findBinding(
      command.projectId,
      command.bindingId,
    );
    if (!binding) {
      const result = outcome({
        provider: null,
        state: 'UNAVAILABLE',
        command,
        reason: 'BINDING_NOT_FOUND',
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    const provider = binding.provider as OfficialSearchBindingProvider;
    this.observability.emit({
      event: 'official_search.sync.started',
      projectId: command.projectId,
      bindingId: command.bindingId,
      provider,
      dateFrom: command.dateFrom,
      dateTo: command.dateTo,
    });

    if (!binding.isActive) {
      const result = outcome({
        provider,
        state: 'UNAVAILABLE',
        command,
        reason: 'BINDING_INACTIVE',
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    if (provider === 'BING_WEBMASTER') {
      const bingProvider = this.dependencies.bingProvider;
      const bingSourcePersistence = this.dependencies.bingSourcePersistence;
      if (!bingProvider || !bingSourcePersistence) {
        const result = outcome({
          provider,
          state: 'UNAVAILABLE',
          command,
          reason: 'SYNC_NOT_CONFIGURED',
        });
        this.emitFinished(command, result, operationStartedAt);
        return result;
      }
      return this.syncBing(
        command,
        binding,
        operationStartedAt,
        bingProvider,
        bingSourcePersistence,
      );
    }

    if (provider !== 'GOOGLE_SEARCH_CONSOLE') {
      const result = outcome({
        provider,
        state: 'UNAVAILABLE',
        command,
        reason: 'SYNC_NOT_CONFIGURED',
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    return this.syncGoogle(command, binding, operationStartedAt);
  }

  private async syncBing(
    command: OfficialSearchSyncCommand,
    binding: Awaited<ReturnType<OfficialSearchBindingRepositoryPort['findBinding']>> & {},
    operationStartedAt: Date,
    bingProvider: BingSearchProviderPort,
    bingSourcePersistence: BingSourcePersistencePort,
  ): Promise<OfficialSearchSyncOutcome> {
    let properties;
    try {
      properties = await bingProvider.listProperties();
    } catch (error) {
      const result = outcome({
        provider: 'BING_WEBMASTER',
        state: 'FAILED',
        command,
        reason: classifyBingProviderError(error),
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    const property = properties.find((candidate) =>
      candidate.provider === 'BING_WEBMASTER'
      && candidate.propertyRef === binding.propertyRef
      && candidate.propertyType === 'SITE'
      && candidate.verified === true
    );

    if (!property) {
      const result = outcome({
        provider: 'BING_WEBMASTER',
        state: 'UNAVAILABLE',
        command,
        reason: 'PROPERTY_UNAVAILABLE',
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    let observations;
    try {
      observations = (await bingProvider.fetchQueryStats(binding.propertyRef))
        .filter((observation) =>
          observation.sourceDate >= command.dateFrom
          && observation.sourceDate <= command.dateTo
        )
        .sort((left, right) =>
          left.sourceDate.localeCompare(right.sourceDate)
          || left.query.localeCompare(right.query)
        );
    } catch (error) {
      const result = outcome({
        provider: 'BING_WEBMASTER',
        state: 'FAILED',
        command,
        reason: classifyBingProviderError(error),
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    if (observations.length === 0) {
      const result = outcome({
        provider: 'BING_WEBMASTER',
        state: 'FAILED',
        command,
        reason: 'INVALID_RESPONSE',
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    let source;
    try {
      source = await bingSourcePersistence.persistBingBatch({
        projectId: command.projectId,
        marketCode: binding.marketCode,
        locale: binding.locale,
        propertyRef: binding.propertyRef,
        propertyType: 'SITE',
        sourceCutoffAt: new Date(`${command.dateTo}T00:00:00.000Z`),
        observations,
      });
    } catch {
      const result = outcome({
        provider: 'BING_WEBMASTER',
        state: 'FAILED',
        command,
        reason: 'PERSISTENCE_FAILED',
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    let snapshot;
    try {
      snapshot = await this.dependencies.materializer.materializeBingBatch({
        batchId: source.id,
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
      });
    } catch {
      const result = outcome({
        provider: 'BING_WEBMASTER',
        state: 'FAILED',
        command,
        sourceRefs: [source.id],
        reason: 'MATERIALIZATION_FAILED',
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    const result = outcome({
      provider: 'BING_WEBMASTER',
      state: 'COMPLETED',
      command,
      sourceRefs: [source.id],
      searchFactSnapshotIds: [snapshot.id],
    });
    this.emitFinished(command, result, operationStartedAt);
    return result;
  }

  private async syncGoogle(
    command: OfficialSearchSyncCommand,
    binding: Awaited<ReturnType<OfficialSearchBindingRepositoryPort['findBinding']>> & {},
    operationStartedAt: Date,
  ): Promise<OfficialSearchSyncOutcome> {
    let connection: { id: string } | null;
    let properties: Awaited<ReturnType<GoogleSearchPropertyRepositoryPort['listProperties']>>;
    try {
      connection = await this.dependencies.googlePropertyRepository.findActiveConnection(
        command.projectId,
      );
      if (!connection) {
        const result = outcome({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          state: 'UNAVAILABLE',
          command,
          reason: 'PROPERTY_UNAVAILABLE',
        });
        this.emitFinished(command, result, operationStartedAt);
        return result;
      }
      properties = await this.dependencies.googlePropertyRepository.listProperties(
        command.projectId,
        connection.id,
      );
    } catch {
      const result = outcome({
        provider: 'GOOGLE_SEARCH_CONSOLE',
        state: 'FAILED',
        command,
        reason: 'PERSISTENCE_FAILED',
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    const property = properties.find((candidate) =>
      candidate.projectId === command.projectId
      && candidate.isActive
      && candidate.propertyUri === binding.propertyRef
    );
    if (!property) {
      const result = outcome({
        provider: 'GOOGLE_SEARCH_CONSOLE',
        state: 'UNAVAILABLE',
        command,
        reason: 'PROPERTY_UNAVAILABLE',
      });
      this.emitFinished(command, result, operationStartedAt);
      return result;
    }

    const sourceRefs: string[] = [];
    const searchFactSnapshotIds: string[] = [];
    let everySourceReused = true;

    for (const date of enumerateUtcDateKeys(command.dateFrom, command.dateTo)) {
      let source;
      try {
        source = await this.dependencies.googleDailySync(
          {
            projectId: command.projectId,
            propertyId: property.id,
            date,
          },
          this.dependencies.googleDependencies,
        );
      } catch (error) {
        const reason: OfficialSearchSyncFailureReason = error instanceof SearchConsoleSyncError
          ? error.reason
          : 'TRANSIENT_PROVIDER_ERROR';
        const state = reason === 'SYNC_NOT_CONFIGURED' ? 'UNAVAILABLE' : 'FAILED';
        const result = outcome({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          state,
          command,
          sourceRefs,
          searchFactSnapshotIds,
          reason,
        });
        this.emitFinished(command, result, operationStartedAt);
        return result;
      }

      sourceRefs.push(source.snapshotId);
      everySourceReused = everySourceReused && source.state === 'ALREADY_COMPLETED';

      try {
        const snapshot = await this.dependencies.materializer.materializeGoogleSnapshot({
          snapshotId: source.snapshotId,
          marketCode: binding.marketCode,
          locale: binding.locale,
          normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
        });
        searchFactSnapshotIds.push(snapshot.id);
      } catch {
        const result = outcome({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          state: 'FAILED',
          command,
          sourceRefs,
          searchFactSnapshotIds,
          reason: 'MATERIALIZATION_FAILED',
        });
        this.emitFinished(command, result, operationStartedAt);
        return result;
      }
    }

    const result = outcome({
      provider: 'GOOGLE_SEARCH_CONSOLE',
      state: everySourceReused ? 'ALREADY_COMPLETED' : 'COMPLETED',
      command,
      sourceRefs,
      searchFactSnapshotIds,
    });
    this.emitFinished(command, result, operationStartedAt);
    return result;
  }

  private emitFinished(
    command: OfficialSearchSyncCommand,
    result: OfficialSearchSyncOutcome,
    operationStartedAt: Date,
  ): void {
    const failed = result.state === 'FAILED' || result.state === 'UNAVAILABLE';
    this.observability.emit({
      event: failed ? 'official_search.sync.failed' : 'official_search.sync.completed',
      projectId: command.projectId,
      bindingId: command.bindingId,
      ...(result.provider ? { provider: result.provider } : {}),
      dateFrom: command.dateFrom,
      dateTo: command.dateTo,
      state: result.state,
      ...(result.reason ? { reason: result.reason } : {}),
      sourceCount: result.sourceRefs.length,
      snapshotCount: result.searchFactSnapshotIds.length,
      durationMs: elapsedMs(operationStartedAt, this.now()),
    });
  }
}
