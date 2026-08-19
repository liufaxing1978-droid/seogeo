export const VISIBILITY_EXTRACTION_QUEUE_NAME = 'visibility-extraction' as const;
export const VISIBILITY_EXTRACTION_ATTEMPTS = 2;

export interface ExtractVisibilityObservationJobData {
  projectId: string;
  observationId: string;
  extractorVersion: string;
  subjectSetHash: string;
}

export interface BackfillVisibilityProjectJobData {
  projectId: string;
  extractorVersion: string;
  subjectSetHash: string;
  afterObservationId: string | null;
  limit: number;
}

export type VisibilityExtractionJobData =
  | ExtractVisibilityObservationJobData
  | BackfillVisibilityProjectJobData;

export type VisibilityExtractionJobName = 'extract-observation' | 'backfill-project';

export interface VisibilityExtractionQueuePort {
  add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string; attempts: number }
  ): Promise<{ id?: string | null }>;
}

export function buildVisibilityExtractionJobId(
  observationId: string,
  extractorVersion: string,
  subjectSetHash: string
): string {
  return `visibility-extract:${observationId}:${extractorVersion}:${subjectSetHash}`;
}

export function buildVisibilityBackfillJobId(
  projectId: string,
  extractorVersion: string,
  subjectSetHash: string,
  afterObservationId: string | null
): string {
  return `visibility-backfill:${projectId}:${extractorVersion}:${subjectSetHash}:${afterObservationId ?? 'start'}`;
}

export class VisibilityExtractionQueue {
  constructor(private readonly queue: VisibilityExtractionQueuePort) {}

  async enqueueObservation(data: ExtractVisibilityObservationJobData) {
    return this.queue.add('extract-observation', data as unknown as Record<string, unknown>, {
      jobId: buildVisibilityExtractionJobId(
        data.observationId,
        data.extractorVersion,
        data.subjectSetHash
      ),
      attempts: VISIBILITY_EXTRACTION_ATTEMPTS
    });
  }

  async enqueueBackfill(data: BackfillVisibilityProjectJobData) {
    return this.queue.add('backfill-project', data as unknown as Record<string, unknown>, {
      jobId: buildVisibilityBackfillJobId(
        data.projectId,
        data.extractorVersion,
        data.subjectSetHash,
        data.afterObservationId
      ),
      attempts: VISIBILITY_EXTRACTION_ATTEMPTS
    });
  }
}
