import { z } from 'zod';

export const createCrawlSchema = z.object({
  runType: z.enum(['FULL', 'INCREMENTAL', 'MANUAL', 'SCHEDULED', 'SINGLE_PAGE']).default('MANUAL'),
  maxPages: z.number().int().min(1).max(5000).default(500),
  seedUrl: z.string().url().optional()
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export type CreateCrawlInput = z.infer<typeof createCrawlSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
