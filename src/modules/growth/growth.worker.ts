import { createHash } from 'node:crypto';
import { GROWTH_SCORE_VERSION } from './growth-score.js';
import {
  GROWTH_MATERIALIZATION_VERSION,
  materializeGrowthWindow,
  type GrowthMaterializationResult
} from './growth.service.js';
import { emitGrowthEvent, serializeGrowthEvent } from './growth.observability.js';

export const GROWTH_MATERIALIZATION_QUEUE_NAME = 'growth-materialization' as const;
export const GROWTH_MATERIALIZATION_WORKER_CONCURRENCY = 1;

export type GrowthMaterializationJobData = {
  projectId: string;
  asOfDate: string;
};

export type GrowthMaterializationJobIdentity = {
  projectId: string;
  formulaVersion: string;
  materializationVersion: string;
  currentWindowStart: string;
  currentWindowEnd: string;
  previousWindowStart: string;
  previousWindowEnd: string;
  dataCutoffAt: string;
  selectedGscSnapshotIds: readonly string[];
};

export type GrowthMaterializationWorkerDeps = {
  materialize?: (projectId: string, asOfDate: Date) => Promise<GrowthMaterializationResult>;
  emit?: (event: Record<string, unknown>) => void;
  now?: () => Date;
};

type GrowthMaterializationJobLike = {
  name: string;
  data: GrowthMaterializationJobData;
};

function canonicalIdentity(input: GrowthMaterializationJobIdentity): string {
  const selectedGscSnapshotIds = [...new Set(input.selectedGscSnapshotIds)].sort();
  return JSON.stringify({
    projectId: input.projectId,
    formulaVersion: input.formulaVersion,
    materializationVersion: input.materializationVersion,
    currentWindowStart: input.currentWindowStart,
    currentWindowEnd: input.currentWindowEnd,
    previousWindowStart: input.previousWindowStart,
    previousWindowEnd: input.previousWindowEnd,
    dataCutoffAt: input.dataCutoffAt,
    selectedGscSnapshotIds
  });
}

export function buildGrowthMaterializationJobId(input: GrowthMaterializationJobIdentity): string {
  const digest = createHash('sha256').update(canonicalIdentity(input)).digest('hex');
  return `${GROWTH_MATERIALIZATION_QUEUE_NAME}-${digest}`;
}

function parseAsOfDate(value: string): Date {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new Error('Growth materialization job asOfDate is invalid');
  }
  return parsed;
}

function defaultEmit(payload: Record<string, unknown>): void {
  const event = payload.event;
  if (typeof event !== 'string') return;
  const { event: _event, ...fields } = payload;
  emitGrowthEvent(event as Parameters<typeof emitGrowthEvent>[0], fields);
}

export async function processGrowthMaterializationJob(
  job: GrowthMaterializationJobLike,
  deps: GrowthMaterializationWorkerDeps = {}
): Promise<void> {
  if (job.name !== 'materialize-window' || !job.data?.projectId) {
    throw new Error('Growth materialization job data is invalid');
  }

  const asOfDate = parseAsOfDate(job.data.asOfDate);
  const materialize = deps.materialize ?? materializeGrowthWindow;
  const emit = deps.emit ?? defaultEmit;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();

  emit(serializeGrowthEvent('growth.materialization.started', {
    projectId: job.data.projectId,
    status: 'RUNNING',
    materializationVersion: GROWTH_MATERIALIZATION_VERSION,
    formulaVersion: GROWTH_SCORE_VERSION
  }));

  try {
    const result = await materialize(job.data.projectId, asOfDate);
    const endedAt = now();
    emit(serializeGrowthEvent('growth.materialization.completed', {
      projectId: job.data.projectId,
      status: result.state,
      materializationVersion: GROWTH_MATERIALIZATION_VERSION,
      formulaVersion: GROWTH_SCORE_VERSION,
      selectedGscSnapshotCount: result.selectedGscSnapshotIds.length,
      opportunitySnapshotCount: result.opportunitySnapshotCount,
      topicSnapshotCount: result.topicSnapshotCount,
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime())
    }));
  } catch (error) {
    const endedAt = now();
    emit(serializeGrowthEvent('growth.materialization.failed', {
      projectId: job.data.projectId,
      status: 'FAILED',
      materializationVersion: GROWTH_MATERIALIZATION_VERSION,
      formulaVersion: GROWTH_SCORE_VERSION,
      errorCode: 'GROWTH_MATERIALIZATION_FAILED',
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime())
    }));
    throw error;
  }
}
