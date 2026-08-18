import { z } from 'zod';
import { env } from '../../config/env.js';

export const createCrawlSchema = z.object({
  runType: z.enum(['FULL', 'INCREMENTAL', 'MANUAL', 'SCHEDULED', 'SINGLE_PAGE']).default('MANUAL'),
  maxPages: z.number().int().min(1).max(5000).default(env.CRAWLER_MAX_PAGES),
  seedUrl: z.string().url().optional()
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export type CreateCrawlInput = z.infer<typeof createCrawlSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
