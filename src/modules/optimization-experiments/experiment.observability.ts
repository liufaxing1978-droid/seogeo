import type {
  ExperimentContaminationState,
  ExperimentCoverageState,
  ExperimentEffectState,
  ExperimentWindowType
} from './experiment.types.js';

export type ExperimentObservabilityEventName =
  | 'optimization.experiment.started'
  | 'optimization.experiment.deferred'
  | 'optimization.experiment.observation.created'
  | 'optimization.experiment.evaluated'
  | 'optimization.experiment.inconclusive';

export interface ExperimentObservabilityEvent extends Record<string, unknown> {
  event: ExperimentObservabilityEventName;
  projectId: string;
  optimizationPlanId?: string;
  publicationExecutionId?: string;
  experimentId?: string;
  observationId?: string;
  windowType?: ExperimentWindowType;
  effectState?: ExperimentEffectState;
  coverageState?: ExperimentCoverageState;
  contaminationState?: ExperimentContaminationState;
  reasonCode?: string;
  marketCode?: string;
  provider?: string;
}

export type ExperimentObservabilitySink = (event: ExperimentObservabilityEvent) => void;

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

function optionalClean(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? clean(value) : undefined;
}

export class ExperimentObservability {
  constructor(
    private readonly sink: ExperimentObservabilitySink = (event) => console.info(event)
  ) {}

  emit(event: ExperimentObservabilityEvent): void {
    const optimizationPlanId = optionalClean(event.optimizationPlanId);
    const publicationExecutionId = optionalClean(event.publicationExecutionId);
    const experimentId = optionalClean(event.experimentId);
    const observationId = optionalClean(event.observationId);
    const reasonCode = optionalClean(event.reasonCode);
    const marketCode = optionalClean(event.marketCode);
    const provider = optionalClean(event.provider);

    this.sink({
      event: event.event,
      projectId: clean(event.projectId),
      ...(optimizationPlanId ? { optimizationPlanId } : {}),
      ...(publicationExecutionId ? { publicationExecutionId } : {}),
      ...(experimentId ? { experimentId } : {}),
      ...(observationId ? { observationId } : {}),
      ...(event.windowType ? { windowType: event.windowType } : {}),
      ...(event.effectState ? { effectState: event.effectState } : {}),
      ...(event.coverageState ? { coverageState: event.coverageState } : {}),
      ...(event.contaminationState ? { contaminationState: event.contaminationState } : {}),
      ...(reasonCode ? { reasonCode } : {}),
      ...(marketCode ? { marketCode } : {}),
      ...(provider ? { provider } : {})
    });
  }
}

export const experimentObservability = new ExperimentObservability();
