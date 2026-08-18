import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:5432/seogeo'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(8).default('development-secret'),
  CRAWLER_USER_AGENT: z.string().min(1).max(300).default('SEOGEO-Bot/0.1 (+https://seo.xingshantang.org)'),
  CRAWLER_MAX_PAGES: z.coerce.number().int().min(1).max(5000).default(500),
  CRAWLER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  CRAWLER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  CRAWLER_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).max(50000000).default(5000000),
  CRAWLER_BROWSER_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true')
});

export const env = schema.parse(process.env);
