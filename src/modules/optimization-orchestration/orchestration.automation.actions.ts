import { z } from 'zod';
import type {
  OfficialSearchSyncCommand,
  OfficialSearchSyncOutcome
} from '../search-sync/official-search-sync.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const searchRefreshConfigSchema = z.object({
  version: z.literal('SEARCH_REFRESH_V1'),
  bindingId: z.string().uuid(),
  lookbackDays: z.number().int().min(1).max(31),
  lagDays: z.number().int().min(0).max(7)
}).strict();

export type SearchRefreshActionConfig = z.infer<typeof searchRefreshConfigSchema>;

export class OptimizationAutomationActionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OptimizationAutomationActionError';
  }
}

export type OfficialSearchSyncPort = {
  sync(command: OfficialSearchSyncCommand): Promise<OfficialSearchSyncOutcome>;
};

export type AutomationActionExecutionInput = {
  actionType: string;
  actionConfig: unknown;
  projectId: string;
  runId: string;
  definitionId: string;
};

export type OptimizationAutomationActionDispatcherDeps = {
  searchSync: OfficialSearchSyncPort;
  now?: () => Date;
};

function utcDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function buildSearchRefreshWindow(
  now: Date,
  input: Pick<SearchRefreshActionConfig, 'lookbackDays' | 'lagDays'>
): { dateFrom: string; dateTo: string } {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dateTo = todayUtc - input.lagDays * DAY_MS;
  const dateFrom = dateTo - (input.lookbackDays - 1) * DAY_MS;

  return {
    dateFrom: utcDateKey(dateFrom),
    dateTo: utcDateKey(dateTo)
  };
}

export function parseSearchRefreshConfig(value: unknown): SearchRefreshActionConfig {
  const parsed = searchRefreshConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new OptimizationAutomationActionError(
      'AUTOMATION_ACTION_CONFIG_INVALID',
      'SEARCH_REFRESH automation action configuration is invalid'
    );
  }
  return parsed.data;
}

function searchFailureCode(outcome: OfficialSearchSyncOutcome): string {
  const suffix = outcome.reason ?? outcome.state;
  return `SEARCH_REFRESH_${suffix}`;
}

export class OptimizationAutomationActionDispatcher {
  private readonly now: () => Date;

  constructor(private readonly deps: OptimizationAutomationActionDispatcherDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async execute(input: AutomationActionExecutionInput): Promise<void> {
    if (input.actionType !== 'SEARCH_REFRESH') {
      throw new OptimizationAutomationActionError(
        'AUTOMATION_ACTION_UNSUPPORTED',
        `Automation action is not registered: ${input.actionType}`
      );
    }

    const config = parseSearchRefreshConfig(input.actionConfig);
    const window = buildSearchRefreshWindow(this.now(), config);
    const outcome = await this.deps.searchSync.sync({
      projectId: input.projectId,
      bindingId: config.bindingId,
      ...window
    });

    if (outcome.state === 'COMPLETED' || outcome.state === 'ALREADY_COMPLETED') {
      return;
    }

    throw new OptimizationAutomationActionError(
      searchFailureCode(outcome),
      `SEARCH_REFRESH automation did not complete: ${outcome.reason ?? outcome.state}`
    );
  }
}