export const PUBLICATION_VERIFICATION_QUEUE_NAME = 'site-mutation-verification' as const;
export const PUBLICATION_VERIFICATION_MAX_ATTEMPTS = 1;
export const PUBLICATION_VERIFICATION_WORKER_CONCURRENCY = 2;

export function buildPublicationVerificationJobId(executionId: string): string {
  const normalized = executionId.trim();
  if (!normalized) throw new Error('Publication verification executionId is required');
  return `${PUBLICATION_VERIFICATION_QUEUE_NAME}-${normalized}`;
}

export function buildPublicationVerificationJobOptions(executionId: string) {
  return {
    jobId: buildPublicationVerificationJobId(executionId),
    attempts: PUBLICATION_VERIFICATION_MAX_ATTEMPTS,
    removeOnComplete: true,
    removeOnFail: true
  } as const;
}
