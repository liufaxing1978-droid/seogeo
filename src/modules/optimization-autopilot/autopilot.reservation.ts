import type { AutopilotExecutionReservation } from '@prisma/client';
import { OptimizationAutopilotRepository } from './autopilot.repository.js';

export type ReserveAutopilotCapacityInput = {
  projectId: string;
  decisionId: string;
  utcDate: string;
  dailyDraftPrLimit: number;
  maxConcurrentRuns: number;
};

export type ReserveAutopilotCapacityResult =
  | { reserved: true; reservation: AutopilotExecutionReservation }
  | {
      reserved: false;
      reasonCode: 'AUTOPILOT_DAILY_QUOTA_EXHAUSTED' | 'AUTOPILOT_CONCURRENCY_LIMIT';
    };

function parseUtcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('AUTOPILOT_UTC_DATE_INVALID');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('AUTOPILOT_UTC_DATE_INVALID');
  }
  return parsed;
}

function assertCapacityBounds(input: ReserveAutopilotCapacityInput): void {
  if (
    !Number.isInteger(input.dailyDraftPrLimit)
    || input.dailyDraftPrLimit < 1
    || input.dailyDraftPrLimit > 10
  ) {
    throw new Error('AUTOPILOT_DAILY_QUOTA_INVALID');
  }
  if (
    !Number.isInteger(input.maxConcurrentRuns)
    || input.maxConcurrentRuns < 1
    || input.maxConcurrentRuns > 3
  ) {
    throw new Error('AUTOPILOT_CONCURRENCY_LIMIT_INVALID');
  }
}

export async function reserveAutopilotCapacity(
  input: ReserveAutopilotCapacityInput
): Promise<ReserveAutopilotCapacityResult> {
  assertCapacityBounds(input);
  const utcDateValue = parseUtcDate(input.utcDate);
  const repository = new OptimizationAutopilotRepository();
  return repository.reserveAutopilotCapacity({ ...input, utcDateValue });
}
