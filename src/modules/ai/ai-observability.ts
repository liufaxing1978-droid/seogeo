export type AiObservabilityEventName =
  | 'ai.task.queued'
  | 'ai.task.started'
  | 'ai.provider.request.completed'
  | 'ai.provider.request.failed'
  | 'ai.output.validated'
  | 'ai.task.completed'
  | 'ai.task.failed';

export interface AiObservabilityEvent {
  event: AiObservabilityEventName;
  taskId: string;
  projectId: string;
  promptVersion: string;
  runId?: string;
  provider?: 'DEEPSEEK';
  model?: string;
  httpStatus?: number | null;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  reasoningTokens?: number | null;
  errorCode?: string;
}

export type AiObservabilitySink = (event: AiObservabilityEvent) => void;

function bounded(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 120);
}

export class AiObservability {
  constructor(
    private readonly sink: AiObservabilitySink = (event) => console.info(event)
  ) {}

  emit(event: AiObservabilityEvent): void {
    this.sink({
      ...event,
      model: bounded(event.model),
      promptVersion: bounded(event.promptVersion) ?? event.promptVersion,
      errorCode: bounded(event.errorCode)
    });
  }
}

export const aiObservability = new AiObservability();
