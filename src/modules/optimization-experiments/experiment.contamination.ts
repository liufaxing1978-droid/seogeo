import type { PublicationExecutionEventType } from '@prisma/client';
import { normalizeExperimentHttpUrl } from './experiment.scope.js';
import type { ExperimentContaminationState } from './experiment.types.js';

export type ExperimentContaminationEvent = {
  projectId: string;
  executionId: string;
  eventType: PublicationExecutionEventType;
  targetUrl: string;
  createdAt: Date;
};

export interface ExperimentContaminationReadPort {
  listPublicationEvents(input: {
    experimentId: string;
    projectId: string;
    targetUrl: string;
    verifiedAnchorAt: Date;
    observedWindowEnd: Date;
  }): Promise<readonly ExperimentContaminationEvent[] | null>;
}

export type ExperimentContaminationResult = {
  state: ExperimentContaminationState;
  reasonCodes: readonly string[];
};

const CONFLICTING_MUTATION_EVENTS = new Set<PublicationExecutionEventType>([
  'DEPLOYED',
  'VERIFIED',
  'ROLLED_BACK'
]);

const UNKNOWN_RESULT: ExperimentContaminationResult = {
  state: 'UNKNOWN',
  reasonCodes: ['EXPERIMENT_CONTAMINATION_AUTHORITY_UNKNOWN']
};

function inObservationBoundary(
  createdAt: Date,
  verifiedAnchorAt: Date,
  observedWindowEnd: Date
): boolean {
  const time = createdAt.getTime();
  return Number.isFinite(time)
    && time >= verifiedAnchorAt.getTime()
    && time <= observedWindowEnd.getTime();
}

export async function detectExperimentContamination(input: {
  experimentId: string;
  projectId: string;
  publicationExecutionId: string;
  targetUrl: string;
  verifiedAnchorAt: Date;
  observedWindowEnd: Date;
  repository: ExperimentContaminationReadPort;
}): Promise<ExperimentContaminationResult> {
  if (
    input.experimentId.trim().length === 0
    || input.projectId.trim().length === 0
    || input.publicationExecutionId.trim().length === 0
    || !Number.isFinite(input.verifiedAnchorAt.getTime())
    || !Number.isFinite(input.observedWindowEnd.getTime())
    || input.observedWindowEnd.getTime() < input.verifiedAnchorAt.getTime()
  ) {
    return UNKNOWN_RESULT;
  }

  let normalizedTarget: string;
  try {
    normalizedTarget = normalizeExperimentHttpUrl(input.targetUrl);
  } catch {
    return UNKNOWN_RESULT;
  }

  let events: readonly ExperimentContaminationEvent[] | null;
  try {
    events = await input.repository.listPublicationEvents({
      experimentId: input.experimentId,
      projectId: input.projectId,
      targetUrl: normalizedTarget,
      verifiedAnchorAt: input.verifiedAnchorAt,
      observedWindowEnd: input.observedWindowEnd
    });
  } catch {
    return UNKNOWN_RESULT;
  }
  if (events === null) return UNKNOWN_RESULT;

  const scoped: ExperimentContaminationEvent[] = [];
  for (const event of events) {
    if (
      event.projectId !== input.projectId
      || !inObservationBoundary(event.createdAt, input.verifiedAnchorAt, input.observedWindowEnd)
    ) {
      continue;
    }

    let eventTarget: string;
    try {
      eventTarget = normalizeExperimentHttpUrl(event.targetUrl);
    } catch {
      return UNKNOWN_RESULT;
    }
    if (eventTarget !== normalizedTarget) continue;
    scoped.push(event);
  }

  if (scoped.some((event) => (
    event.executionId === input.publicationExecutionId
    && event.eventType === 'ROLLED_BACK'
  ))) {
    return {
      state: 'VERIFICATION_INVALIDATED',
      reasonCodes: ['EXPERIMENT_ORIGINAL_EXECUTION_ROLLED_BACK']
    };
  }

  if (scoped.some((event) => (
    event.executionId !== input.publicationExecutionId
    && CONFLICTING_MUTATION_EVENTS.has(event.eventType)
  ))) {
    return {
      state: 'CONFLICTING_MUTATION',
      reasonCodes: ['EXPERIMENT_CONFLICTING_PUBLICATION_EVENT']
    };
  }

  if (scoped.some((event) => (
    event.executionId !== input.publicationExecutionId
    && event.eventType === 'TARGET_REVISION_CHANGED'
  ))) {
    return {
      state: 'TARGET_REVISION_CHANGED',
      reasonCodes: ['EXPERIMENT_TARGET_REVISION_CHANGED']
    };
  }

  return { state: 'CLEAR', reasonCodes: [] };
}
