import 'dotenv/config';
import { z } from 'zod';

const optionalNonBlankString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional()
);

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
  CRAWLER_BROWSER_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DEEPSEEK_API_KEY: optionalNonBlankString,
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_FAST_MODEL: z.string().min(1).default('deepseek-v4-flash'),
  DEEPSEEK_REASONING_MODEL: z.string().min(1).default('deepseek-v4-pro'),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(180000),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(1000).max(2000000).default(200000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(65536).default(8192)
});

export const env = schema.parse(process.env);
