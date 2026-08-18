import type { Job } from 'bullmq';
import { runGeoAudit } from './audit-engine.js';

export interface GeoAuditJobData {
  auditRunId: string;
}

type GeoAuditExecutor = (auditRunId: string) => Promise<unknown>;
type GeoAuditJobLike = Pick<Job<GeoAuditJobData>, 'data'>;

export async function processGeoAuditJob(
  job: GeoAuditJobLike,
  tokenOrExecute?: string | GeoAuditExecutor
): Promise<void> {
  const auditRunId = job.data?.auditRunId;
  if (!auditRunId || typeof auditRunId !== 'string') {
    throw new Error('auditRunId is required for GEO audit jobs');
  }

  const execute = typeof tokenOrExecute === 'function' ? tokenOrExecute : runGeoAudit;
  await execute(auditRunId);
}
