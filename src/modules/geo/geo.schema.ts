import { z } from 'zod';

export const createGeoAuditSchema = z.object({
  crawlRunId: z.string().uuid().optional()
});

export type CreateGeoAuditInput = z.infer<typeof createGeoAuditSchema>;
