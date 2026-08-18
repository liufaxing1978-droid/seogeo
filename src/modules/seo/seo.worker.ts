import type { Job } from 'bullmq';
import { executeSeoAudit } from './audit-engine.js';

export interface SeoAuditJobData {
  auditRunId: string;
}

type SeoAuditExecutor = (auditRunId: string) => Promise<void>;
type SeoAuditJobLike = Pick<Job<SeoAuditJobData>, 'data'>;

export async function processSeoAuditJob(
  job: SeoAuditJobLike,
  tokenOrExecute?: string | SeoAuditExecutor
): Promise<void> {
  const auditRunId = job.data?.auditRunId;
  if (!auditRunId || typeof auditRunId !== 'string') {
    throw new Error('auditRunId is required for SEO audit jobs');
  }

  const execute = typeof tokenOrExecute === 'function' ? tokenOrExecute : executeSeoAudit;
  await execute(auditRunId);
}
