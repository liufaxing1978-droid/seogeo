import { z } from 'zod';

export const createSeoAuditSchema = z.object({
  crawlRunId: z.string().uuid().optional()
});

export const seoIssueQuerySchema = z.object({
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'PARTIALLY_FIXED', 'RESOLVED', 'IGNORED', 'REGRESSED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const updateSeoIssueStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'PARTIALLY_FIXED', 'IGNORED'])
});

export const seoCompareQuerySchema = z.object({
  currentAuditId: z.string().uuid(),
  previousAuditId: z.string().uuid()
});

export type CreateSeoAuditInput = z.infer<typeof createSeoAuditSchema>;
export type SeoIssueQuery = z.infer<typeof seoIssueQuerySchema>;
export type SeoIssueManualStatus = z.infer<typeof updateSeoIssueStatusSchema>['status'];
export type SeoCompareQuery = z.infer<typeof seoCompareQuerySchema>;
