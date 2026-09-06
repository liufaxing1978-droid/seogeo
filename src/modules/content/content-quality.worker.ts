import type { Job } from 'bullmq';
import { contentQualityObservability } from './content-quality.observability.js';
import { contentQualityRepository } from './content-quality.repository.js';
import {
  evaluateContentDecay,
  evaluateInternalLinkSupport,
  surfaceContentQaFinding
} from './content-quality.rules.js';
import type { ContentQualityEvaluation } from './content-quality.types.js';
import type { ContentQualityJobData } from './content-quality.service.js';

export type { ContentQualityJobData } from './content-quality.service.js';

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 80);
  }
  return 'CONTENT_QUALITY_PROCESSING_FAILED';
}

function evaluateQa(
  opportunities: Parameters<typeof surfaceContentQaFinding>[0][],
  signals: Parameters<typeof surfaceContentQaFinding>[1][]
): ContentQualityEvaluation {
  const evaluations = opportunities.flatMap((opportunity) => signals.map((signal) => surfaceContentQaFinding(opportunity, signal)));
  return evaluations.find((evaluation) => evaluation.status === 'FAIL')
    ?? evaluations[0]
    ?? surfaceContentQaFinding(null, null);
}

export async function processContentQualityJob(
  job: Job<ContentQualityJobData>
) {
  const repository = contentQualityRepository;
  const observability = contentQualityObservability;
  const { projectId, runId } = job.data;
  const started = await repository.startRun(projectId, runId);
  if (!started) return { projectId, runId, skipped: true, documentsProcessed: 0, findingCount: 0 };

  observability.emit({ event: 'content.quality.started', projectId, runId });
  try {
    const input = await repository.loadInput(projectId, started.cutoffAt);
    const evaluations = input.documents.flatMap((document) => [
      { contentDocumentId: document.id, evaluation: evaluateInternalLinkSupport(document) },
      { contentDocumentId: document.id, evaluation: evaluateContentDecay(document.snapshots) },
      { contentDocumentId: document.id, evaluation: evaluateQa(document.opportunities, document.signals) }
    ]);
    const failed = evaluations.filter((row) => row.evaluation.status === 'FAIL');
    const materializedCount = await repository.materializeFailures(projectId, runId, failed);
    await repository.completeRun(projectId, runId, input.documents.length, failed.length);
    observability.emit({ event: 'content.quality.findings.materialized', projectId, runId, findingCount: materializedCount });
    observability.emit({
      event: 'content.quality.completed',
      projectId,
      runId,
      documentCount: input.documents.length,
      findingCount: failed.length
    });
    return { projectId, runId, documentsProcessed: input.documents.length, findingCount: failed.length };
  } catch (error) {
    const code = errorCode(error);
    await repository.failRun(projectId, runId, code);
    observability.emit({ event: 'content.quality.failed', projectId, runId, errorCode: code });
    throw error;
  }
}
