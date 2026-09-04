import 'dotenv/config';
import { z } from 'zod';

const optionalNonBlankString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional()
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional()
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:5432/seogeo'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(1).default('development-secret'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
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
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(65536).default(8192),
  GOOGLE_OAUTH_CLIENT_ID: optionalNonBlankString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalNonBlankString,
  GOOGLE_OAUTH_REDIRECT_URI: optionalUrl,
  OAUTH_CREDENTIAL_ENCRYPTION_KEY: optionalNonBlankString,
  OAUTH_CREDENTIAL_KEY_VERSION: z.string().min(1).default('v1'),
  BING_WEBMASTER_API_KEY: optionalNonBlankString,
  DATAFORSEO_LOGIN: optionalNonBlankString,
  DATAFORSEO_PASSWORD: optionalNonBlankString,
  DATAFORSEO_BASE_URL: z.string().url().default('https://api.dataforseo.com'),
  DATAFORSEO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  INDEXNOW_ENDPOINT: z.string().url().default('https://api.indexnow.org/indexnow'),
  INDEXNOW_KEY: optionalNonBlankString,
  INDEXNOW_KEY_LOCATION: optionalUrl,
  INDEXNOW_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000)
});

export type RuntimeEnv = z.infer<typeof schema>;

export function parseEnv(input: NodeJS.ProcessEnv): RuntimeEnv {
  const parsed = schema.parse(input);

  if (parsed.NODE_ENV === 'production') {
    if (!input.DATABASE_URL?.trim()) {
      throw new Error('DATABASE_URL is required in production');
    }
    if (!input.REDIS_URL?.trim()) {
      throw new Error('REDIS_URL is required in production');
    }
    if (!input.SESSION_SECRET?.trim()) {
      throw new Error('SESSION_SECRET is required in production');
    }
    if (parsed.SESSION_SECRET.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters in production');
    }
  }

  return parsed;
}

export const env = parseEnv(process.env);
