import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type OptimizationExperimentDerivedState =
  | 'OBSERVING'
  | 'EVALUATED'
  | 'INCONCLUSIVE'
  | 'CONTAMINATED';

type ScheduleWindow = {
  windowType: string;
  windowDays: number;
};

export type OptimizationExperimentWebObservation = {
  id: string;
  windowType: string;
  windowDays: number;
  dueAt: Date;
  inputCutoffAt: Date;
  baselineSearchSourceRefs: Prisma.JsonValue;
  observedSearchSourceRefs: Prisma.JsonValue;
  baselineVisibilitySourceRefs: Prisma.JsonValue;
  observedVisibilitySourceRefs: Prisma.JsonValue;
  baselineMetricsJson: Prisma.JsonValue;
  observedMetricsJson: Prisma.JsonValue;
  deltaMetricsJson: Prisma.JsonValue;
  coverageState: string;
  contaminationState: string;
  effectState: string;
  reasonCodes: Prisma.JsonValue;
  evaluatorVersion: string;
  createdAt: Date;
};

function parseSchedule(value: Prisma.JsonValue): ScheduleWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.windowType !== 'string') return [];
    if (typeof record.windowDays !== 'number' || !Number.isFinite(record.windowDays)) return [];
    return [{ windowType: record.windowType, windowDays: record.windowDays }];
  });
}

function compareObservationRecency(
  left: OptimizationExperimentWebObservation,
  right: OptimizationExperimentWebObservation
): number {
  const cutoff = right.inputCutoffAt.getTime() - left.inputCutoffAt.getTime();
  if (cutoff !== 0) return cutoff;
  const created = right.createdAt.getTime() - left.createdAt.getTime();
  if (created !== 0) return created;
  return left.id.localeCompare(right.id);
}

function currentObservationByWindow(
  observations: readonly OptimizationExperimentWebObservation[]
): Map<string, OptimizationExperimentWebObservation> {
  const grouped = new Map<string, OptimizationExperimentWebObservation[]>();
  for (const observation of observations) {
    const rows = grouped.get(observation.windowType) ?? [];
    rows.push(observation);
    grouped.set(observation.windowType, rows);
  }

  const current = new Map<string, OptimizationExperimentWebObservation>();
  for (const [windowType, rows] of grouped) {
    rows.sort(compareObservationRecency);
    if (rows[0]) current.set(windowType, rows[0]);
  }
  return current;
}

function windowDueAt(anchor: Date, windowDays: number): Date {
  return new Date(anchor.getTime() + windowDays * 24 * 60 * 60 * 1000);
}

export function deriveOptimizationExperimentState(input: {
  verifiedAnchorAt: Date;
  observationScheduleJson: Prisma.JsonValue;
  observations: readonly OptimizationExperimentWebObservation[];
  now?: Date;
}): OptimizationExperimentDerivedState {
  const now = input.now ?? new Date();
  const schedule = parseSchedule(input.observationScheduleJson);
  if (schedule.length === 0) return 'OBSERVING';

  const current = currentObservationByWindow(input.observations);
  const due = schedule
    .filter((window) => windowDueAt(input.verifiedAnchorAt, window.windowDays).getTime() <= now.getTime())
    .sort((left, right) => left.windowDays - right.windowDays || left.windowType.localeCompare(right.windowType));

  if (due.length === 0) return 'OBSERVING';
  const latestDue = due[due.length - 1];
  const latestObservation = latestDue ? current.get(latestDue.windowType) : undefined;
  if (latestObservation && latestObservation.contaminationState !== 'CLEAR') return 'CONTAMINATED';

  const hasFutureWindow = schedule.some(
    (window) => windowDueAt(input.verifiedAnchorAt, window.windowDays).getTime() > now.getTime()
  );
  if (hasFutureWindow) return 'OBSERVING';
  if (due.some((window) => !current.has(window.windowType))) return 'OBSERVING';

  if (latestObservation?.effectState === 'INCONCLUSIVE') return 'INCONCLUSIVE';
  const conclusiveStates = new Set(['POSITIVE', 'NEUTRAL', 'NEGATIVE']);
  if (due.every((window) => conclusiveStates.has(current.get(window.windowType)!.effectState))) {
    return 'EVALUATED';
  }
  return 'OBSERVING';
}

const observationSelect = {
  id: true,
  windowType: true,
  windowDays: true,
  dueAt: true,
  inputCutoffAt: true,
  baselineSearchSourceRefs: true,
  observedSearchSourceRefs: true,
  baselineVisibilitySourceRefs: true,
  observedVisibilitySourceRefs: true,
  baselineMetricsJson: true,
  observedMetricsJson: true,
  deltaMetricsJson: true,
  coverageState: true,
  contaminationState: true,
  effectState: true,
  reasonCodes: true,
  evaluatorVersion: true,
  createdAt: true
} satisfies Prisma.OptimizationExperimentObservationSelect;

const observationOrderBy = [
  { windowDays: 'asc' as const },
  { inputCutoffAt: 'desc' as const },
  { createdAt: 'desc' as const },
  { id: 'asc' as const }
];

export class OptimizationExperimentWebRepository {
  async listExperiments(projectId: string, now = new Date()) {
    const rows = await prisma.optimizationExperiment.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        projectId: true,
        optimizationPlanId: true,
        publicationExecutionId: true,
        interventionType: true,
        targetUrl: true,
        marketCode: true,
        locale: true,
        verifiedAnchorAt: true,
        observationScheduleJson: true,
        createdAt: true,
        observations: {
          orderBy: observationOrderBy,
          select: observationSelect
        }
      }
    });

    return rows.map((row) => ({
      ...row,
      derivedState: deriveOptimizationExperimentState({
        verifiedAnchorAt: row.verifiedAnchorAt,
        observationScheduleJson: row.observationScheduleJson,
        observations: row.observations,
        now
      })
    }));
  }

  async getExperiment(projectId: string, experimentId: string, now = new Date()) {
    const row = await prisma.optimizationExperiment.findFirst({
      where: { id: experimentId, projectId },
      select: {
        id: true,
        projectId: true,
        optimizationPlanId: true,
        publicationExecutionId: true,
        publicationVerificationId: true,
        experimentVersion: true,
        experimentKey: true,
        interventionType: true,
        targetUrl: true,
        marketCode: true,
        locale: true,
        verifiedAnchorAt: true,
        measurementScopeJson: true,
        observationScheduleJson: true,
        expectedDirectionJson: true,
        createdAt: true,
        observations: {
          orderBy: observationOrderBy,
          select: observationSelect
        }
      }
    });
    if (!row) return null;

    const current = currentObservationByWindow(row.observations);
    return {
      ...row,
      derivedState: deriveOptimizationExperimentState({
        verifiedAnchorAt: row.verifiedAnchorAt,
        observationScheduleJson: row.observationScheduleJson,
        observations: row.observations,
        now
      }),
      currentObservationIds: new Set([...current.values()].map((observation) => observation.id))
    };
  }
}

export const optimizationExperimentWebRepository = new OptimizationExperimentWebRepository();
