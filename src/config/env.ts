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
  CRAWLER_BROWSER_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true')
});

export const env = schema.parse(process.env);
